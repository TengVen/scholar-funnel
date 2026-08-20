"""
Network analysis API - background task + polling
"""
import uuid
import threading
from fastapi import APIRouter, HTTPException, Query

from api.schemas import (
    NetworkAnalyzeRequest, NetworkResultResponse,
    RecommendedPaperOut, GraphNodeOut, GraphEdgeOut,
)
from agents import network as network_svc

router = APIRouter()
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


def _run_task(task_id: str, project_id: int):
    task = _tasks[task_id]
    try:
        def on_progress(step, detail):
            task["step"] = step
            task["detail"] = detail

        result = network_svc.run_analysis(
            project_id=project_id, on_progress=on_progress,
        )
        task["result"] = _build_response(result)
        task["status"] = "done"
    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)


@router.post("/analyze")
def start_network_analyze(body: NetworkAnalyzeRequest):
    task_id = uuid.uuid4().hex[:12]
    _tasks[task_id] = {
        "status": "running", "step": "init", "detail": "",
        "result": None, "error": None,
    }
    threading.Thread(
        target=_run_task, args=(task_id, body.project_id), daemon=True,
    ).start()
    return {"task_id": task_id}


@router.get("/status")
def get_network_status(task_id: str = Query(...)):
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    return {
        "status": task["status"], "step": task["step"],
        "detail": task["detail"], "error": task["error"],
    }


@router.get("/result", response_model=NetworkResultResponse)
def get_network_result(task_id: str = Query(...)):
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    if task["status"] == "running":
        raise HTTPException(202, "still running")
    if task["status"] == "error":
        raise HTTPException(500, task["error"])
    return task["result"]
