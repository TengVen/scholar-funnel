"""
骨架清单 API —— 加入/移除/切换分类/状态查询/导出
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse

from storage import cart as cart_svc
from api.schemas import CartAddRequest, CartItemOut, CartStatusResponse

router = APIRouter()


@router.get("", response_model=CartStatusResponse)
def get_cart(project_id: int = Query(...)):
    """获取项目骨架清单状态"""
    items_data = cart_svc.get_items(project_id)
    counts = cart_svc.get_counts(project_id)
    total = sum(counts.values())

    items = [
        CartItemOut(
            cart_id=it["cart_id"],
            paper_id=it["paper_id"],
            category=it["category"],
            title=it["title"],
            authors=it.get("authors") or [],
            year=it.get("year"),
            venue=it.get("venue"),
            doi=it.get("doi"),
            arxiv_id=it.get("arxiv_id"),
            abstract=it.get("abstract"),
            cited_by_count=it.get("cited_by_count", 0),
            is_survey=it.get("is_survey", False),
            notes=it.get("notes", ""),
            added_at=it.get("added_at", ""),
        )
        for it in items_data
    ]

    return CartStatusResponse(
        items=items,
        counts=counts,
        total=total,
        full=total >= 20,
    )


@router.post("")
def add_to_cart(body: CartAddRequest):
    """将论文加入骨架"""
    result = cart_svc.add(body.project_id, body.paper_id, body.category, body.notes)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result


# ── 注意：静态路由必须在 /{paper_id} 之前，否则会被 path 参数匹配 ──

@router.get("/export/bibtex")
def export_bibtex(project_id: int = Query(...)):
    """导出骨架 BibTeX"""
    bibtex = cart_svc.export_bibtex(project_id)
    return PlainTextResponse(
        bibtex,
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=cart_{project_id}.bib"},
    )


@router.get("/diagnose")
def diagnose(project_id: int = Query(...)):
    """AI 诊断骨架完整性"""
    return cart_svc.diagnose(project_id)


@router.delete("/{paper_id}")
def remove_from_cart(project_id: int, paper_id: int):
    """从骨架中移除论文"""
    result = cart_svc.remove(project_id, paper_id)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result


@router.put("/{paper_id}/category")
def change_category(
    paper_id: int,
    project_id: int = Query(...),
    new_category: str = Query(...),
):
    """切换论文分类"""
    result = cart_svc.change_category(project_id, paper_id, new_category)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result
