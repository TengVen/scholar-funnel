"""
prompt/cart.py 模块提示词（集中管理）
"""

# 此文件由 scripts/migrate_prompts.py 生成，后续直接在此修改

CLASSIFY_PROMPT = """\
你是一个学术论文分类助手。根据论文信息，判断它最适合放在用户骨架清单的哪个分类。

分类说明：
1. foundation（奠基理论）
   - 定义核心问题，提出基础模型或理论框架
   - 高被引（通常被引/年 > 50）
   - 发表时间较早（但不绝对）
2. mainstream（主流方法）
   - 代表当前领域的主流技术路线
   - 通常有可复现的开源代码
   - 是领域内广泛使用或对比的 Baseline
3. frontier（最新前沿）
   - 近 2 年发表的新工作
   - 代表了新的技术趋势或范式
   - 可能还没有大量引用，但有潜力

论文信息：
- 标题：{title}
- 摘要（前 500 字）：{abstract}
- 发表年份：{year}
- 被引量：{cited_by_count}
- 是否综述：{is_survey}

请输出严格 JSON：
{{
  "suggested_category": "foundation" 或 "mainstream" 或 "frontier",
  "confidence": "high" 或 "medium" 或 "low",
  "reason": "一句话理由（20 字以内）"
}}

"""

SUMMARIZE_PROMPT = """\
你是一名学术写作专家。以下是某研究项目的文献骨架（20篇论文，按类别分组）：
{grouped}

请写一段约 200-300 字的「研究骨架综述开场段」，要求：
1. 概括本研究方向的整体轮廓：哪些奠基工作奠定基础、主流方法集中在什么方向、最新前沿在探索什么。
2. 自然引用代表性的论文标题（用引号或括号标注），不要编造不存在的论文。
3. 语言学术化、流畅，可直接作为论文综述部分的开头段落。
只输出段落本身，不要标题、不要解释。

"""

# 骨架页"加入骨架"弹窗的 AI 分类（输出 category 格式，供 api/routers/cart.py 使用）
ROUTER_CLASSIFY_PROMPT = """\
你是一名学术领域专家。判断下面这篇论文在它的研究领域中属于哪一类：

1. foundation（奠基理论）：定义核心问题或提出开创性方法的源头工作，后续研究普遍以其为基础。
2. mainstream（主流方法）：当前领域被广泛采用的技术路线，属于"大家都在用方向"的代表作。
3. frontier（最新前沿）：近两年的新趋势、新范式、新任务，代表领域探索方向。

论文信息：
标题：{title}
摘要：{abstract}
年份：{year}
被引量：{cited_by_count}
是否综述：{is_survey}

只输出 JSON（不要多余内容）：
{{"category": "foundation 或 mainstream 或 frontier", "reason": "一句话理由（30字内）"}}
"""

DIAGNOSE_PROMPT = """\
你是一个研究指导助手。用户正在用"主干-分支-网络"三层漏斗搭建文献骨架，
骨架共 20 篇，分为三类：奠基(5篇) / 主流(10篇) / 前沿(5篇)。

当前骨架的论文列表：
{items_text}

请给出诊断建议：
1. 哪类数量不足或过多？
2. 覆盖的技术方向是否有重大盲区？
3. 有什么具体的补充方向建议？

输出严格 JSON：
{{
  "verdict": "overall" | "biased" | "insufficient",
  "summary": "一句话总体评价（15字以内）",
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议补充方向1", "建议补充方向2"]
}}

"""
