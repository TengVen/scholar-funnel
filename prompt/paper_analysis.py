"""
prompt/paper_analysis.py —— 论文深度分析（详情页 AI 研究助手右栏）

L2/L3 共用同一套分析能力（2026-08-30 共识：L2 = L3 的预热）。
输出六区块（除研究脉络为规则生成外，均由本 prompt 一次 LLM 调用产出）：
  一句话理解 / 核心贡献 / 方法框架 / 实验结论 / 与当前研究的关系 / 摘要学术化总结
证据纪律：只依据给定文本（全文分节或摘要），不给到的内容显式标注"未见"，
不编造（呼应产品原则 §十一 E1/E4：推测与事实永不混排）。
"""

ANALYSIS_PROMPT = """\
你是学术论文深度分析助手。基于给定的论文材料（全文分节或摘要），生成结构化深度分析。

论文信息：
- 标题：{title}
- 年份：{year}
- 被引：{cited_by_count}
- 当前研究课题（用于"与当前研究的关系"）：{user_query}

论文材料（{material_type}）：
{material}

请严格输出 JSON（只输出 JSON，不要其他内容）：
{{
  "summary": "摘要学术化总结（200-350字，正式学术语气，覆盖问题/方法/结果/意义）",
  "quick_understand": "一句话理解（40字以内）：这篇论文解决什么问题？",
  "core_contributions": [
    "① 提出了……",
    "② 解决了……",
    "③ 在……上取得了……"
  ],
  "method_framework": {{
    "pipeline": ["输入", "模块 A", "模块 B", "输出"],
    "text": "方法框架文字描述（200字以内，按处理流程叙述）",
    "evidence": [
      {{"section": "支撑方法描述的论文章节名称（如 3 Method；无则空字符串）", "description": "关键原文证据，100字以内"}}
    ]
  }},
  "experiments": {{
    "datasets": ["数据集1", "数据集2"],
    "baseline": "对比基线（如无明确基线填'未见明确基线'）",
    "ours": "本文方法的表现要点",
    "gains": "相对基线的提升（如无定量数据填'未见定量对比'）",
    "notes": "实验可信度备注（数据可得性/局限性，如无则空字符串）",
    "evidence": [
      {{"section": "支撑实验结论的论文章节名称（如 4.1 ALFWorld；无则空字符串）", "description": "关键原文证据，100字以内"}}
    ]
  }},
  "relation_to_research": {{
    "topic": "当前研究课题",
    "related_directions": ["关联方向1（如 记忆系统进化）", "关联方向2"],
    "potential_contribution": "这篇论文可作为哪个方向的代表性工作/可借鉴点（一句话）"
  }}
}}

要求：
- 只依据给定材料，材料中没有的信息标注"未见"或留空，绝不编造；
- 核心贡献用"①…②…③…"列表，最多 4 条；
- experiments 若无实验数据，datasets/baseline/ours/gains 填"未见实验数据"；
- evidence 必须来自材料中真实存在的章节（全文分节时 method_framework/experiments 各给 0-2 条关键锚点）；仅摘要材料时 evidence 填空数组；summary/quick_understand/relation_to_research 不给 evidence；
- 中文输出。
"""


def build_analysis_prompt(title, year, cited_by_count, user_query, material, material_type="摘要") -> str:
    return ANALYSIS_PROMPT.format(
        title=title or "",
        year=year or "未知",
        cited_by_count=cited_by_count or 0,
        user_query=(user_query or "未设定").strip()[:60],
        material_type=material_type,
        material=material[:24000] if material else "（无材料，请标注'未见'）",
    )
