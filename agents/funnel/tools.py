"""
漏斗编排 Agent 的共享工具函数

各 Agent 节点共用的日志、进度更新、数据加载等工具。
"""
from __future__ import annotations
from typing import Callable, Optional
from datetime import datetime

from utils.log import setup_logger

logger = setup_logger("funnel")


# ── 进度回调类型 ──
# 前端通过轮询获取进度，Agent 节点通过此回调写入状态
ProgressCallback = Callable[[str, str, dict], None]
# 参数：(stage, status, progress_detail)


def make_progress_callback(state_updater: Optional[Callable] = None) -> ProgressCallback:
    """
    创建进度回调函数。

    Args:
        state_updater: 可选的状态更新函数，用于实时更新 FunnelState

    Returns:
        进度回调函数，Agent 节点调用它来报告进度
    """
    def callback(stage: str, status: str, detail: dict):
        log_msg = f"[{stage}] {status}: {detail.get('detail', '')}"
        logger.info(log_msg)
        if state_updater:
            state_updater(stage, status, detail)
    return callback


# ── 论文数据格式化 ──

def paper_to_dict(paper) -> dict:
    """
    将数据库 Paper 对象转为字典，供 Agent 传递和前端渲染。

    Args:
        paper: SQLAlchemy Paper ORM 对象

    Returns:
        论文字典，包含所有必要字段
    """
    return {
        "paper_id": paper.id,
        "title": paper.title or "",
        "authors": paper.authors or [],
        "year": paper.year or 0,
        "venue": paper.venue or "",
        "doi": paper.doi or "",
        "arxiv_id": paper.arxiv_id or "",
        "abstract": paper.abstract or "",
        "cited_by_count": paper.cited_by_count or 0,
        "is_survey": paper.is_survey or False,
        "trunk_score": paper.trunk_score,
        "stage": paper.stage or "trunk",
    }


# ── 论文筛选工具 ──

def filter_survey_papers(papers: list[dict]) -> list[dict]:
    """从论文列表中筛选出综述论文"""
    return [p for p in papers if p.get("is_survey")]


def filter_high_cited(papers: list[dict], min_citations: int = 50) -> list[dict]:
    """筛选高被引论文"""
    return [p for p in papers if (p.get("cited_by_count") or 0) >= min_citations]


def group_by_year(papers: list[dict], current_year: int = None) -> dict:
    """
    按时间段对论文分组，用于骨架收敛时的多样性分析。

    Returns:
        {"foundation": [...], "mainstream": [...], "frontier": [...]}
    """
    if current_year is None:
        current_year = datetime.now().year

    groups = {"foundation": [], "mainstream": [], "frontier": []}
    for p in papers:
        year = p.get("year") or 0
        if year < current_year - 8:
            groups["foundation"].append(p)
        elif year < current_year - 2:
            groups["mainstream"].append(p)
        else:
            groups["frontier"].append(p)
    return groups


def summarize_paper_short(paper: dict) -> str:
    """
    生成论文的简短描述（用于 LLM prompt 中的论文列表）。

    格式："[year] title (cited: N)"
    """
    year = paper.get("year") or "?"
    title = (paper.get("title") or "")[:100]
    cited = paper.get("cited_by_count") or 0
    survey_tag = " [综述]" if paper.get("is_survey") else ""
    return f"[{year}] {title} (被引: {cited}){survey_tag}"


# ── 分类标签工具 ──

CATEGORY_LABELS = {
    "foundation": "奠基理论",
    "mainstream": "主流方法",
    "frontier": "最新前沿",
}

CATEGORY_LIMITS = {
    "foundation": 5,
    "mainstream": 10,
    "frontier": 5,
}


def get_category_label(category: str) -> str:
    """返回分类的中文标签"""
    return CATEGORY_LABELS.get(category, category)


def get_category_limit(category: str) -> int:
    """返回分类的上限数量"""
    return CATEGORY_LIMITS.get(category, 0)
