"""
agents/structure.py —— L2 认知结构（结构化归纳）

v0（2026-08-30）：规则三层分组——对项目内已入库的主干论文（stage=trunk）按
"奠基/主流/前沿"分组。T10 地图归纳（LLM）落地后替换为数据驱动版本，本模块
输出 schema（topic/total_candidates/selected_count/foundation/mainstream/frontier）
保持不变，前端契约不随实现升级变化。

规则（复用骨架分类判定）：
- foundation：综述 或（年份 < 当前-8 且被引 > 100）
- frontier：年份 >= 当前-2
- mainstream：其余
"""
from datetime import datetime

from storage.mysql_db import get_session
from storage.models import Paper
from prompt.reason import build_reason
from utils.log import setup_logger

logger = setup_logger("structure")

# 每类展示上限（核心推荐论文；超出部分留在候选池，经"查看全部"探索）
_PER_CATEGORY_LIMIT = 10


def build_cognitive_structure(
    project_id: int,
    topic: str = "",
    total_candidates: int | None = None,
    limit: int = 50,
) -> dict:
    """
    基于项目内主干论文生成三层认知结构（v0 规则版）。

    Args:
        project_id: 项目
        topic: 研究主题（推荐理由注入）
        total_candidates: 本次检索候选结果池总数（无则用已入库数）
        limit: 参与分组的论文上限（按 trunk_score 取前 N）

    Returns:
        {topic, total_candidates, selected_count,
         foundation: [..], mainstream: [..], frontier: [..]}
        每项论文: {paper_id, title, year, cited_by_count, suggested_category, reason}
    """
    current_year = datetime.now().year

    with get_session() as session:
        rows = (
            session.query(Paper)
            .filter(Paper.project_id == project_id, Paper.stage == "trunk")
            .order_by(Paper.trunk_score.desc().nullslast())
            .limit(limit)
            .all()
        )

    groups: dict[str, list[dict]] = {"foundation": [], "mainstream": [], "frontier": []}
    for r in rows:
        if r.is_survey or (r.year and r.year < current_year - 8 and (r.cited_by_count or 0) > 100):
            cat = "foundation"
        elif r.year and r.year >= current_year - 2:
            cat = "frontier"
        else:
            cat = "mainstream"
        if len(groups[cat]) >= _PER_CATEGORY_LIMIT:
            continue
        groups[cat].append({
            "paper_id": r.id,
            "title": r.title,
            "year": r.year,
            "cited_by_count": r.cited_by_count or 0,
            "suggested_category": cat,
            # 论文特征注入：同类别内每篇因标题/年份/被引不同而文案不同（2026-09-03）
            "reason": build_reason(
                cat, topic,
                title=r.title or "",
                year=r.year,
                cited=r.cited_by_count or 0,
                is_survey=bool(r.is_survey),
            ),
        })

    selected = sum(len(v) for v in groups.values())
    if total_candidates is None:
        total_candidates = len(rows)

    logger.info(
        f"认知结构 v0: project={project_id} 选中 {selected} / 候选 {total_candidates} "
        f"(奠基{len(groups['foundation'])}/主流{len(groups['mainstream'])}/前沿{len(groups['frontier'])})"
    )
    return {
        "topic": topic or "",
        "total_candidates": total_candidates,
        "selected_count": selected,
        **groups,
    }
