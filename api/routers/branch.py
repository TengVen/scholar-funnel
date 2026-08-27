"""
Branch analysis API - background task + polling
"""
import uuid
import threading
from fastapi import APIRouter, Depends, HTTPException, Query

from api.schemas import BranchAnalyzeRequest, BranchAnalyzeResponse, BranchPaperResultOut
from agents import branch as branch_svc

from storage.models import User
from utils.auth import get_current_user, get_owned_project
from utils.task_guard import acquire_or_reuse
from storage.mysql_db import get_session

router = APIRouter()

def _check(project_id: int, user: User):
    """校验项目归属（用户隔离）+ 设置 OpenAlex 礼貌邮箱（用户邮箱优先，否则默认）"""
    from sources import openalex as oa
    oa.set_mailto(user.email)
    with get_session() as session:
        get_owned_project(session, project_id, user)



_tasks: dict[str, dict] = {}


def _serialize(r: branch_svc.BranchPaperResult) -> BranchPaperResultOut:
    return BranchPaperResultOut(
        paper_id=r.paper_id, title=r.title, authors=r.authors,
        year=r.year, venue=r.venue, doi=r.doi, abstract=r.abstract,
        cited_by_count=r.cited_by_count, category=r.category,
        content_level=r.content_level,
        content_source=r.content_source,         method_summary=r.method_summary,
        probe_match=r.probe_match, probe_confidence=r.probe_confidence,
        key_findings=r.key_findings, optimization_method=r.optimization_method,
        usage_role=r.usage_role,
        implementation_or_application=r.implementation_or_application,
        probe_relation=r.probe_relation,
        research_question=r.research_question,
        methodology_type=r.methodology_type,
        method_category=r.method_category,
        method_components=r.method_components,
        research_design=r.research_design,
        key_innovation=r.key_innovation,
        limitations=r.limitations,
        evidence=r.evidence,
        error=r.error,
    )


def _run_task(task_id: str, project_id: int, mode: str, probe: str, category: str = ""):
    task = _tasks[task_id]
    try:
        def on_progress(current, total, title):
            task["current"] = current
            task["total"] = total
            task["detail"] = title

        results = branch_svc.run_analysis(
            project_id=project_id, mode=mode, probe=probe, category=category,
            on_progress=on_progress,
        )
        level_dist: dict[str, int] = {}
        for r in results:
            src = f"L{r.content_level} ({r.content_source})"
            level_dist[src] = level_dist.get(src, 0) + 1

        task["result"] = BranchAnalyzeResponse(
            results=[_serialize(r) for r in results],
            total=len(results), mode=mode, level_distribution=level_dist,
        )
        task["status"] = "done"
    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)


def _start_branch(body: BranchAnalyzeRequest, user: User) -> str:
    """创建 branch 后台 task 并启动线程，返回 task_id。"""
    task_id = uuid.uuid4().hex[:12]
    _tasks[task_id] = {
        "status": "running", "current": 0, "total": 0,
        "detail": "", "result": None, "error": None,
        "project_id": body.project_id, "user_id": user.id,  # 归属校验用
        "mode": body.mode, "category": body.category,        # 并发守卫匹配用
    }
    threading.Thread(
        target=_run_task,
        args=(task_id, body.project_id, body.mode, body.probe, body.category),
        daemon=True,
    ).start()
    return task_id


@router.post("/analyze")
def start_branch_analyze(body: BranchAnalyzeRequest, user: User = Depends(get_current_user)):
    _check(body.project_id, user)
    if body.mode == "probe_match" and not body.probe:
        raise HTTPException(400, "probe_match mode requires a probe")
    # 并发守卫：同一 (project, mode, category) 已有 running task 时复用其 task_id，
    # 避免快速重复点击起多个 task 同写一 project。
    task_id, created = acquire_or_reuse(
        "branch", _tasks,
        key_match=lambda t: t.get("project_id") == body.project_id
                        and t.get("mode") == body.mode
                        and t.get("category", "") == body.category,
        create=lambda: _start_branch(body, user),
    )
    return {"task_id": task_id, "status": "started", "duplicate": not created}


def _assert_task_owner(task: dict, user: User):
    """校验 task 归属：仅创建者本人可查询/取结果"""
    if task.get("user_id") is not None and task["user_id"] != user.id:
        raise HTTPException(403, "无权访问该任务")


@router.get("/status")
def get_branch_status(task_id: str = Query(...), user: User = Depends(get_current_user)):
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    _assert_task_owner(task, user)
    return {
        "status": task["status"], "current": task["current"],
        "total": task["total"], "detail": task["detail"],
        "error": task["error"],
    }


@router.get("/result", response_model=BranchAnalyzeResponse)
def get_branch_result(task_id: str = Query(...), user: User = Depends(get_current_user)):
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    _assert_task_owner(task, user)
    if task["status"] == "running":
        raise HTTPException(202, "still running")
    if task["status"] == "error":
        raise HTTPException(500, task["error"])
    return task["result"]


@router.get("/results", response_model=BranchAnalyzeResponse)
def get_branch_results(
    project_id: int = Query(...),
    mode: str = Query("", description="按分析模式过滤: probe_match/ai_suggest/landscape，空=全部"),
    user: User = Depends(get_current_user),
):
    _check(project_id, user)
    results = branch_svc.get_stored_results(project_id, mode)
    level_dist: dict[str, int] = {}
    for r in results:
        src = f"L{r.content_level} ({r.content_source})"
        level_dist[src] = level_dist.get(src, 0) + 1
    return BranchAnalyzeResponse(
        results=[_serialize(r) for r in results],
        total=len(results), mode=mode or "stored", level_distribution=level_dist,
    )
