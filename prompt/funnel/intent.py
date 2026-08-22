"""
prompt/funnel/intent.py 模块提示词（集中管理）
"""

# 此文件由 scripts/migrate_prompts.py 生成，后续直接在此修改

SINGLE_PARSE_PROMPT = """\
你是一个学术检索意图解析专家。用户会用自然语言描述他们想研究的方向，
你需要从中提取结构化的检索参数。

用户输入：
{user_input}

当前年份：{current_year}

请分析用户输入，提取以下信息：

1. **研究方向（user_query）**：用户想研究的核心领域/问题
   - 用学术化的英文短语描述（如果用户用中文输入，翻译成英文）
   - 保留用户提到的具体技术名词

2. **技术探针（tech_probe）**：用户想深挖的具体技术/方法
   - 如果用户提到了具体的技术（如"最小二乘"、"Transformer"、"GAN"），提取出来
   - 如果用户没有提到具体技术，留空字符串

3. **方法论偏好（methodology）**：
   - "traditional"：用户明确说要传统方法
   - "deep_learning"：用户明确说要深度学习
   - "general"：没有明确偏好

4. **论文类型（paper_type）**：
   - "survey"：用户只想看综述
   - "original"：用户只想看原创论文
   - "all"：没有限制

5. **年份范围**：用户是否提到了时间限制

6. **信息完整度判断（all_complete）**：
   - true：研究方向明确，可以启动检索
   - false：信息不够，需要追问

7. **追问内容（next_question）**：
   - all_complete=false 时，用自然口语问最需要的那一个信息
   - all_complete=true 时，留空字符串

请输出严格 JSON：
{{
  "user_query": "提取的研究方向",
  "tech_probe": "提取的技术探针（没有就空字符串）",
  "methodology": "general / traditional / deep_learning",
  "paper_type": "all / survey / original",
  "year_from": null 或年份数字,
  "year_to": null 或年份数字,
  "confidence": "high / medium / low",
  "reasoning": "提取思路简述",
  "all_complete": true 或 false,
  "next_question": "追问内容"
}}

判断规则：
- user_query 为空或太模糊（如只有"论文"两个字）→ all_complete=false
- user_query 具体（如"图像修复"、"transformer在NLP中的应用"）→ all_complete=true
- tech_probe 有值时，说明用户有明确的技术方向，这是好事，不是缺失信息

"""

HISTORY_PARSE_PROMPT = """\
你是一个学术检索意图解析专家。用户正在和你对话，讨论他们想研究的方向。
请结合对话历史和最新消息，提取检索参数。

对话历史（最近几轮）：
{conversation_text}

当前年份：{current_year}

请综合对话上下文，提取以下信息：

1. **研究方向（user_query）**：用户最终确认的研究方向
2. **技术探针（tech_probe）**：用户想深挖的具体技术
3. **方法论偏好（methodology）**：general / traditional / deep_learning
4. **论文类型（paper_type）**：all / survey / original
5. **年份范围**：如果用户提到了时间限制
6. **信息完整度判断（all_complete）**：研究方向是否足够明确

请输出严格 JSON（格式同上）：
{{
  "user_query": "",
  "tech_probe": "",
  "methodology": "general",
  "paper_type": "all",
  "year_from": null,
  "year_to": null,
  "confidence": "high / medium / low",
  "reasoning": "",
  "all_complete": true 或 false,
  "next_question": ""
}}

"""
