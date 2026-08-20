"""
Prompt 模板集中管理 —— 所有与 LLM 交互的提示词统一存放
"""

# ──────────────────────────────────────────
#  Stage 1: 主干检索
# ──────────────────────────────────────────

EXPAND_QUERY_PROMPT = """\
你是一个学术文献检索专家。用户给出了一个研究方向描述，请帮助扩展出适合在学术数据库中检索的英文关键词组合。

要求：
1. 提取核心概念，给出同义词、近义词、上位词、下位词
2. 考虑不同学科对同一概念的不同术语表达
3. 生成 5-10 组检索词（英文），每组 1-4 个词
4. 按相关性从高到低排列

用户的研究方向：
{user_query}

用户的技术探针（如有）：
{tech_probe}

请严格以 JSON 格式返回：
{{
  "core_concepts": ["概念1", "概念2", ...],
  "search_queries": [
    "query string 1",
    "query string 2",
    ...
  ],
  "reasoning": "简要说明你的扩展思路"
}}
"""

IDENTIFY_SURVEY_PROMPT = """\
请判断以下论文是否是一篇综述论文（Survey / Review / Overview）。

判断依据：
1. 标题中是否包含 survey, review, overview, tutorial, comprehensive, state-of-the-art 等词
2. 摘要中是否描述了"对多种方法的总结和比较"
3. 被引量是否显著高于同领域平均水平

论文信息：
- 标题：{title}
- 摘要：{abstract}
- 被引量：{cited_by_count}
- 发表年份：{year}

请严格以 JSON 格式返回：
{{
  "is_survey": true或false,
  "confidence": "high"或"medium"或"low",
  "reason": "简要说明判断理由"
}}
"""

GENERATE_TAXONOMY_PROMPT = """\
你是一个学术领域专家。根据以下论文标题和摘要列表，生成该领域的技术分类图（Taxonomy）。

论文列表：
{papers_text}

用户的研究方向：{user_query}

请识别出该领域的主要技术分支和子方向，以结构化的分类树形式返回。

请严格以 JSON 格式返回：
{{
  "domain": "领域名称",
  "branches": [
    {{
      "name": "分支名称",
      "description": "简要描述",
      "sub_branches": ["子方向1", "子方向2"],
      "representative_papers": ["论文标题1", "论文标题2"]
    }}
  ],
  "summary": "领域总体概述（2-3句话）"
}}
"""

DECOMPOSE_QUERY_PROMPT = """
你是一个高级学术检索与研究方向分析助手。

你的任务是：
对用户输入的论文题目、研究方向、摘要片段或技术描述进行"方法论（Methodology）"与"应用领域（Domain）"的结构化拆解，用于：

- 学术论文检索
- 向量召回
- query expansion
- related work 搜索
- 研究方向归类
- 技术路线分析

你必须像资深 researcher 一样识别：
- 论文真正的方法学核心
- 隐含的技术路线
- 所属任务类型
- 所在行业/应用场景
- 可扩展的相关术语

--------------------------------------------------
【拆解原则】
--------------------------------------------------

# 一、方法论（Methodology）

方法论不是简单关键词提取，而是：

"论文主要依赖什么技术路线解决问题"

你需要识别：

## 1. 核心方法（core）
必须提取：
- 最核心的方法学概念
- 论文创新主要所在
- 标题中真正的技术主体

例如：
- contrastive learning
- diffusion model
- graph neural network
- transformer
- representation learning
- causal inference
- reinforcement learning

要求：
- 优先英文
- 使用标准学术术语
- 不要过度泛化
- 最多 3~6 个

---

## 2. 同义词 / 变体（synonyms）

需要扩展：
- 缩写
- 近义表达
- 常见论文写法
- 社区常用别名

例如：
contrastive learning ->
[
  "self-supervised learning",
  "metric learning",
  "InfoNCE"
]

transformer ->
[
  "attention mechanism",
  "self-attention"
]

---

## 3. 相关技术（related）

这里不是同义词。

而是：
"与该方法经常共同出现的技术栈"

例如：
contrastive learning 相关：
- representation learning
- feature disentanglement
- augmentation
- latent space learning

diffusion model 相关：
- score matching
- denoising
- generative modeling

要求：
- 能帮助扩展检索
- 偏 research-neighbor
- 不要纯泛词

--------------------------------------------------
# 二、应用领域（Domain）
--------------------------------------------------

Domain 表示：

"该方法被应用到什么问题/行业/任务"

不是简单行业名。

需要同时识别：

- 具体任务
- 数据类型
- 应用场景
- 行业方向

---

## 1. 核心领域（core）

例如：
- wind power forecasting
- image restoration
- recommendation system
- medical diagnosis
- fault detection
- traffic prediction

要求：
- 尽量具体
- 优先任务级别
- 不要只写 "energy"

---

## 2. 同义词 / 变体（synonyms）

例如：
wind power forecasting ->
[
  "wind energy forecasting",
  "wind turbine power prediction",
  "renewable energy forecasting"
]

---

## 3. 上位概念（broader）

表示更宽泛的研究方向。

例如：
wind power forecasting ->
[
  "time series forecasting",
  "AI for energy",
  "smart grid"
]

image restoration ->
[
  "computer vision",
  "image processing"
]

--------------------------------------------------
# 三、隐式推断（非常重要）
--------------------------------------------------

你必须具备"研究论文语义理解能力"。

不要只做字符串匹配。

例如：

"trend-fluctuation representations"
应推断：
- time-series decomposition
- frequency decomposition
- disentangled representation

"interpretable contrastive learning"
应推断：
- self-supervised learning
- explainable AI
- interpretable representation learning

"data-augmented"
应推断：
- data augmentation
- augmentation strategy

--------------------------------------------------
# 四、combined_queries 生成规则
--------------------------------------------------

你必须生成适用于：

- Semantic Scholar
- OpenAlex
- arXiv
- Google Scholar
- 向量数据库

的高质量检索 query。

要求：

1. 每个 query 必须同时包含：
   - 方法词
   - 领域词

2. query 必须像真实 researcher 会搜索的内容

3. 不要生成垃圾组合

错误示例：
- "deep learning energy"
- "AI prediction"

正确示例：
- "contrastive learning for wind power forecasting"
- "interpretable representation learning in renewable energy forecasting"
- "trend fluctuation decomposition for time series forecasting"

4. 至少生成 6~12 个 query

5. query 尽量：
- 自然
- 学术化
- 可直接检索

--------------------------------------------------
# 五、输出要求
--------------------------------------------------

严格返回 JSON。

不要输出 markdown。
不要输出解释性前缀。
不要输出 ```json。
不要遗漏字段。

返回格式：

{{
  "methodology": {{
    "core": [],
    "synonyms": [],
    "related": []
  }},
  "domain": {{
    "core": [],
    "synonyms": [],
    "broader": []
  }},
  "combined_queries": [],
  "paper_style": {{
    "research_type": "",
    "technical_paradigm": "",
    "likely_models": [],
    "likely_tasks": []
  }},
  "reasoning": ""
}}

--------------------------------------------------
# 六、额外增强分析（新增）
--------------------------------------------------

你还需要识别：

## research_type
例如：
- methodological paper
- application-driven paper
- system paper
- theoretical paper

## technical_paradigm
例如：
- self-supervised learning
- generative modeling
- time-series representation learning
- multimodal learning

## likely_models
推测可能使用：
- Transformer
- TCN
- LSTM
- GNN
- diffusion backbone

## likely_tasks
例如：
- forecasting
- classification
- anomaly detection
- representation learning

--------------------------------------------------
# 七、特殊规则
--------------------------------------------------

1. 如果 query 只有方法论，没有应用领域：
- domain.core = []
- combined_queries 只使用方法论

2. 如果 query 只有领域，没有明确方法：
- methodology.core = []
- 尝试推断常见方法

3. 优先英文术语。

4. 不要输出空泛词：
禁止：
- AI
- neural network
- prediction
- optimization

除非它们真的是核心。

5. reasoning 需要简要说明：
- 你如何识别方法论
- 如何识别领域
- 哪些是隐式推断

--------------------------------------------------
用户研究方向：
{user_query}

底层技术探针：
{tech_probe}
"""