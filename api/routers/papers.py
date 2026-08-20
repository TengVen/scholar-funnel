"""
论文列表 API —— 分页、筛选、排序
"""
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import desc, func

from storage.mysql_db import get_session
from storage.models import Paper, CartItem
from api.schemas import PaperOut, PaperListResponse

router = APIRouter()


@router.get("", response_model=PaperListResponse)
def list_papers(
    project_id: int = Query(..., description="项目 ID"),
    stage: str = Query("trunk", description="阶段: trunk / branch / network"),
    sort_by: str = Query("trunk_score", description="排序字段: trunk_score / cited_by_count / year"),
    sort_order: str = Query("desc", description="排序方向: asc / desc"),
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

        # 排序
        if sort_by == "cited_by_count":
            order = Paper.cited_by_count.desc() if sort_order == "desc" else Paper.cited_by_count.asc()
            q = q.order_by(order)
        elif sort_by == "year":
            order = Paper.year.desc() if sort_order == "desc" else Paper.year.asc()
            q = q.order_by(order)
        else:  # trunk_score
            if sort_order == "desc":
                q = q.order_by(func.isnull(Paper.trunk_score).asc(), desc(Paper.trunk_score))
            else:
                q = q.order_by(func.isnull(Paper.trunk_score).desc(), Paper.trunk_score.asc())

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
                in_cart=r.id in cart_ids,
            ))

    return PaperListResponse(
        papers=papers,
        total=total,
        page=page,
        page_size=page_size,
    )
