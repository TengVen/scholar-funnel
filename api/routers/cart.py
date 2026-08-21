"""
骨架清单 API —— 加入/移除/切换分类/状态查询/导出/AI分类
"""
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse

from storage import cart as cart_svc
from api.schemas import CartAddRequest, CartItemOut, CartStatusResponse
from llm import client as llm
from storage.mysql_db import get_session
from storage.models import Paper

router = APIRouter()

# AI 分类缓存：paper_id → {category, reason}
_classify_cache: dict[int, dict] = {}

# AI 分类 Prompt
CLASSIFY_PROMPT = """\
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


def _rule_fallback(paper) -> dict:
    """规则回退分类：综述或老且高被引→奠基；近2年→前沿；其余→主流"""
    current_year = datetime.now().year
    year = paper.year or 0
    cited = paper.cited_by_count or 0
    if paper.is_survey or (year < current_year - 8 and cited > 100):
        return {"category": "foundation", "reason": "综述或高被引经典工作"}
    if year >= current_year - 2:
        return {"category": "frontier", "reason": "近两年最新进展"}
    return {"category": "mainstream", "reason": "领域主流方法"}


@router.post("/classify")
def classify_paper(paper_id: int = Query(...)):
    """AI 判断论文应归入骨架的哪一分类（奠基/主流/前沿）"""
    # 缓存命中直接返回
    if paper_id in _classify_cache:
        return _classify_cache[paper_id]

    with get_session() as session:
        paper = session.get(Paper, paper_id)
        if not paper:
            raise HTTPException(404, "论文不存在")

        title = paper.title or ""
        abstract = (paper.abstract or "")[:2000]
        year = paper.year or 0
        cited = paper.cited_by_count or 0
        is_survey = paper.is_survey

    # AI 分类（失败回退规则）
    try:
        raw = llm.chat_json(
            CLASSIFY_PROMPT.format(
                title=title,
                abstract=abstract or "（无摘要）",
                year=year,
                cited_by_count=cited,
                is_survey="是" if is_survey else "否",
            ),
            temperature=0.1,
        )
        data = json.loads(raw)
        category = (data.get("category") or "").strip().lower()
        reason = (data.get("reason") or "").strip()
        if category not in ("foundation", "mainstream", "frontier"):
            raise ValueError(f"非法分类: {category}")
        result = {"category": category, "reason": reason or "AI 推荐分类"}
    except Exception:
        result = _rule_fallback(paper)

    _classify_cache[paper_id] = result
    return result


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
