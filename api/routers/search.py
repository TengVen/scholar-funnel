"""
检索执行 API —— 主干检索（异步 task + 轮询） + 缺口补充检索
"""
import uuid
import threading
from fastapi import APIRouter, Depends, HTTPException, Query

from api.schemas import (
    SearchRequest, SearchResponse,
    GapSearchRequest, GapSearchResponse, GapCandidate,
    SemanticGapRequest, TitleLookupRequest,
    LocalSearchRequest, LocalSearchResponse, PaperOut,
)
from storage.models import User
from utils.auth import get_current_user
from utils.task_guard import acquire_or_reuse
from storage.mysql_db import get_session
from api.deps import check_project_access
from retrieval.pipeline import TrunkSearchEngine

router = APIRouter()

# 主干检索异步任务（内存存储；重启丢失，单机可接受）
_trunk_tasks: dict[str, dict] = {}


def _run_trunk_task(task_id: str, params: dict, user_id: int):
    """后台执行主干检索（30-120s），完成后写入 task 结果"""
    task = _trunk_tasks[task_id]
    try:
        engine = TrunkSearchEngine()
        result = engine.search(**params)
        task["result"] = result
        task["status"] = "done"
    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)


def _start_trunk(body: SearchRequest, user: User) -> str:
    """创建 trunk 后台 task 并启动线程，返回 task_id。"""
    task_id = uuid.uuid4().hex[:12]
    _trunk_tasks[task_id] = {
        "status": "running", "result": None, "error": None,
        "user_id": user.id, "project_id": body.project_id,
    }
    threading.Thread(
        target=_run_trunk_task,
        args=(task_id, body.model_dump(), user.id),
        daemon=True,
    ).start()
    return task_id


@router.post("/trunk")
def run_trunk_search(body: SearchRequest, user: User = Depends(get_current_user)):
    """
    启动主干检索（异步）。

    这是一个耗时操作（通常 30-120s），包含：
    1. LLM 意图拆解
    2. OpenAlex 文献召回
    3. BGE Reranker 重排
    4. 评分 + 入库

    返回 task_id，前端轮询 /trunk/status → /trunk/result。
    并发守卫：同一 project 已有 running 的 trunk task 时，复用其 task_id，
    避免快速重复点击起多个 task 同写一 project。
    """
    check_project_access(body.project_id, user)
    task_id, created = acquire_or_reuse(
        "trunk", _trunk_tasks,
        key_match=lambda t: t.get("project_id") == body.project_id,
        create=lambda: _start_trunk(body, user),
    )
    return {"task_id": task_id, "status": "started", "duplicate": not created}


@router.get("/trunk/status")
def get_trunk_status(task_id: str = Query(...), user: User = Depends(get_current_user)):
    """查询主干检索任务状态（轮询用）"""
    task = _trunk_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    if task.get("user_id") is not None and task["user_id"] != user.id:
        raise HTTPException(403, "无权访问该任务")
    return {"status": task["status"], "error": task["error"]}


@router.get("/trunk/result", response_model=SearchResponse)
def get_trunk_result(task_id: str = Query(...), user: User = Depends(get_current_user)):
    """获取主干检索结果（完成后调用）"""
    task = _trunk_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    if task.get("user_id") is not None and task["user_id"] != user.id:
        raise HTTPException(403, "无权访问该任务")
    if task["status"] == "running":
        raise HTTPException(202, "still running")
    if task["status"] == "error":
        raise HTTPException(500, task["error"])
    return SearchResponse(**task["result"])


@router.post("/gap", response_model=GapSearchResponse)
def run_gap_search(body: GapSearchRequest, user: User = Depends(get_current_user)):
    check_project_access(body.project_id, user)
    """
    缺口补充检索：按目标类别定向检索，返回候选列表（不入库）。

    与全量检索的区别：
      - 类别 → 自动换算年份窗口 + 类别语义词（领域不变）
      - 不删除旧数据（不重建 trunk）
      - 候选带 already_in_cart / already_in_db 标记
    """
    try:
        engine = TrunkSearchEngine()
        result = engine.gap_search(
            project_id=body.project_id,
            user_query=body.user_query,
            target_category=body.target_category,
            tech_probe=body.tech_probe,
            user_constraint=body.user_constraint,
            per_query=body.per_query,
            top_k=body.top_k,
            score_threshold=body.score_threshold,
            max_queries=body.max_queries,
        )
        if "error" in result:
            raise HTTPException(400, result["error"])
        # 映射候选到 schema
        result["candidates"] = [
            GapCandidate(**c) for c in result.get("candidates", [])
        ]
        return GapSearchResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"补充检索失败: {str(e)}")


@router.post("/gap-semantic", response_model=GapSearchResponse)
def run_gap_semantic(body: SemanticGapRequest, user: User = Depends(get_current_user)):
    check_project_access(body.project_id, user)
    """
    语义缺口补充：该类骨架论文的向量质心 → 项目内未入骨架论文按相似度排序。

    与 /gap（关键词版）的区别：
      - 候选来自【已入库论文】（有 embedding），找语义上最像该类的论文
      - 无 LLM 调用，纯向量计算（快、零成本）
    """
    try:
        from storage.vector_store import semantic_gap_candidates

        cands = semantic_gap_candidates(
            project_id=body.project_id,
            target_category=body.target_category,
            top_k=body.top_k,
            similarity_threshold=body.similarity_threshold,
        )
        # 需要骨架论文有 embedding 才能算质心；为空时提示先向量化
        candidates = []
        for c in cands:
            candidates.append(GapCandidate(
                paper_id=c["paper_id"],
                openalex_id="",
                title=c["title"],
                authors=c["authors"],
                year=c["year"],
                venue=c["venue"],
                abstract=c["abstract"],
                cited_by_count=c["cited_by_count"],
                similarity=c["similarity"],
                recommended_category=body.target_category,
                reason=f"语义相似度 {c['similarity']:.2f}",
                already_in_cart=False,
                already_in_db=True,
            ))
        return GapSearchResponse(
            target_category=body.target_category,
            candidates=candidates,
            expanded_queries=[],
            reasoning=f"基于「{body.target_category}」骨架论文向量质心的语义补充（{len(candidates)} 篇候选）",
            total_found=len(candidates),
            returned=len(candidates),
            status="ok" if candidates else "empty",
        )
    except Exception as e:
        raise HTTPException(500, f"语义补充检索失败: {str(e)}")


@router.post("/title", response_model=GapSearchResponse)
def run_title_lookup(body: TitleLookupRequest, user: User = Depends(get_current_user)):
    check_project_access(body.project_id, user)
    """
    按标题直达查找（骨架补充的"标题直达"模式）：
    输入论文标题 → OpenAlex 精确匹配 → 单篇候选（不入库）。
    """
    try:
        engine = TrunkSearchEngine()
        result = engine.title_lookup(
            project_id=body.project_id,
            title=body.title,
            target_category=body.target_category,
        )
        result["candidates"] = [
            GapCandidate(**c) for c in result.get("candidates", [])
        ]
        return GapSearchResponse(**result)
    except Exception as e:
        raise HTTPException(500, f"标题查找失败: {str(e)}")


@router.post("/local", response_model=LocalSearchResponse)
def search_local(body: LocalSearchRequest, user: User = Depends(get_current_user)):
    """
    本地库二次检索：对已入库论文按向量语义召回领域/技术子集。

    与 /trunk（OpenAlex 广域召回）的区别：
      - 不调用 OpenAlex，不重新入库；直接在项目内 ai_papers 上做余弦召回
      - 用于"先广域入库、再按领域聚焦精筛"的两阶段工作流
      - 返回的论文 id 为整数 DB id，可直接"加入骨架"
    """
    check_project_access(body.project_id, user)
    try:
        from storage.vector_store import semantic_recall_papers, ensure_project_embeddings

        # 懒向量化兜底：项目内尚无 embedding 的论文先补齐
        ensure_project_embeddings(body.project_id)

        raw = semantic_recall_papers(
            project_id=body.project_id,
            query_text=body.query,
            limit=body.limit,
        )

        # 排除回流：用户已排除的论文不进入本地检索结果（对话式修正，可逆）
        from storage.judgments import filter_excluded
        raw, _ = filter_excluded(body.project_id, raw)

        # 召回溯源（"为什么是它"）：读 DB 中已持久化的 recall_meta
        from api.routers.papers import _why_from_meta, _build_reason
        from storage.models import Paper as PaperModel, Project as ProjectModel
        topic = ""
        with get_session() as session:
            proj = session.get(ProjectModel, body.project_id)
            if proj:
                topic = proj.user_query or ""
        why_map = {}
        pids = [p.get("paper_id") for p in raw if p.get("paper_id")]
        if pids:
            # 论文特征（标题/年份/被引）供"为什么推荐"注入（同一批多篇文案各不相同）
            feat_by_id = {p.get("paper_id"): p for p in raw}
            with get_session() as session:
                for row in session.query(PaperModel.recall_meta, PaperModel.id).filter(
                    PaperModel.id.in_(pids)
                ).all():
                    why = _why_from_meta(row.recall_meta)
                    if why is not None:
                        feat = feat_by_id.get(row.id) or {}
                        why.reason = _build_reason(
                            None, topic,
                            title=feat.get("title") or "",
                            year=feat.get("year"),
                            cited=feat.get("cited_by_count") or 0,
                        )
                        why_map[row.id] = why

        papers = [
            PaperOut(
                id=p["paper_id"],
                title=p["title"],
                authors=p["authors"] or [],
                year=p["year"],
                venue=p.get("venue") or "",
                doi=p.get("doi"),
                arxiv_id=None,
                abstract=p.get("abstract") or "",
                cited_by_count=p.get("cited_by_count") or 0,
                is_survey=False,
                trunk_score=p.get("similarity"),
                keywords=p.get("keywords") or [],
                github_url=p.get("github_url"),
                in_cart=False,
                why=why_map.get(p.get("paper_id")),
            )
            for p in raw
        ]
        return LocalSearchResponse(
            papers=papers,
            total=len(papers),
            query=body.query,
            mode="local",
        )
    except Exception as e:
        raise HTTPException(500, f"本地检索失败: {str(e)}")


# ── 检索记录详情（检索页"已推荐"视图数据源：单 run 视角 = 认知结构 + 归属论文 + 深入探究标记）──

@router.get("/runs/{run_id}")
def get_run_detail(run_id: int, user: User = Depends(get_current_user)):
    """单个检索记录的详情：基本字段 + 归属论文（含 explored 标记）+ 核心推荐（cognitive 三分类）。
    检索页按 run 组织（「已推荐」视图 / 主列表剔除推荐）的数据源。"""
    from collections import Counter
    from storage.models import SearchRun, Paper, PaperRunLink, Project
    from storage.search_runs import collect_run_cognitive
    with get_session() as session:
        run = session.get(SearchRun, run_id)
        if run is None:
            raise HTTPException(404, "检索记录不存在")
        check_project_access(run.project_id, user)
        proj = session.get(Project, run.project_id)
        # 归属论文（run → PaperRunLink → Paper，含 explored_at 深入探究标记）
        papers: list[dict] = []
        keywords: list[str] = []
        links = session.query(PaperRunLink).filter(PaperRunLink.search_run_id == run_id).all()
        pids = [l.paper_id for l in links]
        if pids:
            rows = (
                session.query(Paper)
                .filter(Paper.id.in_(pids))
                .order_by(Paper.explored_at.desc().nullslast(), Paper.id.desc())
                .all()
            )
            cnt: Counter = Counter()
            for row in rows:
                papers.append({
                    "paper_id": row.id, "openalex_id": row.openalex_id,
                    "title": row.title, "year": row.year,
                    "stage": row.stage, "explored": row.explored_at is not None,
                })
                kws = row.keywords if isinstance(row.keywords, list) else []
                cnt.update(k for k in kws if isinstance(k, str) and k.strip())
            keywords = [k for k, _ in cnt.most_common(5)]
        cognitive = collect_run_cognitive(session, run.project_id, [run_id]).get(run_id, {})
        return {
            "id": run.id, "project_id": run.project_id,
            "project_name": proj.name if proj else "",
            "run_type": run.run_type, "query": run.query, "tech_probe": run.tech_probe,
            "user_constraint": run.user_constraint, "target_category": run.target_category,
            "total_found": run.total_found, "saved_count": run.saved_count,
            "covered_ratio": run.covered_ratio,
            "mode": run.mode, "status": run.status, "error": run.error,
            "plan_reason": run.plan_reason,
            "year_from": run.year_from, "year_to": run.year_to,
            "methodology": run.methodology, "paper_type": run.paper_type,
            "keywords": keywords, "papers": papers, "cognitive": cognitive,
            "created_at": run.created_at.isoformat() if run.created_at else None,
        }
