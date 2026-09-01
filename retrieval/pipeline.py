"""
主干检索引擎：Decompose → Lexical Recall → Rerank → Score → Store
"""
import os
import time
from datetime import datetime
from typing import List, Dict

from retrieval.decomposer import QueryDecomposer
from retrieval.lexical import LexicalRetriever
from retrieval.reranker import ResearchReranker
from retrieval.scorer import ResearchScorer
from storage.mysql_db import get_session
from storage.models import Paper, CartItem
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
            # ── P2/P3：Retrieval Planner 模式 ──
            mode: str = "full",          # full / incremental / local_filter / hybrid
            pool_window_from: int = None,  # incremental：池内合并的完整窗口下界（新约束窗口）
            pool_window_to: int = None,    # incremental：池内合并的完整窗口上界
            methodology: str = None,       # hybrid：方法论词（池内匹配 + 参与拆解）
            plan_reason: str = None,       # Planner 决策说明（写入 Run）
    ) -> dict:
        trace = {"timing": {}, "slow_warnings": []}

        # ── 1. Decomposition ──
        t0 = time.time()
        # hybrid：方法论词并入查询参与拆解（召回偏向新方法论）
        intent_query = user_query
        if mode == "hybrid" and methodology:
            intent_query = f"{user_query} {methodology}".strip()
        intent = self.decomposer.decompose(intent_query, tech_probe)
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

        # ── 2. Lexical Recall（Retrieval Planner 模式分派）──
        self.lexical.per_query = per_query
        t0 = time.time()
        if mode == "incremental":
            # 窗口放宽：只召新增时间段（year_from/to = 新增段），合并池内完整窗口论文
            candidates = self.lexical.recall(intent, year_from=year_from, year_to=year_to)
            pool = self._pool_candidates(project_id, pool_window_from, pool_window_to)
            candidates = self._merge_candidates(candidates, pool)
            logger.info(f"[Planner] incremental: 新增段召回 {len(candidates)}（含池内 {len(pool)}）")
        elif mode == "local_filter":
            # 窗口收窄：池内过滤优先，不足 top_k 再补一次召回
            candidates = self._pool_candidates(project_id, year_from, year_to)
            if len(candidates) < top_k:
                remote = self.lexical.recall(intent, year_from=year_from, year_to=year_to)
                candidates = self._merge_candidates(candidates, remote)
            logger.info(f"[Planner] local_filter: 池内 {len(candidates)}（补召回后）")
        elif mode == "hybrid":
            # 方法论偏移：池内方法论匹配 + OpenAlex 补召回（methodology 已并入 intent_query）
            pool = self._pool_candidates(project_id, year_from, year_to, methodology=methodology)
            remote = self.lexical.recall(intent, year_from=year_from, year_to=year_to)
            candidates = self._merge_candidates(pool, remote)
            logger.info(f"[Planner] hybrid: 池内 {len(pool)} + 召回合并 {len(candidates)}")
        else:
            # full：完整全量召回（现状）
            candidates = self.lexical.recall(intent, year_from=year_from, year_to=year_to)
        t1 = time.time()
        trace["timing"]["step2_recall"] = round(t1 - t0, 1)
        trace["step2_recall_mode"] = mode

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

        # ── 2.5 本地语义召回（价值点1：OpenAlex 词法搜不到的同义改写） ──
        t0 = time.time()
        semantic_added = self._semantic_recall(project_id, intent, candidates)
        t1 = time.time()
        trace["timing"]["step2_5_semantic"] = round(t1 - t0, 1)
        trace["step2_5_semantic"] = {
            "semantic_candidates": semantic_added,
            "merged_total": len(candidates),
            "label": "本地语义召回（已入库论文向量匹配）",
        }

        # ── 2.6 排除回流：用户已排除的论文不再进入召回池（对话式修正，可逆） ──
        try:
            from storage.judgments import filter_excluded
            candidates, excluded_n = filter_excluded(project_id, candidates)
            trace["excluded_filtered"] = excluded_n
        except Exception as e:
            logger.warning(f"排除过滤失败（忽略，不影响检索）: {e}")
            trace["excluded_filtered"] = 0

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
        # 覆盖率：本次召回中已在库（任意 stage）的占比——须在保存前统计（保存后全是"已知"）
        covered = None
        if final_papers:
            try:
                from storage.search_runs import coverage_ratio
                covered = coverage_ratio(project_id, [p["paper"]["id"] for p in final_papers])
            except Exception as e:
                logger.warning(f"覆盖率统计失败（忽略）: {e}")
        saved, saved_ids = self._save(project_id, final_papers)
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
                        "step2_5_semantic": "本地语义召回",
                        "step3_rerank": "BGE 重排序",
                        "step4_scoring": "评分",
                        "step5_storage": "入库",
                    }.get(step, step),
                })

        # ── 6. 检索记录（工作台"检索记录"视图 + 收敛检测 + Retrieval Planner 快照）──
        run_id = None
        try:
            from storage.search_runs import record_search_run, link_paper_runs
            # incremental 的 year_from/to 是新增段——Run 约束快照记完整窗口（用户意图）
            run_year_from = pool_window_from if mode == "incremental" else year_from
            run_year_to = pool_window_to if mode == "incremental" else year_to
            run_id = record_search_run(
                project_id=project_id, run_type="trunk", query=user_query,
                tech_probe=tech_probe, top_k=top_k, score_threshold=score_threshold,
                total_found=len(candidates), saved_count=saved, covered_ratio=covered,
                # P1/P3：模式/状态/约束快照（Planner 决策留痕）
                mode=mode, status="done", plan_reason=plan_reason,
                year_from=run_year_from, year_to=run_year_to, methodology=methodology,
            )
            # 论文 ↔ 检索记录 多对多（Run = 独立资产快照）
            if run_id and saved_ids:
                link_paper_runs(saved_ids, run_id)
        except Exception as e:
            logger.warning(f"检索记录写入失败（忽略）: {e}")

        return {
            "expanded_queries": intent.combined_queries,
            "reasoning": intent.reasoning,
            "total_found": len(candidates),
            "after_rerank": len(results),
            "new_saved": saved,
            "survey_count": trace["step4_scoring"]["survey_count"],
            "run_id": run_id,   # 本次检索的 Run（finalize 写认知结构/结果卡时关联）
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

    def _semantic_recall(
        self,
        project_id: int,
        intent,
        candidates: List[Dict],
        semantic_limit: int = 15,
        similarity_threshold: float = 0.72,
    ) -> int:
        """
        本地语义召回：把已入库论文中语义最贴近 query 的候选并入召回池，
        与 OpenAlex 词法召回合并（按 openalex_id 去重），解决同义改写漏召回。

        副作用：合并结果写入 candidates（原 list 原地扩展）。
        返回：本次新增的语义候选数。
        """
        try:
            from storage.vector_store import (
                semantic_recall_papers, ensure_project_embeddings,
            )
            # 懒向量化：项目论文若还没 embedding 先补齐（增量，限 200 篇）
            ensure_project_embeddings(project_id, max_embed=200)
        except Exception as e:
            logger.warning(f"语义召回前置向量化失败，跳过语义召回: {e}")
            return 0

        try:
            query_text = intent.to_rerank_query()
        except Exception:
            query_text = getattr(intent, "raw_query", "") or ""

        try:
            semantic_papers = semantic_recall_papers(
                project_id=project_id,
                query_text=query_text,
                limit=semantic_limit,
                similarity_threshold=similarity_threshold,
            )
        except Exception as e:
            logger.warning(f"语义召回失败，降级为纯词法: {e}")
            return 0

        if not semantic_papers:
            return 0

        # 与词法候选合并（按 openalex_id 去重，词法优先）
        existing_ids = {c["id"] for c in candidates}
        added = 0
        for p in semantic_papers:
            if p["id"] in existing_ids:
                continue
            candidates.append(p)
            existing_ids.add(p["id"])
            added += 1
        if added:
            logger.info(f"本地语义召回新增 {added} 篇候选（共 {len(candidates)} 篇）")
        return added

    def _pool_candidates(self, project_id: int, year_from: int | None = None,
                         year_to: int | None = None,
                         methodology: str | None = None) -> List[Dict]:
        """Candidate Pool 候选：该子研究池内（stage=trunk）按窗口过滤的论文，转候选 dict。
        methodology 提供时仅保留标题/摘要命中的论文（hybrid 模式池内先筛）。"""
        from storage.mysql_db import get_session
        from storage.models import Paper

        try:
            with get_session() as session:
                q = session.query(Paper).filter(
                    Paper.project_id == project_id, Paper.stage == "trunk"
                )
                if year_from:
                    q = q.filter(Paper.year >= year_from)
                if year_to:
                    q = q.filter(Paper.year <= year_to)
                rows = q.limit(500).all()
        except Exception as e:
            logger.warning(f"池内候选加载失败（忽略）: {e}")
            return []

        kw = (methodology or "").strip().lower()
        out: List[Dict] = []
        for r in rows:
            if kw:
                blob = f"{r.title or ''} {r.abstract or ''}".lower()
                if kw not in blob:
                    continue
            out.append({
                "id": r.openalex_id, "title": r.title or "", "abstract": r.abstract or "",
                "authors": r.authors if isinstance(r.authors, list) else [],
                "year": r.year or 0, "venue": r.venue or "",
                "doi": r.doi, "cited_by_count": r.cited_by_count or 0,
                "keywords": r.keywords if isinstance(r.keywords, list) else [],
                "github_url": r.github_url,
                "source": "pool", "_routes": ["pool"], "_matched_terms": [],
            })
        return out

    @staticmethod
    def _merge_candidates(base: List[Dict], extra: List[Dict]) -> List[Dict]:
        """候选合并（按 openalex_id 去重，base 优先；extra 为池内/召回补充）"""
        seen = {c["id"] for c in base if c.get("id")}
        for c in extra:
            if not c.get("id") or c["id"] in seen:
                continue
            seen.add(c["id"])
            base.append(c)
        return base

    def _save(self, project_id: int, results: List[Dict]) -> tuple[int, list[int]]:
        """累积式原子写入：按 (project_id, openalex_id) upsert（ON CONFLICT），
        不清空旧 trunk（Candidate Pool 累积语义，Search Run 以多对多归属视图）。
        返回 (count, paper_ids) 供 paper↔run 关联。"""
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        count = 0
        paper_ids: list[int] = []
        with get_session() as session:
            for item in results:
                p = item["paper"]
                fields = {
                    "title": p.get("title", ""),
                    "authors": p.get("authors", []),
                    "year": p.get("year", 0),
                    "venue": p.get("venue", ""),
                    "doi": p.get("doi"),
                    "abstract": p.get("abstract", ""),
                    "cited_by_count": p.get("cited_by_count", 0),
                    "is_survey": item["is_survey"],
                    "stage": "trunk",
                    "trunk_score": round(item["final_score"], 2),
                    "keywords": p.get("keywords") or None,
                    "github_url": p.get("github_url") or None,
                    "recall_meta": self._build_recall_meta(p, item),
                }
                stmt = (
                    pg_insert(Paper)
                    .values(project_id=project_id, openalex_id=p["id"], **fields)
                    .on_conflict_do_update(
                        index_elements=["project_id", "openalex_id"],
                        set_=fields,
                    )
                    .returning(Paper.id)
                )
                row = session.execute(stmt).first()
                if row:
                    paper_ids.append(row[0])
                    count += 1
            session.commit()
        return count, paper_ids

    @staticmethod
    def _build_recall_meta(p: Dict, item: Dict) -> Dict:
        """逐论文召回溯源（"为什么是它"）：routes/matched_terms 来自召回打标，穿透 rerank/评分"""
        return {
            "routes": p.get("_routes") or [],
            "matched_terms": p.get("_matched_terms") or [],
            "source": p.get("source", "openalex"),
            "similarity": p.get("similarity"),
            "rerank_score": round(item["rerank_score"], 4),
        }

    # ══════════════════════════════════════════════════════════
    #  缺口补充检索（Gap Search）
    # ══════════════════════════════════════════════════════════

    # 类别 → (年份窗口, 类别语义词)
    GAP_CATEGORY_CONFIG = {
        "foundation": {
            "label": "奠基理论",
            "year_to_offset": 3,   # 只要老论文（≤ 当前年-3）
            "extra_terms": "seminal foundational classic work landmark",
        },
        "mainstream": {
            "label": "主流方法",
            "year_from_offset": 8,  # 近 8 年，且 ≤ 当前年-1
            "year_to_offset": 1,
            "extra_terms": "widely used established methods representative",
        },
        "frontier": {
            "label": "最新前沿",
            "year_from_offset": 2,  # 近 2 年
            "extra_terms": "recent advances latest emerging",
        },
    }

    def gap_search(
        self,
        project_id: int,
        user_query: str,
        target_category: str,
        tech_probe: str = "",
        user_constraint: str = "",
        per_query: int = 25,
        top_k: int = 50,
        score_threshold: float = 0.35,
        max_queries: int = 6,
    ) -> dict:
        """
        缺口补充检索：按目标类别定向检索，返回候选列表（不入库）。
        与全量 search 的区别：
          1. 类别 → 年份窗口 + 语义词（领域不变，只调年份和语义）
          2. 不删除旧数据（不重建 trunk）
          3. 候选标记 already_in_cart / already_in_db
        """
        cfg = self.GAP_CATEGORY_CONFIG.get(target_category)
        if not cfg:
            return {"error": f"未知类别: {target_category}"}

        current_year = datetime.now().year
        # 类别 → 年份窗口
        year_from, year_to = None, None
        if cfg.get("year_from_offset"):
            year_from = current_year - cfg["year_from_offset"]
        if cfg.get("year_to_offset"):
            year_to = current_year - cfg["year_to_offset"]

        # 组装检索 query：领域词 + 类别语义词 + 用户约束
        query_parts = [user_query, cfg["extra_terms"]]
        if user_constraint:
            query_parts.append(user_constraint)
        gap_query = " ".join(query_parts)

        trace = {"timing": {}, "slow_warnings": []}

        # ── 1. 意图拆解（复用 decompose，附加类别语义）──
        t0 = time.time()
        intent = self.decomposer.decompose(gap_query, tech_probe)
        t1 = time.time()
        trace["timing"]["step1_decomposition"] = round(t1 - t0, 1)
        if len(intent.combined_queries) > max_queries:
            intent.combined_queries = intent.combined_queries[:max_queries]

        # ── 2. 召回（带年份窗口）──
        self.lexical.per_query = per_query
        t0 = time.time()
        candidates = self.lexical.recall(intent, year_from=year_from, year_to=year_to)
        t1 = time.time()
        trace["timing"]["step2_recall"] = round(t1 - t0, 1)

        recall_meta = candidates[0].get("_recall_meta") if candidates else None
        if recall_meta:
            for c in candidates:
                c.pop("_recall_meta", None)
        total_found = len(candidates)

        # ── 2.5 排除回流：用户已排除的论文不进缺口候选（对话式修正，可逆） ──
        try:
            from storage.judgments import filter_excluded
            candidates, excluded_n = filter_excluded(project_id, candidates)
            trace["excluded_filtered"] = excluded_n
        except Exception as e:
            logger.warning(f"缺口排除过滤失败（忽略）: {e}")

        # ── 3. Rerank ──
        reranked = []
        if candidates:
            if self.reranker is None:
                self.reranker = ResearchReranker()
            reranked = self.reranker.rerank(intent.to_rerank_query(), candidates)

        # ── 4. 阈值过滤 + 排序 ──
        results = []
        for paper, r_score in reranked:
            if r_score < score_threshold:
                continue
            item = self.scorer.score(paper, r_score)
            results.append(item)
        results = self.scorer.sort(results)
        final_papers = results[:top_k]

        # ── 5. 查重标记 + 落库（stage=gap，不删旧数据）──
        saved = self._save_gap(project_id, target_category, final_papers)
        candidates_out = self._build_gap_candidates(
            project_id, target_category, final_papers
        )

        # ── 5.5 检索记录（gap：覆盖率 = 候选 already_in_db 占比）──
        covered = None
        if candidates_out:
            known = sum(1 for c in candidates_out if c.get("already_in_db"))
            covered = known / len(candidates_out)
        try:
            from storage.search_runs import record_search_run
            record_search_run(
                project_id=project_id, run_type="gap", query=gap_query,
                tech_probe=tech_probe, user_constraint=user_constraint,
                target_category=target_category, top_k=top_k,
                score_threshold=score_threshold,
                total_found=total_found, saved_count=len(candidates_out),
                covered_ratio=covered,
            )
        except Exception as e:
            logger.warning(f"检索记录写入失败（忽略）: {e}")

        # ── 状态判定 ──
        n = len(candidates_out)
        status = "ok" if n >= 5 else ("low_results" if n > 0 else "empty")

        return {
            "target_category": target_category,
            "candidates": candidates_out,
            "expanded_queries": intent.combined_queries,
            "reasoning": intent.reasoning,
            "total_found": total_found,
            "returned": n,
            "status": status,
            "new_saved": saved,
            "trace": trace,
        }

    def _save_gap(
        self,
        project_id: int,
        target_category: str,
        results: List[Dict],
    ) -> int:
        """缺口检索落库：stage=gap + recommended_category，不删除旧数据"""
        count = 0
        with get_session() as session:
            for item in results:
                p = item["paper"]
                existing = (
                    session.query(Paper)
                    .filter_by(openalex_id=p["id"], project_id=project_id)
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
                    stage="gap",
                    trunk_score=round(item["final_score"], 2),
                    keywords=p.get("keywords") or None,
                    github_url=p.get("github_url") or None,
                    recommended_category=target_category,
                    recall_meta=self._build_recall_meta(p, item),
                )
                session.add(db_paper)
                count += 1
        return count

    def _build_gap_candidates(
        self,
        project_id: int,
        target_category: str,
        results: List[Dict],
    ) -> List[Dict]:
        """构造候选列表：标记 已在骨架 / 已在库"""
        cfg = self.GAP_CATEGORY_CONFIG.get(target_category, {})
        label = cfg.get("label", target_category)

        cart_ids = set()
        id_by_openalex = {}   # openalex_id → paper_id（当前项目已入库的）
        with get_session() as session:
            # 当前项目骨架中的 paper_id
            cart_rows = (
                session.query(CartItem.paper_id)
                .filter_by(project_id=project_id)
                .all()
            )
            cart_ids = {r[0] for r in cart_rows}
            # 当前项目已入库论文：openalex_id → paper_id
            db_rows = (
                session.query(Paper.openalex_id, Paper.id)
                .filter_by(project_id=project_id)
                .all()
            )
            id_by_openalex = {r[0]: r[1] for r in db_rows}

        candidates = []
        for item in results:
            p = item["paper"]
            oid = p["id"]
            pid = id_by_openalex.get(oid)
            in_db = pid is not None
            in_cart = pid is not None and pid in cart_ids
            candidates.append({
                "paper_id": pid,
                "openalex_id": oid,
                "title": p.get("title", ""),
                "authors": p.get("authors", []),
                "year": p.get("year"),
                "venue": p.get("venue", ""),
                "abstract": p.get("abstract", ""),
                "cited_by_count": p.get("cited_by_count", 0),
                "is_survey": item["is_survey"],
                "keywords": p.get("keywords") or [],
                "github_url": p.get("github_url"),
                "relevance_score": round(item["rerank_score"], 4),
                "recommended_category": target_category,
                "confidence": "high" if item["rerank_score"] >= 0.6 else (
                    "medium" if item["rerank_score"] >= 0.4 else "low"),
                "reason": f"{label}补充检索候选",
                "already_in_cart": in_cart,
                "already_in_db": in_db,
            })

        return candidates

    def title_lookup(
        self,
        project_id: int,
        title: str,
        target_category: str,
    ) -> dict:
        """
        按标题直达查找（骨架补充的"标题直达"模式）：
        调 OpenAlex 按标题精确查找单篇论文，构造候选（不入库）。
        """
        from sources.openalex import search_by_title

        paper = search_by_title(title)
        if not paper:
            return {
                "target_category": target_category,
                "candidates": [],
                "expanded_queries": [],
                "reasoning": "未找到匹配标题的论文",
                "total_found": 0,
                "returned": 0,
                "status": "empty",
            }

        # 构造单个候选（复用 _build_gap_candidates 的标记逻辑）
        # 用评分结构包装：标题精确匹配视为高相关
        item = {
            "paper": {
                "id": paper.openalex_id,
                "title": paper.title,
                "abstract": paper.abstract,
                "authors": paper.authors,
                "year": paper.year,
                "venue": paper.venue,
                "doi": paper.doi,
                "cited_by_count": paper.cited_by_count,
                "keywords": paper.concepts,
                "github_url": paper.github_url,
            },
            "rerank_score": 1.0,
            "is_survey": False,
        }
        candidates = self._build_gap_candidates(project_id, target_category, [item])
        # 标题直达置信度最高
        for c in candidates:
            c["confidence"] = "high"
            c["reason"] = "按标题精确匹配"

        return {
            "target_category": target_category,
            "candidates": candidates,
            "expanded_queries": [title],
            "reasoning": f"按标题精确匹配: {title}",
            "total_found": 1,
            "returned": len(candidates),
            "status": "ok" if candidates else "empty",
        }
