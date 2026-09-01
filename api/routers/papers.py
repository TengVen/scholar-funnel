"""
论文 API —— 列表 / 详情页（三栏 + 三态） / L1 加入研究
路由顺序铁律：静态路由（/join-project /transient）在 /{paper_id} 之前
"""
from agents import paper_analysis as pa
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from storage.mysql_db import get_session
from storage.models import Paper, CartItem, User, Project, PaperQuestion
from api.schemas import (
    PaperOut, PaperListResponse, PaperWhy, JoinProjectRequest,
    PaperDetailOut, ExploreRequest, AskRequest, AskResponse,
)
from utils.auth import get_current_user, get_owned_project

router = APIRouter()


@router.post("/join-project")
def join_project(body: JoinProjectRequest, user: User = Depends(get_current_user)):
    """L1"加入研究"：把回答来源论文纳入项目候选（stage=candidate，不进骨架）。"""
    from storage import papers as papers_svc
    from sources import openalex as oa
    oa.set_mailto(user.email)
    with get_session() as session:
        get_owned_project(session, body.project_id, user)
    result = papers_svc.save_openalex_paper(body.project_id, body.openalex_id, stage="candidate")
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "纳入研究失败"))
    return {"ok": True, "paper_id": result["paper_id"], "created": result.get("created", False)}


def _build_reason(category: str | None, topic: str) -> str:
    """按类别模板 + 主题注入生成推荐理由（模板集中 prompt/reason.py）"""
    from prompt.reason import build_reason
    return build_reason(category, topic)


def _why_from_meta(meta) -> PaperWhy | None:
    """recall_meta → PaperWhy（含置信度分档）；无溯源数据的旧论文返回 None"""
    if not isinstance(meta, dict) or not meta:
        return None
    rerank = meta.get("rerank_score")
    confidence = None
    if isinstance(rerank, (int, float)):
        # BGE 相关度分档（与检索阈值体系一致：>0.6 高、>0.4 中、其余低）
        confidence = "high" if rerank > 0.6 else ("medium" if rerank > 0.4 else "low")
    return PaperWhy(
        routes=meta.get("routes") or [],
        matched_terms=meta.get("matched_terms") or [],
        source=meta.get("source", "openalex"),
        similarity=meta.get("similarity"),
        rerank_score=rerank,
        confidence=confidence,
    )


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
    user: User = Depends(get_current_user),
):
    """获取项目下的论文列表（分页，仅本人项目）"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
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

        # 查询哪些论文已在骨架中（含分类，供"为什么推荐"理由模板选择）
        paper_ids = [r.id for r in rows]
        cart_ids: set[int] = set()
        cart_cats: dict[int, str] = {}
        if paper_ids:
            cart_rows = (
                session.query(CartItem.paper_id, CartItem.category)
                .filter(CartItem.project_id == project_id, CartItem.paper_id.in_(paper_ids))
                .all()
            )
            cart_ids = {r[0] for r in cart_rows}
            cart_cats = {r[0]: r[1] for r in cart_rows}

        # 主题（推荐理由模板注入）：project.user_query 为核心主题
        topic = ""
        proj = session.get(Project, project_id)
        if proj:
            topic = proj.user_query or ""

        papers = []
        for r in rows:
            why = _why_from_meta(r.recall_meta)
            if why is not None:
                # 分类优先取骨架分类，其次 gap 推荐分类；均无则通用模板
                category = cart_cats.get(r.id) or r.recommended_category
                why.reason = _build_reason(category, topic)
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
                why=why,
            ))

    return PaperListResponse(
        papers=papers,
        total=total,
        page=page,
        page_size=page_size,
    )


# ══════════════════════════════════════════════════════════
#  论文详情页（三栏 + 三态：Transient / Candidate / Research Asset）
# ══════════════════════════════════════════════════════════

def _is_arxiv_pdf(work) -> bool:
    """该论文是否可站内 PDF 预览：仅 arXiv 域名的 oa_pdf_url（产品约定非 arXiv 不考虑）"""
    if not work or not work.oa_pdf_url:
        return False
    from sources.pdf_cache import is_arxiv_url
    return is_arxiv_url(work.oa_pdf_url)


def _pdf_file_exists(openalex_id: str) -> bool:
    """本地已有 PDF 文件（上传补全 / 缓存下载过）即可站内预览——不限于 arXiv"""
    from sources.pdf_cache import get_pdf_path
    return get_pdf_path(openalex_id) is not None


def _mark_explored(paper_id: int, project_id: int) -> None:
    """深入探究标记：explore 触发即写 explored_at（工作台"论文集合"已探究标注，L1→L2/L2/L3 均算）"""
    try:
        from sqlalchemy import func
        with get_session() as session:
            session.query(Paper).filter(
                Paper.id == paper_id, Paper.project_id == project_id
            ).update({Paper.explored_at: func.now()})
            session.commit()
    except Exception:
        pass  # 标记失败不阻塞探究链路


def _analysis_state(project_id: int, openalex_id: str, paper: Paper | None) -> dict:
    """分析就绪状态：运行中 → DB 落库（L3）→ 内存缓存（L2 预热）→ 无。

    运行中最优先（2026-08-31 修复）：重算时旧缓存/旧落库仍是 done，若不先判 running，
    会遮蔽新任务——前端轮询第一次就拿到旧结果提前终止（"重新分析"显示旧摘要结果）。
    """
    from agents import paper_analysis as pa

    task = pa.get_task(project_id, openalex_id)
    if task and task["status"] == "running":
        return {"status": "running"}
    if paper is not None and paper.paper_analysis:
        return {"status": "done", "source": "db", "content": paper.paper_analysis}
    cached = pa.get_cached(project_id, openalex_id)
    if cached and cached.get("result"):
        result = cached["result"]
        return {
            "status": "done", "source": "cache",
            "content": result.get("analysis"),
            "sections": result.get("sections"),
            "material_type": result.get("material_type", "摘要"),
        }
    return {"status": "none"}


def _detail_out(mode: str, work, paper: Paper | None,
                project_id: int | None, topic: str,
                why: PaperWhy | None = None, judgment: dict | None = None,
                cart_category: str | None = None) -> PaperDetailOut:
    """组装详情聚合（work=OpenAlex 数据；paper=项目库行，可为 None=transient）"""
    openalex_id = (paper.openalex_id if paper else work.openalex_id) if (paper or work) else ""
    analysis = _analysis_state(project_id, openalex_id, paper) if project_id else {"status": "none"}
    sections = None
    if paper is not None and paper.sections:
        sections = pa.normalize_sections(paper.sections)
    if not sections and analysis.get("sections"):
        sections = pa.normalize_sections(analysis["sections"])
    has_analysis = analysis.get("status") == "done"
    return PaperDetailOut(
        mode=mode,
        paper_id=paper.id if paper else None,
        openalex_id=openalex_id,
        title=(paper.title if paper else work.title) or "",
        authors=(paper.authors if paper and isinstance(paper.authors, list) else (work.authors if work else [])),
        year=(paper.year if paper else work.year) if (paper or work) else None,
        venue=(paper.venue if paper else work.venue) or "",
        doi=(paper.doi if paper else work.doi) if (paper or work) else None,
        arxiv_id=(paper.arxiv_id if paper else work.arxiv_id) if (paper or work) else None,
        abstract=(paper.abstract if paper else work.abstract) if (paper or work) else "",
        cited_by_count=(paper.cited_by_count if paper else work.cited_by_count) or 0,
        github_url=(paper.github_url if paper else work.github_url) if (paper or work) else None,
        keywords=((paper.keywords if paper else work.concepts) or []) if isinstance((paper.keywords if paper else work.concepts), list) else [],
        is_oa=(work.is_oa if work else False),
        oa_pdf_url=(work.oa_pdf_url if work else None),
        oa_landing_url=(work.oa_landing_url if work else None),
        pdf_available=bool(_is_arxiv_pdf(work)) or _pdf_file_exists(openalex_id),
        in_project=paper is not None,
        stage=paper.stage if paper else None,
        in_cart=bool(cart_category),
        category=cart_category,
        why=why,
        judgment=judgment,
        sections=sections,
        analysis=analysis,
        actions={
            "can_explore": not has_analysis and (paper is None or paper.stage != "candidate"),
            "can_ask": has_analysis,
        },
    )


@router.get("/transient")
def get_transient_paper(openalex_id: str = Query(...),
                        project_id: int | None = Query(None, description="可选：回查该项目库内是否已收录（paper_id/分析状态）"),
                        user: User = Depends(get_current_user)):
    """transient 浏览态：OpenAlex 实时拉取元数据，不落库。
    传 project_id 时回查库内行：若该论文已在该项目落库（曾加入研究/深入探究过），
    返回真实 paper_id 与既有分析状态（落库与显示不冲突，L1 也能看到已分析结果）。"""
    from sources import openalex as oa
    oa.set_mailto(user.email)
    work = oa.get_work_by_id(openalex_id)
    if not work:
        raise HTTPException(404, "OpenAlex 未找到该论文")
    paper = None
    topic = ""
    if project_id:
        with get_session() as session:
            get_owned_project(session, project_id, user)
            paper = (
                session.query(Paper)
                .filter_by(project_id=project_id, openalex_id=openalex_id)
                .first()
            )
            proj = session.get(Project, project_id)
            if proj:
                topic = proj.user_query or ""
    return _detail_out(mode="transient", work=work, paper=paper,
                       project_id=project_id, topic=topic)


@router.get("/pdf")
def get_pdf(openalex_id: str = Query(...), user: User = Depends(get_current_user)):
    """详情页"原文 PDF"预览：本地文件（上传补全/已缓存）直接返回；
    否则仅 arXiv 域名可下载（同源代理避免 X-Frame-Options 拦截）。"""
    from sources import openalex as oa
    from sources.pdf_cache import get_pdf_path, download_pdf

    oa.set_mailto(user.email)
    # 1) 本地文件优先（用户上传的 PDF 不限于 arXiv）
    local = get_pdf_path(openalex_id)
    if local:
        return FileResponse(local, media_type="application/pdf")
    # 2) 未上传 → 仅 arXiv 走下载缓存
    work = oa.get_work_by_id(openalex_id)
    pdf_url = work.oa_pdf_url if work else None
    if not _is_arxiv_pdf(work):
        return PlainTextResponse("该论文无 PDF（可在详情页上传补全）", status_code=404)
    path = download_pdf(openalex_id, pdf_url)
    if not path:
        return PlainTextResponse("PDF 获取失败，请稍后重试或前往 arXiv", status_code=502)
    return FileResponse(path, media_type="application/pdf")


@router.post("/upload")
async def upload_pdf(paper_id: int = Form(...), project_id: int = Form(...),
                     file: UploadFile = File(...), user: User = Depends(get_current_user)):
    """上传 PDF 补全全文（非 arXiv / 无 PDF 论文）：
    落盘 data/pdfs/{openalex_id}.pdf → 自动触发全文级重算（本地文件优先命中）→ 详情页中栏 PDF 预览可用。
    上传是显式动作：persist=True 分析完成直接落库（推进 L3 资产）。"""
    from sources.pdf_cache import save_pdf_bytes

    with get_session() as session:
        get_owned_project(session, project_id, user)
        paper = session.get(Paper, paper_id)
        if not paper or paper.project_id != project_id:
            raise HTTPException(404, "论文不存在")
        openalex_id = paper.openalex_id
        title, abstract = paper.title or "", paper.abstract or ""
        year, cited = paper.year, paper.cited_by_count or 0
        proj = session.get(Project, project_id)
        topic = (proj.user_query if proj else "") or ""

    data = await file.read()
    path = save_pdf_bytes(openalex_id, data)
    if not path:
        raise HTTPException(400, "文件校验失败：仅接受 1KB - 25MB 的 PDF 文件")

    r = pa.start_analysis(
        project_id, openalex_id, title, abstract, year, cited,
        user_query=topic, persist=True, paper_id=paper_id,
    )
    return {"paper_id": paper_id, "status": r["status"], "task_id": r["task_id"]}


@router.post("/explore")
def explore_openalex(body: ExploreRequest, user: User = Depends(get_current_user)):
    """深入探究（transient 无 paper_id 模式）：按 openalex_id 落库 candidate（幂等，转 L2）+ 触发单篇分析。
    persist=True 时分析完成直接落库（L3 资产）。返回 {paper_id, status, task_id}。"""
    from storage import papers as papers_svc
    from agents import paper_analysis as pa

    if not body.openalex_id:
        raise HTTPException(400, "缺少 openalex_id")
    with get_session() as session:
        get_owned_project(session, body.project_id, user)

    result = papers_svc.save_openalex_paper(body.project_id, body.openalex_id, stage="candidate")
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "纳入研究候选失败"))
    paper_id = result["paper_id"]
    _mark_explored(paper_id, body.project_id)

    title, abstract, year, cited, topic = "", "", None, 0, ""
    with get_session() as session:
        paper = session.get(Paper, paper_id)
        proj = session.get(Project, body.project_id)
        if paper:
            title, abstract = paper.title or "", paper.abstract or ""
            year, cited = paper.year, paper.cited_by_count or 0
        if proj:
            topic = proj.user_query or ""

    r = pa.start_analysis(
        body.project_id, body.openalex_id, title, abstract, year, cited,
        user_query=topic, persist=body.persist, paper_id=paper_id,
    )
    return {"paper_id": paper_id, "status": r["status"], "task_id": r["task_id"]}


@router.get("/{paper_id}/explore")
def explore_paper(paper_id: int, project_id: int = Query(...),
                  persist: bool = Query(False, description="L3 直接落库：分析完成即写 paper_analysis"),
                  user: User = Depends(get_current_user)):
    """深入探究（transient → candidate）：落库 + 触发该篇单点分析预热"""
    from storage import papers as papers_svc
    from agents import paper_analysis as pa

    with get_session() as session:
        get_owned_project(session, project_id, user)
        paper = session.get(Paper, paper_id)
        if not paper or paper.project_id != project_id:
            raise HTTPException(404, "论文不存在")

    # 触发分析预热（幂等）：先从 OpenAlex 取 oa_pdf_url（全文获取用）
    from sources import openalex as oa
    oa.set_mailto(user.email)
    work = oa.get_work_by_id(paper.openalex_id)
    pdf_url = work.oa_pdf_url if work else None

    # candidate 落库（幂等，stage 提升防 trunk 重建回收）
    papers_svc.save_openalex_paper(project_id, paper.openalex_id, stage="candidate")
    # 深入探究标记（explore 触发即算已探究）
    _mark_explored(paper_id, project_id)

    topic = ""
    with get_session() as session:
        proj = session.get(Project, project_id)
        if proj:
            topic = proj.user_query or ""

    r = pa.start_analysis(
        project_id, paper.openalex_id, paper.title, paper.abstract or "",
        paper.year, paper.cited_by_count or 0, user_query=topic, oa_pdf_url=pdf_url,
        persist=persist, paper_id=paper_id,
    )
    return {"status": r["status"], "task_id": r["task_id"]}


@router.get("/{paper_id}/analysis/status")
def analysis_status(paper_id: int, project_id: int = Query(...), user: User = Depends(get_current_user)):
    """分析状态轮询（前端 useTaskPolling）"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
        paper = session.get(Paper, paper_id)
        if not paper or paper.project_id != project_id:
            raise HTTPException(404, "论文不存在")
    return _analysis_state(project_id, paper.openalex_id, paper)


@router.get("/{paper_id}/analysis/result")
def analysis_result(paper_id: int, project_id: int = Query(...), user: User = Depends(get_current_user)):
    """分析结果（缓存/落库统一返回）"""
    with get_session() as session:
        get_owned_project(session, project_id, user)
        paper = session.get(Paper, paper_id)
        if not paper or paper.project_id != project_id:
            raise HTTPException(404, "论文不存在")
    return _analysis_state(project_id, paper.openalex_id, paper)


@router.post("/{paper_id}/ask", response_model=AskResponse)
def ask_paper(paper_id: int, body: AskRequest, user: User = Depends(get_current_user)):
    """
    详情页单篇问答（四问之四落地详情页）：
    分析就绪 → 落库转 Research Asset（L2→L3）→ 基于分节/摘要回答 + 原文引用回溯。
    """
    from agents import paper_analysis as pa

    with get_session() as session:
        get_owned_project(session, body.project_id, user)
        paper = session.get(Paper, paper_id)
        if not paper or paper.project_id != body.project_id:
            raise HTTPException(404, "论文不存在")
        topic = ""
        proj = session.get(Project, body.project_id)
        if proj:
            topic = proj.user_query or ""

    state = _analysis_state(body.project_id, paper.openalex_id, paper)
    if state["status"] != "done":
        # 未就绪 → 触发预热，返回 202（前端轮询后再问）
        from sources import openalex as oa
        oa.set_mailto(user.email)
        work = oa.get_work_by_id(paper.openalex_id)
        pa.start_analysis(
            body.project_id, paper.openalex_id, paper.title, paper.abstract or "",
            paper.year, paper.cited_by_count or 0, user_query=topic,
            oa_pdf_url=(work.oa_pdf_url if work else None),
        )
        return AskResponse(answer="分析准备中，请稍后再问", citations=[])

    # ── 落库（L2 → L3）：paper_analysis + sections 持久化（全文级升级覆盖旧摘要级）──
    content = state.get("content")
    cached = pa.get_cached(body.project_id, paper.openalex_id)
    with get_session() as session:
        paper = session.get(Paper, paper_id)
        if paper:
            cached_result = (cached or {}).get("result") or {}
            cached_sections = cached_result.get("sections") or []
            full_text = bool(cached_sections)
            if full_text or paper.paper_analysis is None:
                paper.paper_analysis = content
            if full_text or paper.sections is None:
                paper.sections = cached_sections or None

    answer, citations = _answer_question(paper, body.question, topic)

    with get_session() as session:
        session.add(PaperQuestion(
            project_id=body.project_id, paper_id=paper_id,
            question=body.question, answer=answer, citations=citations or None,
        ))
    return AskResponse(answer=answer, citations=citations)


def _answer_question(paper: Paper, question: str, topic: str = "") -> tuple[str, list]:
    """基于分节（或摘要）回答 + 引用回溯（citations: [{section, snippet}]）"""
    from llm import client as llm
    from agents import paper_analysis as pa

    sections = pa.normalize_sections(paper.sections)
    if sections:
        material = "\n\n".join(f"[{s['heading']}]\n{s['content']}" for s in sections)
        material_type = "全文分节"
    else:
        material = paper.abstract or ""
        material_type = "摘要"

    prompt = f"""\
你是学术论文精读助手。基于论文材料回答用户问题。

论文：{paper.title}（{paper.year or '未知'}）
研究课题：{topic or '未设定'}

论文材料（{material_type}）：
{material[:20000] if material else '（无材料）'}

用户问题：{question}

请严格输出 JSON：
{{
  "answer": "回答（200字以内，只依据材料，材料没有的明确说'论文中未见'）",
  "citations": [
    {{"section": "对应章节标题（摘要级问答填'摘要'；无依据则空）", "snippet": "支撑原文片段（≤120字）"}}
  ]
}}
"""
    try:
        raw = llm.chat_json(prompt)
        import json as _json
        parsed = _json.loads(raw) if isinstance(raw, str) else raw
        return parsed.get("answer", ""), parsed.get("citations") or []
    except Exception as e:
        return f"回答生成失败：{e}", []


@router.get("/{paper_id}")
def get_paper_detail(paper_id: int, project_id: int = Query(...), user: User = Depends(get_current_user)):
    """项目论文详情聚合（三态读取入口）"""
    from storage import judgments

    with get_session() as session:
        get_owned_project(session, project_id, user)
        paper = session.get(Paper, paper_id)
        if not paper or paper.project_id != project_id:
            raise HTTPException(404, "论文不存在")
        topic = ""
        proj = session.get(Project, project_id)
        if proj:
            topic = proj.user_query or ""
        why = _why_from_meta(paper.recall_meta)
        if why is not None:
            why.reason = _build_reason(paper.recommended_category, topic)
        judgment = None
        for j in judgments.list_judgments(project_id):
            if j["paper_id"] == paper_id:
                judgment = {"action": j["action"], "reason": j["reason"]}
                break
        cart_category = None
        cart_row = (
            session.query(CartItem.category)
            .filter_by(project_id=project_id, paper_id=paper_id)
            .first()
        )
        if cart_row:
            cart_category = cart_row[0]
        # OpenAlex 补充（oa 链接/PDF），失败静默
        from sources import openalex as oa
        oa.set_mailto(user.email)
        work = oa.get_work_by_id(paper.openalex_id)
    return _detail_out(
        mode="project", work=work, paper=paper, project_id=project_id, topic=topic,
        why=why, judgment=judgment, cart_category=cart_category,
    )
