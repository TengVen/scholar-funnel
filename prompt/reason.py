"""
prompt/reason.py —— 论文推荐理由（面向用户的自然语言模板）

规则（2026-08-30 拍板）：检索分数/匹配类型/置信度为系统内部信号，前端不得展示；
面向用户统一为"为什么推荐"的自然语言说明（模板 + 主题注入）。
集中管理，papers.py 列表与 cognitive_structure（agents/structure.py）共用。
"""

_REASON_TEMPLATES = {
    "foundation": "这篇工作适合作为领域入门文献，可用于理解「{topic}」的核心概念与主要技术路线。",
    "mainstream": "这篇工作属于「{topic}」领域的主流代表工作，可用于把握该方向当前的主导技术。",
    "frontier": "该工作代表近期「{topic}」研究中的新方向，可用于了解当前研究正在突破的技术边界。",
}
_REASON_GENERIC = "与你当前关注的「{topic}」主题高度相关，并且能够帮助建立该领域的整体研究框架。"


def build_reason(category: str | None, topic: str) -> str:
    """按类别模板 + 主题注入生成推荐理由（无类别用通用模板）"""
    topic = (topic or "").strip().strip("\"'")[:20] or "该领域"
    template = _REASON_TEMPLATES.get(category or "") or _REASON_GENERIC
    return template.format(topic=topic)
