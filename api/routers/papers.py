"""
论文列表 API —— 分页、筛选、排序
"""
from fastapi import APIRouter, HTTPException, Query

from storage.mysql_db import get_session
from storage.models import Paper, CartItem
from api.schemas import PaperOut, PaperListResponse

router = APIRouter()


@router.get("", response_model=PaperListResponse)
def list_papers(
    project_id: int = Query(..., description="项目 ID"),
    stage: str = Query("trunk", description="阶段: trunk / branch / network"),
    sort_by: str = Query(
        "trunk_score",
        description="排序字段，支持逗号分隔的多级排序，如: cited_by_count,year（前级优先）",
    ),
    sort_order: str = Query(
        "desc",
        description="排序方向，支持逗号分隔与 sort_by 一一对应，如: desc,asc（缺省用首值补齐）",
    ),
    filter_survey: str = Query("all", description="筛选: all / survey / non_survey"),
    min_citations: int = Query(0, ge=0),
    page: int = Query(0, ge=0),
    page_size: int = Query(20, ge=5, le=100),
):
    """获取项目下的论文列表（分页）"""
    with get_session() as session:
        q = session.query(Paper).filter_by(project_id=project_id, stage=stage)

        # 筛选
        if filter_survey == "survey":
            q = q.filter_by(is_survey=True)
        elif filter_survey == "non_survey":
            q = q.filter_by(is_survey=False)

        if min_citations > 0:
            q = q.filter(Paper.cited_by_count >= min_citations)

        total = q.count()

        # 联合排序：sort_by / sort_order 均支持逗号分隔，两者按位置一一对应
        # 例：sort_by=cited_by_count,year & sort_order=desc,asc
        sort_fields = [s.strip() for s in sort_by.split(",") if s.strip()]
        if not sort_fields:
            sort_fields = ["trunk_score"]
        orders = [s.strip() for s in sort_order.split(",") if s.strip()]
        # 方向不足时用第一个方向补齐（兼容旧前端只传一个方向）
        if not orders:
            orders = ["desc"] * len(sort_fields)
        elif len(orders) < len(sort_fields):
            orders = orders + [orders[-1]] * (len(sort_fields) - len(orders))

        order_by_clauses = []
        for field, order in zip(sort_fields, orders):
            is_desc = order == "desc"
            if field == "cited_by_count":
                col = Paper.cited_by_count
                order_by_clauses.append(col.is_(None) if is_desc else col.isnot(None))
                order_by_clauses.append(col.desc() if is_desc else col.asc())
            elif field == "year":
                col = Paper.year
                order_by_clauses.append(col.is_(None) if is_desc else col.isnot(None))
                order_by_clauses.append(col.desc() if is_desc else col.asc())
            else:  # trunk_score（默认）
                col = Paper.trunk_score
                order_by_clauses.append(col.is_(None) if is_desc else col.isnot(None))
                order_by_clauses.append(col.desc() if is_desc else col.asc())

        if order_by_clauses:
            q = q.order_by(*order_by_clauses)

        # 分页
        rows = q.offset(page * page_size).limit(page_size).all()

        # 查询哪些论文已在骨架中
        paper_ids = [r.id for r in rows]
        cart_ids = set()
        if paper_ids:
            cart_rows = (
                session.query(CartItem.paper_id)
                .filter(CartItem.project_id == project_id, CartItem.paper_id.in_(paper_ids))
                .all()
            )
            cart_ids = {r[0] for r in cart_rows}

        papers = []
        for r in rows:
            papers.append(PaperOut(
                id=r.id,
                title=r.title,
                authors=r.authors if isinstance(r.authors, list) else [],
                year=r.year,
                venue=r.venue,
                doi=r.doi,
                arxiv_id=r.arxiv_id,
                abstract=r.abstract,
                cited_by_count=r.cited_by_count or 0,
                is_survey=r.is_survey,
                trunk_score=r.trunk_score,
                keywords=r.keywords if isinstance(r.keywords, list) else [],
                github_url=r.github_url,
                in_cart=r.id in cart_ids,
            ))

    return PaperListResponse(
        papers=papers,
        total=total,
        page=page,
        page_size=page_size,
    )
