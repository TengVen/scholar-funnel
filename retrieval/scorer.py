import math
from datetime import datetime
from typing import List, Dict


class ResearchScorer:
    def __init__(self):
        self.current_year = datetime.now().year

    def score(self, paper: dict, rerank_score: float) -> dict:
        # 相关性绝对主导
        relevance = rerank_score * 1000

        # 被引量非线性衰减
        cite = paper.get("cited_by_count", 0)
        cite_score = 100 * (1 - math.exp(-cite / 300)) if cite > 0 else 0

        # 时效
        year = paper.get("year", 0)
        age = self.current_year - year if year > 0 else 10
        recency = max(0, 30 - age * 3)

        # 综述惩罚
        title = (paper.get("title") or "").lower()
        is_survey = any(k in title for k in [
            "a survey", "a review", "an overview",
            "systematic review", "literature review",
            "state-of-the-art", "comprehensive survey"
        ])
        survey_penalty = 0.3 if is_survey else 1.0

        final = (relevance + cite_score * 0.5 + recency) * survey_penalty

        return {
            "paper": paper,
            "rerank_score": rerank_score,
            "final_score": final,
            "is_survey": is_survey,
        }

    def sort(self, scored_items: List[dict]) -> List[dict]:
        scored_items.sort(key=lambda x: x["final_score"], reverse=True)
        return scored_items