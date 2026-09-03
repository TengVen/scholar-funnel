"""
prompt/reason.py —— 论文推荐理由（面向用户的自然语言模板）

规则（2026-08-30 拍板）：检索分数/匹配类型/置信度为系统内部信号，前端不得展示；
面向用户统一为"为什么推荐"的自然语言说明（模板 + 主题注入）。

2026-09-03（方案 A）：模板注入论文特征（标题/年份/被引/综述标记），
消除"同类多篇推荐理由逐字相同"——同一类别内每篇因标题等元数据不同而文案不同。
集中管理：papers 列表、详情、cognitive_structure（agents/structure.py）、本地召回共用。
"""

# ── 论文特征版模板（标题必填 → 同组每篇文案自然不同） ──
# 只引用论文元数据（标题/年份/被引/综述标记），不暴露检索分数等内部信号（E2 元数据依据级）
_TITLE_FEATURE_TEMPLATES = {
    # 奠基：综述优先，其次高被引经典
    "foundation_survey": "《{title}》{year}是覆盖「{topic}」的综述文献{cited}，适合作为入门第一篇，先建立整体研究框架。",
    "foundation": "《{title}》{year}是该领域的奠基性代表工作{cited}，适合先读，以理解「{topic}」的技术源头与核心概念。",
    "mainstream": "《{title}》{year}属于「{topic}」领域的主流代表工作{cited}，可用于把握该方向当前主导的技术路线。",
    "frontier": "《{title}》{year}是「{topic}」领域近期发表的新工作{cited}，可用于了解当前研究正在突破的技术边界。",
    # 无分类（本地语义召回等）：通用句式 + 论文特征
    "generic": "《{title}》{year}与你当前关注的「{topic}」主题高度相关{cited}，有助于建立该领域的整体研究框架。",
}

# ── 无论文特征兜底（仅当调用方不提供标题时使用，保持向后兼容） ──
_REASON_TEMPLATES = {
    "foundation": "这篇工作适合作为领域入门文献，可用于理解「{topic}」的核心概念与主要技术路线。",
    "mainstream": "这篇工作属于「{topic}」领域的主流代表工作，可用于把握该方向当前的主导技术。",
    "frontier": "该工作代表近期「{topic}」研究中的新方向，可用于了解当前研究正在突破的技术边界。",
}
_REASON_GENERIC = "与你当前关注的「{topic}」主题高度相关，并且能够帮助建立该领域的整体研究框架。"


def _snip(text: str, max_len: int = 24) -> str:
    """标题截断（太长会撑爆卡片单行展示）"""
    text = (text or "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def build_reason(
    category: str | None,
    topic: str,
    *,
    title: str = "",
    year: int | None = None,
    cited: int | None = None,
    is_survey: bool = False,
) -> str:
    """按「类别语义 + 论文特征（标题/年份/被引/综述）」生成推荐理由。

    传入 title 时输出论文事实句式（同批多篇文案各不相同）；
    未传 title（历史调用方）回退到纯类别模板（原行为）。
    """
    topic_s = (topic or "").strip().strip("\"'")[:20] or "该领域"
    t = _snip(title)

    if t:
        year_s = f"({year}年)" if year else ""
        cited_s = f"，被引 {cited:,}" if cited else ""
        if category == "foundation":
            key = "foundation_survey" if is_survey else "foundation"
        elif category in ("mainstream", "frontier"):
            key = category
        else:
            key = "generic"
        return _TITLE_FEATURE_TEMPLATES[key].format(
            title=t, year=year_s, cited=cited_s, topic=topic_s,
        )

    # 兜底：无论文特征（行为与改造前一致）
    template = _REASON_TEMPLATES.get(category or "") or _REASON_GENERIC
    return template.format(topic=topic_s)


def build_reason_demo() -> None:  # pragma: no cover - 仅本地演示
    """快速自检：同类别多篇论文应输出不同文案"""
    papers = [
        ("Deep Residual Learning for Image Recognition", 2016, 130000, False),
        ("Attention Is All You Need", 2017, 95000, False),
        ("A Survey of Visual Transformers", 2021, 4000, True),
    ]
    for cat in ("foundation", "mainstream", "frontier", None):
        print(f"--- {cat}")
        for title, year, cited, sv in papers:
            print("  ", build_reason(cat, "Transformer 架构演进", title=title, year=year, cited=cited, is_survey=sv))
