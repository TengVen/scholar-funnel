"""
主干检索引擎：Decompose → Lexical Recall → Rerank → Score → Store
"""
import os
import time
from typing import List, Dict

from retrieval.decomposer import QueryDecomposer
from retrieval.lexical import LexicalRetriever
from retrieval.reranker import ResearchReranker
from retrieval.scorer import ResearchScorer
from storage.mysql_db import get_session
from storage.models import Paper
from utils.log import setup_logger

logger = setup_logger("pipeline")

# 单个步骤超过此阈值在 UI 标红
SLOW_THRESHOLD = 10.0


class TrunkSearchEngine:
    def __init__(self):
        self.decomposer = QueryDecomposer()
        self.lexical = LexicalRetriever(per_query=40)
        self.reranker = None
        self.scorer = ResearchScorer()
        # 全局缓存器（模型级，非实例级）
        self._shared_reranker = None

    def search(
            self,
            project_id: int,
            user_query: str,
            tech_probe: str = "",
            per_query: int = 50,
            year_from: int = None,
            year_to: int = None,
            score_threshold: float = 0.0,
            top_k: int = 100,
            max_queries: int = 8,  # ← 限制检索词数量
    ) -> dict:
        trace = {"timing": {}, "slow_warnings": []}

        # ── 1. Decomposition ──
        t0 = time.time()
        intent = self.decomposer.decompose(user_query, tech_probe)
        t1 = time.time()
        trace["timing"]["step1_decomposition"] = round(t1 - t0, 1)

        # 限制检索词数量（只取前 N 个最相关的）
        original_count = len(intent.combined_queries)
        if len(intent.combined_queries) > max_queries:
            intent.combined_queries = intent.combined_queries[:max_queries]

        trace["step1_decomposition"] = {
            "methodology_core": intent.methodology.core,
            "methodology_synonyms": intent.methodology.synonyms,
            "methodology_related": intent.methodology.related,
            "domain_core": intent.domain.core,
            "domain_synonyms": intent.domain.synonyms,
            "domain_broader": intent.domain.broader,
            "paradigm": intent.paradigm,
            "combined_queries": intent.combined_queries,
            "reasoning": intent.reasoning,
            "original_query_count": original_count,
            "used_query_count": len(intent.combined_queries),
        }

        # ── 2. Lexical Recall ──
        self.lexical.per_query = per_query
        t0 = time.time()
        candidates = self.lexical.recall(intent, year_from=year_from, year_to=year_to)
        t1 = time.time()
        trace["timing"]["step2_recall"] = round(t1 - t0, 1)

        recall_meta = candidates[0].get("_recall_meta") if candidates else None
        if recall_meta:
            for c in candidates:
                c.pop("_recall_meta", None)

        trace["step2_recall"] = {
            "total_unique": len(candidates),
            "sample_titles": [c["title"][:80] for c in candidates[:5]] if candidates else [],
            "query_stats": recall_meta.get("query_stats", []) if recall_meta else [],
            "total_raw": recall_meta.get("total_raw", len(candidates)) if recall_meta else len(candidates),
            "duplicates": recall_meta.get("duplicates", 0) if recall_meta else 0,
        }

        # ── 3. Reranker ──
        reranked = []
        t0 = time.time()
        if candidates:
            if self.reranker is None:
                self.reranker = ResearchReranker()
            reranked = self.reranker.rerank(intent.to_rerank_query(), candidates)
            t1 = time.time()
            trace["timing"]["step3_rerank"] = round(t1 - t0, 1)

            # 提示模型加载时间（如果第一步推理耗时明显更长）
            if reranked:
                scores = [s for _, s in reranked]
                trace["step3_rerank"] = {
                    "reranked_count": len(reranked),
                    "score_min": round(min(scores), 4),
                    "score_max": round(max(scores), 4),
                    "score_mean": round(sum(scores) / len(scores), 4),
                    "top10": [
                        {"title": p["title"][:80], "score": round(s, 4)}
                        for p, s in reranked[:10]
                    ],
                }
        else:
            t1 = time.time()
            trace["timing"]["step3_rerank"] = round(t1 - t0, 1)
            trace["step3_rerank"] = {"reranked_count": 0}

        # ── 4. Scoring + Truncation ──
        t0 = time.time()
        results = []
        filtered_by_threshold = 0
        for paper, r_score in reranked:
            if r_score < score_threshold:
                filtered_by_threshold += 1
                continue
            item = self.scorer.score(paper, r_score)
            results.append(item)

        results = self.scorer.sort(results)
        final_papers = results[:top_k]
        t1 = time.time()
        trace["timing"]["step4_scoring"] = round(t1 - t0, 1)

        trace["step4_scoring"] = {
            "before_threshold": len(reranked),
            "filtered_by_threshold": filtered_by_threshold,
            "after_threshold": len(results),
            "final_top_k": len(final_papers),
            "survey_count": sum(1 for r in final_papers if r["is_survey"]),
            "score_distribution": self._build_score_distribution(results),
            "top10_breakdown": [
                {
                    "title": r["paper"]["title"][:80],
                    "final_score": round(r["final_score"], 2),
                    "rerank_score": round(r["rerank_score"], 4),
                    "cited_by": r["paper"].get("cited_by_count", 0),
                    "year": r["paper"].get("year", 0),
                    "is_survey": r["is_survey"],
                }
                for r in final_papers[:10]
            ],
        }

        # ── 5. Storage ──
        t0 = time.time()
        saved = self._save(project_id, final_papers)
        t1 = time.time()
        trace["timing"]["step5_storage"] = round(t1 - t0, 1)

        # ── 总耗时 + 慢步骤警告 ──
        total = sum(trace["timing"].values())
        trace["timing"]["total"] = round(total, 1)
        for step, sec in trace["timing"].items():
            if step != "total" and sec > SLOW_THRESHOLD:
                trace["slow_warnings"].append({
                    "step": step,
                    "seconds": sec,
                    "label": {
                        "step1_decomposition": "LLM 意图拆解",
                        "step2_recall": "OpenAlex 检索",
                        "step3_rerank": "BGE 重排序",
                        "step4_scoring": "评分",
                        "step5_storage": "入库",
                    }.get(step, step),
                })

        return {
            "expanded_queries": intent.combined_queries,
            "reasoning": intent.reasoning,
            "total_found": len(candidates),
            "after_rerank": len(results),
            "new_saved": saved,
            "survey_count": trace["step4_scoring"]["survey_count"],
            "trace": trace,
        }

    def _build_score_distribution(self, results: List[Dict]) -> Dict:
        if not results:
            return {"bins": [], "counts": []}
        scores = [r["final_score"] for r in results]
        min_s, max_s = min(scores), max(scores)
        if max_s == min_s:
            return {"bins": [min_s], "counts": [len(scores)]}
        n_bins = 10
        bin_width = (max_s - min_s) / n_bins
        bins = [round(min_s + i * bin_width, 1) for i in range(n_bins + 1)]
        counts = [0] * n_bins
        for s in scores:
            idx = min(int((s - min_s) / bin_width), n_bins - 1)
            counts[idx] += 1
        return {"bins": bins, "counts": counts}

    def _save(self, project_id: int, results: List[Dict]) -> int:
        count = 0
        with get_session() as session:
            deleted = (
                session.query(Paper)
                .filter_by(project_id=project_id, stage="trunk")
                .delete(synchronize_session=False)
            )
            if deleted:
                logger.info(f"已清理旧 trunk 数据 {deleted} 篇")

            for item in results:
                p = item["paper"]
                # 跨项目查重：同一 openalex_id 已在库中则跳过
                existing = (
                    session.query(Paper)
                    .filter_by(openalex_id=p["id"])
                    .first()
                )
                if existing:
                    continue

                db_paper = Paper(
                    project_id=project_id,
                    openalex_id=p["id"],
                    title=p.get("title", ""),
                    authors=p.get("authors", []),
                    year=p.get("year", 0),
                    venue=p.get("venue", ""),
                    doi=p.get("doi"),
                    abstract=p.get("abstract", ""),
                    cited_by_count=p.get("cited_by_count", 0),
                    is_survey=item["is_survey"],
                    stage="trunk",
                    trunk_score=round(item["final_score"], 2),
                    keywords=p.get("keywords") or None,
                    github_url=p.get("github_url") or None,
                )
                session.add(db_paper)
                count += 1
        return count
