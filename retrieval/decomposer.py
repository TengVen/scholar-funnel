import json
from typing import List

from llm import client as llm
from prompt.retrieval import DECOMPOSE_QUERY_PROMPT
from retrieval.intent import ResearchIntent, MethodologyDim, DomainDim


class QueryDecomposer:
    """LLM 题目拆解：用户输入 → 研究意图结构化"""

    def decompose(self, user_query: str, tech_probe: str = "") -> ResearchIntent:
        prompt = DECOMPOSE_QUERY_PROMPT.format(
            user_query=user_query,
            tech_probe=tech_probe or "无"
        )
        raw = llm.chat_json(prompt)
        parsed = json.loads(raw)

        return ResearchIntent(
            raw_query=user_query,
            tech_probe=tech_probe,
            methodology=MethodologyDim(**parsed["methodology"]),
            domain=DomainDim(**parsed["domain"]),
            paradigm=parsed.get("paradigm", ""),
            combined_queries=parsed.get("combined_queries", [user_query]),
            reasoning=parsed.get("reasoning", "")
        )

    def expand_phrases(self, intent: ResearchIntent) -> List[str]:
        """生成 phrase-aware 检索式，保留完整学术短语"""
        queries = intent.combined_queries[:]
        # 补充精确短语变体
        if intent.methodology.core:
            queries.append(f'"{intent.methodology.core[0]}"')
        if intent.domain.core:
            queries.append(f'"{intent.domain.core[0]}"')
        return list(dict.fromkeys([q.strip() for q in queries if q.strip()]))