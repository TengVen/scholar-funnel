from typing import List, Dict
import concurrent.futures

from sources import openalex
from retrieval.intent import ResearchIntent
from utils.log import setup_logger

logger = setup_logger("lexical")


class LexicalRetriever:
    def __init__(self, per_query: int = 50):
        self.per_query = per_query

    def _build_layered_jobs(self, intent: ResearchIntent) -> List[dict]:
        """
        分层查询策略（替代单一 strict_mode 的强 AND）：

        - 核心路(core)：methodology.core + domain.core，多个核心词 AND、每词命中标题/摘要/全文
          （default.search:"A",default.search:"B"，逗号=AND，词可在 title/abstract/fulltext 任一出现）
          保证方向不漂移，但召回偏少。
        - 同义路(synonym)：methodology.synonyms + domain.synonyms，组内 OR（值内 | 合法），扩大覆盖面。
        - 辅助路(aux)：methodology.related + domain.broader，弱约束（任一命中即可），
          兜底召回边缘相关论文，交给语义过滤。
        - 宽松路(loose)：combined_queries（LLM 拆解的主查询），不带 filter，保证召回量。

        每个任务携带 route（召回路径名）与 terms（该路检索词，供逐论文溯源打标）。

        filter 语法约束（OpenAlex）：
          - `,` = AND（同字段重复合法）；`|` 只允许在「单个 filter 值内部」做 OR
            （如 default.search:"A"|"B"），filter 与 filter 之间不允许 OR（否则 400）。
          历史 bug（2026-08-26 修复）：原写法 title.search:A|abstract.search:A 是
            filter 间 OR → OpenAlex 400 Bad Request。
        """
        jobs: List[dict] = []

        # 1. 核心概念 AND（多词逗号 AND，每词在 title/abstract/fulltext 任一命中）
        core_kws = list(dict.fromkeys(intent.methodology.core + intent.domain.core))
        core_kws = [kw.strip() for kw in core_kws if kw and len(kw.strip()) > 2][:3]
        if core_kws:
            filter_expr = ",".join(
                f"default.search:{openalex.filter_term(kw)}" for kw in core_kws
            )
            jobs.append({"route": "core", "query": " ".join(core_kws), "filter": filter_expr, "terms": core_kws})

        # 2. 同义词 OR（值内 |，字段前缀只出现一次）
        syn_kws = list(dict.fromkeys(intent.methodology.synonyms + intent.domain.synonyms))
        syn_kws = [kw.strip() for kw in syn_kws if kw and len(kw.strip()) > 2][:4]
        if syn_kws:
            filter_expr = "default.search:" + "|".join(
                openalex.filter_term(kw) for kw in syn_kws
            )
            jobs.append({"route": "synonym", "query": " ".join(syn_kws), "filter": filter_expr, "terms": syn_kws})

        # 3. 辅助概念弱约束（任一命中即可，值内 |）
        aux_kws = list(dict.fromkeys(intent.methodology.related + intent.domain.broader))
        aux_kws = [kw.strip() for kw in aux_kws if kw and len(kw.strip()) > 2][:4]
        if aux_kws:
            filter_expr = "default.search:" + "|".join(
                openalex.filter_term(kw) for kw in aux_kws
            )
            jobs.append({"route": "aux", "query": " ".join(aux_kws), "filter": filter_expr, "terms": aux_kws})

        # 4. 宽松路（LLM 拆解主查询，无 filter，弱约束交给 rerank 过滤）
        for q in intent.combined_queries:
            q = (q or "").strip()
            if q:
                jobs.append({"route": "loose", "query": q, "filter": None, "terms": [q]})

        # 同 (query, filter) 去重，避免多路重复请求
        seen = set()
        unique: List[dict] = []
        for job in jobs:
            key = (job["query"], job["filter"])
            if key not in seen:
                seen.add(key)
                unique.append(job)
        return unique

    def recall(
        self,
        intent: ResearchIntent,
        year_from: int | None = None,
        year_to: int | None = None,
    ) -> List[dict]:
        papers = []
        jobs = self._build_layered_jobs(intent)

        # 每路查询详细结果（用于 UI 展示）
        query_stats = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = {
                executor.submit(
                    openalex.search_works,
                    job["query"],
                    per_page=self.per_query,
                    filter_expr=job["filter"],
                    year_from=year_from,
                    year_to=year_to,
                ): job
                for job in jobs
            }
            for future in concurrent.futures.as_completed(futures):
                job = futures[future]
                q, f = job["query"], job["filter"]
                route = job["route"]
                terms = job.get("terms") or []
                try:
                    results = future.result()
                    count = len(results)
                    for p in results:
                        # 逐论文溯源：该路召回 + 检索词在标题/摘要中的朴素命中
                        #（OpenAlex default.search 还可能命中全文，此时 matched_terms 为空、routes 仍记录）
                        blob = f"{p.title or ''} {p.abstract or ''}".lower()
                        matched = [t for t in terms if t.lower() in blob]
                        papers.append({
                            "id": p.openalex_id,
                            "title": p.title,
                            "abstract": p.abstract,
                            "authors": p.authors,
                            "year": p.year,
                            "venue": p.venue,
                            "doi": p.doi,
                            "cited_by_count": p.cited_by_count,
                            "keywords": p.concepts,
                            "github_url": p.github_url,
                            "source": "openalex",
                            "_routes": [route],
                            "_matched_terms": matched,
                        })
                    query_stats.append({
                        "query": q,
                        "mode": "strict" if f else "loose",
                        "route": route,
                        "count": count,
                        "status": "success",
                        "error": None,
                        "sample_title": results[0].title[:50] if results else "",
                    })
                except Exception as e:
                    logger.warning(f"Recall failed for '{q}' (filter={f}): {e}")
                    query_stats.append({
                        "query": q,
                        "mode": "strict" if f else "loose",
                        "route": route,
                        "count": 0,
                        "status": "failed",
                        "error": str(e)[:200],
                        "sample_title": "",
                    })

        # 合并去重（多路召回）：路由与命中词取并集（一篇论文被多路召回时保留全部溯源）
        by_id: Dict[str, dict] = {}
        unique: List[dict] = []
        duplicate_count = 0
        for p in papers:
            pid = p["id"]
            if pid in by_id:
                merged = by_id[pid]
                for r in p["_routes"]:
                    if r not in merged["_routes"]:
                        merged["_routes"].append(r)
                for t in p["_matched_terms"]:
                    if t not in merged["_matched_terms"]:
                        merged["_matched_terms"].append(t)
                duplicate_count += 1
            else:
                by_id[pid] = p
                unique.append(p)

        # 附加元数据到首个论文对象（pipeline 会读取）
        if unique:
            unique[0]["_recall_meta"] = {
                "query_stats": query_stats,
                "total_raw": len(papers),
                "duplicates": duplicate_count,
                "unique_count": len(unique),
            }

        return unique
