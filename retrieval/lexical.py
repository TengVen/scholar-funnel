from typing import List, Dict
import concurrent.futures

from sources import openalex
from retrieval.intent import ResearchIntent
from utils.log import setup_logger

logger = setup_logger("lexical")


class LexicalRetriever:
    def __init__(self, per_query: int = 50):
        self.per_query = per_query

    def recall(
        self,
        intent: ResearchIntent,
        year_from: int | None = None,
        year_to: int | None = None,
    ) -> List[dict]:
        papers = []
        queries = intent.combined_queries

        # 每查询词详细结果（用于 UI 展示）
        query_stats = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = {
                executor.submit(
                    openalex.search_works,
                    q,
                    per_page=self.per_query,
                    strict_mode=True,
                    year_from=year_from,
                    year_to=year_to,
                ): q
                for q in queries
            }
            for future in concurrent.futures.as_completed(futures):
                q = futures[future]
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
                        "count": count,
                        "status": "success",
                        "error": None,
                        "sample_title": results[0].title[:50] if results else "",
                    })
                except Exception as e:
                    logger.warning(f"Recall failed for '{q}': {e}")
                    query_stats.append({
                        "query": q,
                        "count": 0,
                        "status": "failed",
                        "error": str(e)[:200],
                        "sample_title": "",
                    })

        # 去重
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