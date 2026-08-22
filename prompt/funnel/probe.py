"""
prompt/funnel/probe.py 模块提示词（集中管理）
"""

# 此文件由 scripts/migrate_prompts.py 生成，后续直接在此修改

DERIVE_PROBES_PROMPT = """\
你是一个学术研究方法论分析专家。用户正在研究"{user_query}"方向，
已经筛选出了一批核心论文。请分析这些论文的方法论特征，推导出
适合做进一步深挖的技术探针。

核心论文列表：
{papers_text}

请分析：
1. 这些论文主要使用了哪些核心技术/方法？
2. 有哪些共同的优化目标或损失函数？
3. 有哪些可以作为"技术探针"来深挖的关键词？

技术探针是指：用来在更大范围的论文中检索"使用了该技术的论文"的关键词。
好的探针应该是具体的学术术语，而非泛词。

请输出严格 JSON：
{{
  "probes": [
    {{
      "probe": "技术探针关键词（英文，2-4个词）",
      "description": "这个探针的含义和用途（中文，20字以内）",
      "sample_papers": ["代表论文标题1", "代表论文标题2"]
    }}
  ],
  "reasoning": "分析思路简述"
}}

注意：
- 推荐 {max_probes} 个探针
- 优先推荐具体的技术方法（如 "total variation regularization"），
  而非泛词（如 "optimization"）
- 探针应该能在 OpenAlex 中检索到相关论文

"""
