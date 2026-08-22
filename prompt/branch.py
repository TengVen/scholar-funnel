"""
prompt/branch.py 模块提示词（集中管理）
"""

# 此文件由 scripts/migrate_prompts.py 生成，后续直接在此修改

PROBE_MATCH_PROMPT = """\
你是一个学术论文方法论分析专家。请判断以下论文是否使用了用户指定的技术方法。

**技术探针**：{probe}

**论文标题**：{title}
**论文内容**（来源：{content_source}）：
{content}

请分析并输出严格 JSON：
{{
  "method_summary": "该论文使用了什么方法？100字以内",
  "probe_match": true或false,
  "probe_confidence": "high"或"medium"或"low"或"none",
  "key_findings": "与探针相关的发现，50字以内",
  "optimization_method": "具体优化/实现方式，50字以内"
}}

判断标准：
- high：论文核心方法明确使用了探针描述的技术
- medium：论文部分使用或作为对比基线使用了探针技术
- low：论文提到了探针技术但不是主要方法
- none：论文完全没有使用探针技术

"""

LANDSCAPE_PROMPT = """\
你是一个学术论文方法论分析专家。请分析以下论文的核心方法论。

**论文标题**：{title}
**论文内容**（来源：{content_source}）：
{content}

请输出严格 JSON：
{{
  "method_summary": "该论文使用了什么方法？100字以内",
  "method_category": "方法大类，如 Transformer / CNN / 优化方法 / 统计方法等",
  "key_innovation": "核心创新点，50字以内",
  "limitations": "方法局限性，50字以内（如果能判断）"
}}

"""

AI_SUGGEST_PROMPT = """\
你是一个学术论文方法论分析专家。请分析以下论文的技术方法，并推荐一个适合做进一步探针匹配的技术关键词。

**论文标题**：{title}
**论文摘要**：{abstract}

**已知技术探针**（用户可能已指定）：{existing_probe}

请输出严格 JSON：
{{
  "method_summary": "该论文使用了什么方法？100字以内",
  "suggested_probe": "推荐的探针关键词（如果用户已指定且合适，可以复用）",
  "probe_reason": "推荐理由，30字以内"
}}

"""
