import json
import logging
from typing import List

from llm import client as llm
from prompt.retrieval import DECOMPOSE_QUERY_PROMPT
from retrieval.intent import ResearchIntent, MethodologyDim, DomainDim

logger = logging.getLogger(__name__)

# 维度对象的列表型字段（安全解包 LLM 输出时用于类型归一）
_METHOD_LIST_FIELDS = {"core", "synonyms", "related"}
_DOMAIN_LIST_FIELDS = {"core", "synonyms", "broader"}


def _safe_dim(cls, data, list_fields):
    """从 LLM 返回的 dict 安全构造维度对象：缺字段用默认值、列表字段非法时归一，避免 TypeError/KeyError"""
    if not isinstance(data, dict):
        data = {}
    kwargs = {}
    for name in cls.__dataclass_fields__:
        if name in list_fields:
            v = data.get(name, [])
            kwargs[name] = v if isinstance(v, list) else ([v] if isinstance(v, str) else [])
        else:
            kwargs[name] = data.get(name, "")
    return cls(**kwargs)


class QueryDecomposer:
    """LLM 题目拆解：用户输入 → 研究意图结构化"""

    def decompose(self, user_query: str, tech_probe: str = "") -> ResearchIntent:
        prompt = DECOMPOSE_QUERY_PROMPT.format(
            user_query=user_query,
            tech_probe=tech_probe or "无"
        )
        try:
            raw = llm.chat_json(prompt)
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise ValueError("LLM 返回非字典结构")

            methodology = _safe_dim(MethodologyDim, parsed.get("methodology"), _METHOD_LIST_FIELDS)
            domain = _safe_dim(DomainDim, parsed.get("domain"), _DOMAIN_LIST_FIELDS)

            queries = parsed.get("combined_queries")
            if not isinstance(queries, list) or not queries:
                queries = [user_query]

            return ResearchIntent(
                raw_query=user_query,
                tech_probe=tech_probe,
                methodology=methodology,
                domain=domain,
                paradigm=parsed.get("paradigm", "") if isinstance(parsed.get("paradigm"), str) else "",
                combined_queries=[str(q) for q in queries if q],
                reasoning=parsed.get("reasoning", "") if isinstance(parsed.get("reasoning"), str) else "",
            )
        except Exception as e:
            # LLM 输出异常时回退到原始查询，避免整条检索 500
            logger.warning(f"QueryDecomposer 解析 LLM 输出失败，回退到原始查询: {e}")
            return ResearchIntent(
                raw_query=user_query,
                tech_probe=tech_probe,
                methodology=MethodologyDim(),
                domain=DomainDim(),
                paradigm="",
                combined_queries=[user_query],
                reasoning=f"LLM 拆解失败，使用原始查询兜底: {e}",
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