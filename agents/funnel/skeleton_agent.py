"""
骨架收敛 Agent

从主干检索的论文列表中，推荐最适合放入骨架的 20 篇论文。
推荐策略：规则引擎（被引量、年份、综述标记）+ LLM 二次排序。

职责：
1. 分析主干检索结果的分布（年份、被引量、综述比例）
2. 按 foundation/mainstream/frontier 三类分别筛选候选
3. 调用 LLM 对候选论文进行质量评估和排序
4. 输出 20 篇推荐 + 推荐理由
"""
from __future__ import annotations
import json
from datetime import datetime
from typing import Optional

from llm import client as llm
from agents.funnel.tools import (
    logger,
    summarize_paper_short,
    group_by_year,
    CATEGORY_LIMITS,
)
from agents.funnel.state import SkeletonRecommendation


# ══════════════════════════════════════════════════════════
#  主入口
# ══════════════════════════════════════════════════════════

def recommend_skeleton(
    papers: list[dict],
    max_total: int = 20,
) -> list[SkeletonRecommendation]:
    """
    从论文列表中推荐骨架论文。

    Args:
        papers: 主干检索返回的论文列表（已入库的 dict）
        max_total: 骨架上限，默认 20

    Returns:
        推荐列表，每项包含论文信息 + 推荐分类 + 理由
    """
    if not papers:
        logger.warning("论文列表为空，无法推荐骨架")
        return []

    logger.info(f"开始骨架收敛: {len(papers)} 篇论文 → 推荐 {max_total} 篇")

    # ── 第一步：规则引擎预筛选 ──
    grouped = group_by_year(papers)
    candidates = _rule_screening(grouped, max_total)
    logger.info(f"规则预筛选: {len(candidates)} 篇候选")

    # ── 第二步：LLM 精排（仅当候选 > max_total 时调用） ──
    if len(candidates) > max_total:
        candidates = _llm_rank(candidates, max_total)
        logger.info(f"LLM 精排后: {len(candidates)} 篇")

    # ── 第三步：补充到各分类上限 ──
    recommendations = _balance_categories(candidates, grouped, max_total)

    # ── 第四步：为每篇生成推荐理由 ──
    recommendations = _generate_reasons(recommendations)

    logger.info(f"骨架收敛完成: {len(recommendations)} 篇推荐")
    return recommendations


# ══════════════════════════════════════════════════════════
#  规则引擎预筛选
# ══════════════════════════════════════════════════════════

def _rule_screening(
    grouped: dict,
    max_total: int,
) -> list[dict]:
    """
    规则引擎：按被引量和年份筛选候选论文。

    策略：
    - foundation：高被引 + 年份较早的奠基性论文
    - mainstream：中等被引 + 近5-8年的主流方法
    - frontier：近2年的新工作，被引量要求较低
    """
    candidates = []

    # foundation：高被引老论文 + 综述
    foundation = sorted(
        grouped["foundation"],
        key=lambda p: p.get("cited_by_count") or 0,
        reverse=True,
    )
    # 综述优先，然后按被引量排序
    surveys = [p for p in foundation if p.get("is_survey")]
    non_surveys = [p for p in foundation if not p.get("is_survey")]
    candidates.extend(surveys[:2])  # 最多2篇综述
    candidates.extend(non_surveys[:CATEGORY_LIMITS["foundation"] - 2])

    # mainstream：按 trunk_score 排序（如果有），否则按被引量
    mainstream = sorted(
        grouped["mainstream"],
        key=lambda p: (p.get("trunk_score") or 0, p.get("cited_by_count") or 0),
        reverse=True,
    )
    candidates.extend(mainstream[:CATEGORY_LIMITS["mainstream"]])

    # frontier：近2年，按被引量降序
    frontier = sorted(
        grouped["frontier"],
        key=lambda p: p.get("cited_by_count") or 0,
        reverse=True,
    )
    candidates.extend(frontier[:CATEGORY_LIMITS["frontier"]])

    # 去重
    seen = set()
    unique = []
    for p in candidates:
        pid = p.get("paper_id") or p.get("id")
        if pid not in seen:
            seen.add(pid)
            unique.append(p)

    return unique


# ══════════════════════════════════════════════════════════
#  LLM 精排
# ══════════════════════════════════════════════════════════

RANK_PROMPT = """\
你是一个学术文献筛选专家。用户正在搭建一个研究课题的文献骨架，需要从以下候选论文中选出最值得精读的 {max_total} 篇。

选择标准（按重要性排序）：
1. 方法论创新性：是否有独特的技术路线
2. 影响力：被引量是否足够高（相对于同领域）
3. 代表性：是否代表了一类方法的典型做法
4. 时效性：是否覆盖了不同时期的工作

候选论文列表：
{papers_text}

请输出严格 JSON（只输出论文序号，不需要其他内容）：
{{
  "selected_indices": [0, 1, 3, 5, ...],
  "reasoning": "选择理由简述"
}}

注意：
- selected_indices 中的数字对应论文列表中的索引（从0开始）
- 选出恰好 {max_total} 篇
- 优先保留不同技术路线的代表性论文，避免选太多相似的论文
"""


def _llm_rank(candidates: list[dict], max_total: int) -> list[dict]:
    """当候选过多时，用 LLM 精排选出最优的 max_total 篇"""

    # 构建论文列表文本（每篇一行，带索引）
    papers_lines = []
    for i, p in enumerate(candidates):
        papers_lines.append(f"[{i}] {summarize_paper_short(p)}")
    papers_text = "\n".join(papers_lines)

    prompt = RANK_PROMPT.format(
        max_total=max_total,
        papers_text=papers_text,
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.1)
        parsed = json.loads(raw)

        selected_indices = parsed.get("selected_indices", [])
        # 过滤无效索引
        valid_indices = [i for i in selected_indices if 0 <= i < len(candidates)]

        selected = [candidates[i] for i in valid_indices[:max_total]]
        return selected

    except Exception as e:
        logger.warning(f"LLM 精排失败，回退到规则排序: {e}")
        return candidates[:max_total]


# ══════════════════════════════════════════════════════════
#  分类平衡
# ══════════════════════════════════════════════════════════

def _balance_categories(
    candidates: list[dict],
    grouped: dict,
    max_total: int,
) -> list[SkeletonRecommendation]:
    """
    确保三类论文的数量符合配额：foundation 5 / mainstream 10 / frontier 5。
    如果某一类不够，从其他类补位。
    """
    # 将候选分配到三类
    current_year = datetime.now().year
    by_category: dict[str, list[dict]] = {
        "foundation": [],
        "mainstream": [],
        "frontier": [],
    }

    for p in candidates:
        year = p.get("year") or 0
        if p.get("is_survey") or (year < current_year - 8 and (p.get("cited_by_count") or 0) > 100):
            by_category["foundation"].append(p)
        elif year >= current_year - 2:
            by_category["frontier"].append(p)
        else:
            by_category["mainstream"].append(p)

    # 按配额截取，不足的类别留空（后续由用户手动补充）
    recommendations = []
    for category, limit in CATEGORY_LIMITS.items():
        pool = by_category[category]
        for p in pool[:limit]:
            recommendations.append(SkeletonRecommendation(
                paper_id=p.get("paper_id") or p.get("id"),
                title=p.get("title", ""),
                year=p.get("year") or 0,
                cited_by_count=p.get("cited_by_count") or 0,
                venue=p.get("venue") or "",
                abstract=p.get("abstract") or "",
                suggested_category=category,
                confidence="medium",
                reason="",
                user_decision=None,
                user_category=None,
            ))

    return recommendations[:max_total]


# ══════════════════════════════════════════════════════════
#  推荐理由生成
# ══════════════════════════════════════════════════════════

REASON_PROMPT = """\
请为以下论文生成一句话推荐理由（20字以内），说明为什么这篇论文值得加入文献骨架。

论文信息：
- 标题：{title}
- 年份：{year}
- 被引量：{cited_by_count}
- 推荐分类：{category_label}
- 摘要（前200字）：{abstract}

要求：
- 简洁有力，一句话点出核心价值
- 不要重复论文标题
- 中文输出

请输出严格 JSON：
{{"reason": "推荐理由"}}
"""


def _generate_reasons(
    recommendations: list[SkeletonRecommendation],
) -> list[SkeletonRecommendation]:
    """为每篇推荐论文生成一句话推荐理由（规则 + LLM 混合）"""

    from agents.funnel.tools import CATEGORY_LABELS

    for rec in recommendations:
        paper_id = rec["paper_id"]
        category = rec["suggested_category"]
        cited = rec["cited_by_count"]
        year = rec["year"]

        # ── 规则生成理由（快速路径） ──
        if rec.get("reason"):
            # 已经有理由（比如来自 LLM 精排），跳过
            continue

        if cited > 5000:
            rec["reason"] = f"领域奠基工作，被引 {cited}+"
        elif cited > 1000:
            rec["reason"] = f"高影响力论文，被引 {cited}"
        elif year >= datetime.now().year - 1:
            rec["reason"] = "最新前沿工作"
        elif rec.get("abstract") and len(rec["abstract"]) > 100:
            # 有足够摘要时，用 LLM 生成更精准的理由
            rec["reason"] = _llm_generate_reason(rec)
        else:
            rec["reason"] = f"{CATEGORY_LABELS.get(category, '')}代表性论文"

    return recommendations


def _llm_generate_reason(rec: SkeletonRecommendation) -> str:
    """用 LLM 生成推荐理由"""
    from agents.funnel.tools import CATEGORY_LABELS

    prompt = REASON_PROMPT.format(
        title=rec["title"],
        year=rec["year"],
        cited_by_count=rec["cited_by_count"],
        category_label=CATEGORY_LABELS.get(rec["suggested_category"], ""),
        abstract=(rec.get("abstract") or "")[:200],
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.2)
        parsed = json.loads(raw)
        return parsed.get("reason", "")[:30]
    except Exception:
        return f"{CATEGORY_LABELS.get(rec['suggested_category'], '')}代表性论文"
