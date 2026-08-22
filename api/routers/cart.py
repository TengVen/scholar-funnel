"""
骨架清单 API —— 加入/移除/切换分类/状态查询/导出/AI分类
"""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from storage import cart as cart_svc
from api.schemas import CartAddRequest, CartItemOut, CartStatusResponse
from llm import client as llm
from storage.mysql_db import get_session
from storage.models import Paper, User
from utils.auth import get_current_user, get_owned_project

router = APIRouter()

# AI 分类缓存：paper_id → {category, reason}
_classify_cache: dict[int, dict] = {}

# 骨架摘要缓存：project_id → str
_summarize_cache: dict[int, str] = {}

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


@router.post("/add-by-openalex")
def add_by_openalex(
    openalex_id: str = Query(...),
    project_id: int = Query(...),
    category: str = Query("mainstream"),
    notes: str = "",
    user: User = Depends(get_current_user),
):
    """
    按 OpenAlex ID 将论文加入骨架（网络图谱推荐论文一键加入）。
    论文不在 papers 表时先从 OpenAlex 拉取入库，再复用 add 校验加入。
    """
    with get_session() as session:
        get_owned_project(session, project_id, user)
    result = cart_svc.add_by_openalex(
        project_id=project_id,
        openalex_id=openalex_id,
        category=category,
        notes=notes,
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "加入失败"))
    return result


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


# 骨架摘要 Prompt
SUMMARIZE_PROMPT = """\
你是一名学术写作专家。以下是某研究项目的文献骨架（20篇论文，按类别分组）：
{grouped}

请写一段约 200-300 字的「研究骨架综述开场段」，要求：
1. 概括本研究方向的整体轮廓：哪些奠基工作奠定基础、主流方法集中在什么方向、最新前沿在探索什么。
2. 自然引用代表性的论文标题（用引号或括号标注），不要编造不存在的论文。
3. 语言学术化、流畅，可直接作为论文综述部分的开头段落。
只输出段落本身，不要标题、不要解释。
"""


@router.post("/summarize")
def summarize_cart(project_id: int = Query(...), user: User = Depends(get_current_user)):
    """AI 生成骨架综述开场段（读骨架论文标题+类别）"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
    if project_id in _summarize_cache:
        return {"summary": _summarize_cache[project_id]}

    items = cart_svc.get_items(project_id)
    if not items:
        raise HTTPException(400, "骨架为空，无法生成摘要")

    cat_labels = {
        "foundation": "奠基理论",
        "mainstream": "主流方法",
        "frontier": "最新前沿",
    }
    grouped_lines = []
    for cat in ("foundation", "mainstream", "frontier"):
        cat_items = [it for it in items if it["category"] == cat]
        if not cat_items:
            continue
        grouped_lines.append(
            f"【{cat_labels.get(cat, cat)}】\n"
            + "\n".join(f"- {it['title']} ({it.get('year') or '?'})" for it in cat_items)
        )
    grouped_text = "\n\n".join(grouped_lines)

    try:
        summary = llm.chat(SUMMARIZE_PROMPT.format(grouped=grouped_text), temperature=0.4)
    except Exception as e:
        raise HTTPException(500, f"生成摘要失败: {str(e)}")

    _summarize_cache[project_id] = summary
    return {"summary": summary}


@router.get("", response_model=CartStatusResponse)
def get_cart(project_id: int = Query(...), user: User = Depends(get_current_user)):
    """获取项目骨架清单状态"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
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
            keywords=it.get("keywords") or [],
            github_url=it.get("github_url") or None,
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
def add_to_cart(body: CartAddRequest, user: User = Depends(get_current_user)):
    """将论文加入骨架"""
    with get_session() as session:
        get_owned_project(session, body.project_id, user)
    result = cart_svc.add(body.project_id, body.paper_id, body.category, body.notes)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result


# ── 注意：静态路由必须在 /{paper_id} 之前，否则会被 path 参数匹配 ──

@router.get("/export/bibtex")
def export_bibtex(project_id: int = Query(...), user: User = Depends(get_current_user)):
    """导出骨架 BibTeX"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
    bibtex = cart_svc.export_bibtex(project_id)
    return PlainTextResponse(
        bibtex,
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=cart_{project_id}.bib"},
    )


@router.get("/diagnose")
def diagnose(project_id: int = Query(...), user: User = Depends(get_current_user)):
    """AI 诊断骨架完整性"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
    return cart_svc.diagnose(project_id)


@router.delete("/{paper_id}")
def remove_from_cart(project_id: int, paper_id: int, user: User = Depends(get_current_user)):
    """从骨架中移除论文"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
    result = cart_svc.remove(project_id, paper_id)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result


@router.put("/{paper_id}/category")
def change_category(
    paper_id: int,
    project_id: int = Query(...),
    new_category: str = Query(...),
    user: User = Depends(get_current_user),
):
    """切换论文分类"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
    result = cart_svc.change_category(project_id, paper_id, new_category)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result
