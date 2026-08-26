"""
prompt/branch.py 模块提示词（集中管理）

三大 Prompt：
  - PAPER_PROFILE_PROMPT  论文方法学画像（领域/研究类型/方法论范式，论文级共享上下文）
  - LANDSCAPE_PROMPT     全景扫描：发现论文的方法体系（跨领域、9 维 + evidence）
  - PROBE_MATCH_PROMPT   技术探针匹配：方法语义匹配 + usage_role + evidence

设计原则（跨领域）：
  - 不预设计算机领域，不写死 Transformer/CNN/优化方法（仅作示例）。
  - 区分方法实际使用角色（core/auxiliary/baseline/comparison/mentioned/none）。
  - probe_match 由业务层按 usage_role 统一计算，不让 LLM 自由决定 true/false。
  - 必须输出 evidence，回答"为什么判定论文使用了该方法"。
  - 不把 Related Work / References 中提及的方法当作论文实际使用。
"""


# ── AI 探针推荐（保持原样，未参与跨领域重构）──
AI_SUGGEST_PROMPT = """\
你是一个学术论文方法论分析专家。请分析以下论文的技术方法，并推荐一个适合做进一步探针匹配的技术关键词。

**论文标题**：{title}
**论文摘要**：{abstract}

**已知技术探针**（用户可能已指定）：{existing_probe}

请输出严格 JSON：
{{
  "method_summary": "该论文使用了什么方法？200字以内",
  "suggested_probe": "推荐的探针关键词（如果用户已指定且合适，可以复用）",
  "probe_reason": "推荐理由，30字以内"
}}

"""# ── 论文方法学画像（PaperProfile）──
PAPER_PROFILE_PROMPT = """\
你是一个跨学科的学术论文分类专家。请仅根据论文标题和摘要，判断该论文的研究方法学画像。
不要重新处理整篇论文，也不要猜测摘要中无法支撑的内容。

**论文标题**：{title}
**论文摘要**：{abstract}

请输出严格 JSON：
{{
  "research_domain": "主要研究领域，例如 Computer Science / Medicine / Economics / Materials Science / Biology / Psychology / Sociology 等；无法确定用空字符串",
  "subdomain": "更具体的子领域，例如 Natural Language Processing / Oncology / Labor Economics / Computational Materials；不确定用空字符串",
  "research_type": "研究性质，例如 algorithmic / clinical / experimental / observational / theoretical / empirical / econometric / qualitative / survey / simulation / review / mixed_methods；不止一种可逗号组合；不确定用空字符串",
  "methodology_type": "主要研究方法论范式，例如 deep learning / randomized controlled trial / difference-in-differences / density functional theory / case study；不确定用空字符串",
  "research_objects": ["核心研究对象1", "核心研究对象2"],
  "candidate_method_families": ["论文中可能存在的方法族或关键技术1", "论文中可能存在的方法族或关键技术2"]
}}

判断原则：
- 不预设计算机领域，所有学科一视同仁。
- 不要为了填字段而猜测；信息不足时用空字符串或空数组。
- research_objects / candidate_method_families 只列出摘要中确有依据的项。
- 严格输出 JSON，不要 Markdown，不要解释，不要代码块。
"""

# ── 全景扫描（Landscape）──
LANDSCAPE_PROMPT = """\
你是一个跨学科的学术论文方法论分析专家。请分析这篇论文"是如何开展研究、如何解决问题、如何验证结论的"（不是判断某一个指定方法）。

**论文标题**：{title}
**论文领域画像**：
{profile}
**论文内容**（来源：{content_source}）：
{content}

请输出严格 JSON：
{{
  "research_question": "论文试图解决的核心问题，200字以内",
  "methodology_type": "主要研究方法论类型（与领域画像一致，例如 深度学习 / 随机对照试验 / 双重差分 / 第一性原理计算 / 案例研究 等）",
  "method_summary": "200字以内概括论文解决问题的主要方法和技术路线",
  "method_category": "核心方法所属的大类或方法体系（不要限定为 Transformer/CNN，应跨领域，例如 序列建模 / 因果推断 / 材料制备与表征 / 质性编码 / 数值仿真 等）",
  "method_components": ["具体方法或技术1", "具体方法或技术2"],
  "research_design": "实验、临床、统计、仿真、理论证明或其他验证设计，100字以内",
  "key_innovation": "核心创新或主要贡献，100字以内；若论文无明确创新填\\"未明确说明\\"",
  "limitations": "论文明确说明或正文可靠判断的方法局限性，100字以内；若没有填\\"未明确说明\\"",
  "evidence": [
    {{"section": "论文章节名称（如 3 Method；无章节则空字符串）", "description": "支持方法识别的关键证据，100字以内"}}
  ]
}}

判断原则：
- 不预设计算机领域，不要求论文必须有"模型""算法""优化"。
- 允许理论论文没有实验、医学论文以临床研究设计为核心、经济学以计量识别策略为核心、材料论文以制备与表征为核心、社科以调查/案例/质性为核心。
- 不要把 Related Work / Background / References 中提及或对比的方法，误认为论文实际采用的方法。
- 不要把创新/局限强行生成；没有就填"未明确说明"。
- evidence 必须来自提供给你的论文内容，不要编造章节名称；若只有摘要则 section 填空字符串。
- 严格输出 JSON，不要 Markdown，不要解释，不要代码块。
"""

# ── 技术探针匹配（Probe Match）──
PROBE_MATCH_PROMPT = """\
你是一个跨学科的学术论文方法论分析专家。请判断以下论文是否"实际使用了"用户指定的技术方法（技术探针），以及该方法在论文中的使用角色。

**技术探针**：{probe}
**论文标题**：{title}
**论文领域画像**：
{profile}
**论文内容**（来源：{content_source}）：
{content}

请分析并输出严格 JSON：
{{
  "usage_role": "core 或 auxiliary 或 baseline 或 comparison 或 mentioned 或 none",
  "confidence": "high 或 medium 或 low 或 none",
  "method_summary": "200字以内概括论文实际采用的主要研究方法或技术路线",
  "probe_relation": "说明探针与论文方法之间的具体关系，100字以内",
  "key_findings": "与探针直接相关的主要发现、实验结果或应用结论，100字以内",
  "implementation_or_application": "说明该方法具体如何被实现、应用、实验或分析，100字以内（跨领域示例：AI=LoRA微调；医学=Cox回归；经济=DID+固定效应；材料=CVD制备+XRD表征；生物=RNA-seq+差异表达分析；社科=问卷+SEM）",
  "evidence": [
    {{"section": "论文中的章节名称（如 3 Method；无章节则空字符串）", "description": "支持当前判断的关键证据，100字以内"}}
  ]
}}

usage_role 定义：
- core：探针是论文核心研究方法或核心技术。
- auxiliary：探针被实际使用，但不是核心方法。
- baseline：探针作为基线方法使用。
- comparison：探针主要用于对比实验、方法比较或参照。
- mentioned：论文提及、讨论、引用该方法，但没有实际使用。
- none：没有足够证据表明论文使用或实质性讨论该方法。

判断原则（方法语义匹配，而非关键词匹配）：
- 必须进行语义理解。例如探针"参数高效微调"且论文使用 LoRA，则 usage_role=core；探针"Transformer"且论文仅以 CNN 为主、在 Related Work 讨论 Transformer，则 usage_role=mentioned。
- 方法族关系不等于自动匹配：探针是方法族（如 Transformer）而论文用其下属具体方法（如 BERT）可视为存在方法族关系，但仍须结合论文真实使用情况判断；不要因为关键词出现就判定使用。
- 不要把 Related Work / Background / References 中提及的方法当作实际使用。
- confidence 必须以提供给你的论文内容为依据：high=正文有直接明确证据；medium=证据较明确但有不确定性；low=只有弱相关证据；none=无有效证据。"模型知道这个方法通常是什么"不算论文证据。
- evidence 必须来自论文内容，不要编造章节名称；只有摘要时 section 填空字符串。
- 不要输出 probe_match 字段，是否匹配由系统按 usage_role 统一计算。
- 严格输出 JSON，不要 Markdown，不要解释，不要代码块。
"""
