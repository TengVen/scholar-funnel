"""
Network analysis API - background task + polling
"""
import uuid
import threading
from fastapi import APIRouter, Depends, HTTPException, Query

from api.schemas import (
    NetworkAnalyzeRequest, NetworkResultResponse,
    RecommendedPaperOut, GraphNodeOut, GraphEdgeOut,
)
from agents import network as network_svc

from storage.models import User
from utils.auth import get_current_user, get_owned_project
from storage.mysql_db import get_session

router = APIRouter()

def _check(project_id: int, user: User):
    """校验项目归属（用户隔离）+ 设置 OpenAlex 礼貌邮箱（用户邮箱优先，否则默认）"""
    from sources import openalex as oa
    oa.set_mailto(user.email)
    with get_session() as session:
        get_owned_project(session, project_id, user)



_tasks: dict[str, dict] = {}


def _build_response(result: network_svc.NetworkResult) -> NetworkResultResponse:
    return NetworkResultResponse(
        backward=[RecommendedPaperOut(
            openalex_id=p.openalex_id, title=p.title, authors=p.authors,
            year=p.year, venue=p.venue, doi=p.doi,
            cited_by_count=p.cited_by_count, abstract=p.abstract,
            source=p.source, cited_by_n=p.cited_by_n,
            citing_n=p.citing_n, reason=p.reason,
        ) for p in result.backward],
        forward=[RecommendedPaperOut(
            openalex_id=p.openalex_id, title=p.title, authors=p.authors,
            year=p.year, venue=p.venue, doi=p.doi,
            cited_by_count=p.cited_by_count, abstract=p.abstract,
            source=p.source, cited_by_n=p.cited_by_n,
            citing_n=p.citing_n, reason=p.reason,
        ) for p in result.forward],
        graph_nodes=[GraphNodeOut(
            id=n.id, label=n.label, group=n.group,
            category=n.category, year=n.year, size=n.size,
        ) for n in result.graph_nodes],
        graph_edges=[GraphEdgeOut(
            source_id=e.source_id, target_id=e.target_id, label=e.label,
        ) for e in result.graph_edges],
        stats=result.stats,
    )


def _run_task(task_id: str, project_id: int, category: str = ""):
    task = _tasks[task_id]
    try:
        def on_progress(step, detail):
            task["step"] = step
            task["detail"] = detail

        result = network_svc.run_analysis(
            project_id=project_id, category=category, on_progress=on_progress,
        )
        task["result"] = _build_response(result)
        task["status"] = "done"
    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)


@router.post("/analyze")
def start_network_analyze(body: NetworkAnalyzeRequest, user: User = Depends(get_current_user)):
    _check(body.project_id, user)
    task_id = uuid.uuid4().hex[:12]
    _tasks[task_id] = {
        "status": "running", "step": "init", "detail": "",
        "result": None, "error": None,
        "project_id": body.project_id, "user_id": user.id,  # 归属校验用
    }
    threading.Thread(
        target=_run_task, args=(task_id, body.project_id, body.category), daemon=True,
    ).start()
    return {"task_id": task_id}


def _assert_task_owner(task: dict, user: User):
    """校验 task 归属：仅创建者本人可查询/取结果"""
    if task.get("user_id") is not None and task["user_id"] != user.id:
        raise HTTPException(403, "无权访问该任务")


@router.get("/status")
def get_network_status(task_id: str = Query(...), user: User = Depends(get_current_user)):
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    _assert_task_owner(task, user)
    return {
        "status": task["status"], "step": task["step"],
        "detail": task["detail"], "error": task["error"],
    }


@router.get("/result", response_model=NetworkResultResponse)
def get_network_result(task_id: str = Query(...), user: User = Depends(get_current_user)):
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    _assert_task_owner(task, user)
    if task["status"] == "running":
        raise HTTPException(202, "still running")
    if task["status"] == "error":
        raise HTTPException(500, task["error"])
    return task["result"]
