from typing import List, Dict, Optional
import concurrent.futures

from sources import openalex
from retrieval.intent import ResearchIntent
from utils.log import setup_logger

logger = setup_logger("lexical")


class LexicalRetriever:
    def __init__(self, per_query: int = 50):
        self.per_query = per_query

    def _build_layered_jobs(self, intent: ResearchIntent) -> List[tuple[str, Optional[str]]]:
        """
        分层查询策略（替代单一 strict_mode 的强 AND）：

        - 核心路：methodology.core + domain.core，多个核心词 AND、每词"标题或摘要"命中
          （title.search:A|abstract.search:A,title.search:B|abstract.search:B）
          保证方向不漂移，但召回偏少。
        - 同义路：methodology.synonyms + domain.synonyms，组内 OR，扩大覆盖面。
        - 辅助路：methodology.related + domain.broader，弱约束（任一命中即可），
          兜底召回边缘相关论文，交给语义过滤。
        - 宽松路：combined_queries（LLM 拆解的主查询），不带 filter，保证召回量。

        多路分别召回 → 合并去重（recall 内）→ 最终由 Embedding + Reranker 语义过滤。
        """
        jobs: List[tuple[str, Optional[str]]] = []

        # 1. 核心概念 AND
        core_kws = list(dict.fromkeys(intent.methodology.core + intent.domain.core))
        core_kws = [kw.strip() for kw in core_kws if kw and len(kw.strip()) > 2][:3]
        if core_kws:
            filter_expr = ",".join(
                f"title.search:{openalex.filter_term(kw)}|abstract.search:{openalex.filter_term(kw)}"
                for kw in core_kws
            )
            jobs.append((" ".join(core_kws), filter_expr))

        # 2. 同义词 OR
        syn_kws = list(dict.fromkeys(intent.methodology.synonyms + intent.domain.synonyms))
        syn_kws = [kw.strip() for kw in syn_kws if kw and len(kw.strip()) > 2][:4]
        if syn_kws:
            filter_expr = "|".join(
                f"title.search:{openalex.filter_term(kw)}|abstract.search:{openalex.filter_term(kw)}"
                for kw in syn_kws
            )
            jobs.append((" ".join(syn_kws), filter_expr))

        # 3. 辅助概念弱约束（任一命中即可）
        aux_kws = list(dict.fromkeys(intent.methodology.related + intent.domain.broader))
        aux_kws = [kw.strip() for kw in aux_kws if kw and len(kw.strip()) > 2][:4]
        if aux_kws:
            filter_expr = "|".join(
                f"title.search:{openalex.filter_term(kw)}|abstract.search:{openalex.filter_term(kw)}"
                for kw in aux_kws
            )
            jobs.append((" ".join(aux_kws), filter_expr))

        # 4. 宽松路（LLM 拆解主查询，无 filter，弱约束交给 rerank 过滤）
        for q in intent.combined_queries:
            q = (q or "").strip()
            if q:
                jobs.append((q, None))

        # 同 (query, filter) 去重，避免多路重复请求
        seen = set()
        unique: List[tuple[str, Optional[str]]] = []
        for q, f in jobs:
            key = (q, f)
            if key not in seen:
                seen.add(key)
                unique.append((q, f))
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
                    q,
                    per_page=self.per_query,
                    filter_expr=f,
                    year_from=year_from,
                    year_to=year_to,
                ): (q, f)
                for q, f in jobs
            }
            for future in concurrent.futures.as_completed(futures):
                q, f = futures[future]
                try:
                    results = future.result()
                    count = len(results)
                    for p in results:
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
                        })
                    query_stats.append({
                        "query": q,
                        "mode": "strict" if f else "loose",
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
                        "count": 0,
                        "status": "failed",
                        "error": str(e)[:200],
                        "sample_title": "",
                    })

        # 合并去重（多路召回）
        seen = set()
        unique = []
        duplicate_count = 0
        for p in papers:
            if p["id"] not in seen:
                seen.add(p["id"])
                unique.append(p)
            else:
                duplicate_count += 1

        # 附加元数据到首个论文对象（pipeline 会读取）
        if unique:
            unique[0]["_recall_meta"] = {
                "query_stats": query_stats,
                "total_raw": len(papers),
                "duplicates": duplicate_count,
                "unique_count": len(unique),
            }

        return unique
