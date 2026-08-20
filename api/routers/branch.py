"""
Branch analysis API - background task + polling
"""
import uuid
import threading
from fastapi import APIRouter, HTTPException, Query

from api.schemas import BranchAnalyzeRequest, BranchAnalyzeResponse, BranchPaperResultOut
from agents import branch as branch_svc

router = APIRouter()
_tasks: dict[str, dict] = {}


def _serialize(r: branch_svc.BranchPaperResult) -> BranchPaperResultOut:
    return BranchPaperResultOut(
        paper_id=r.paper_id, title=r.title, authors=r.authors,
        year=r.year, venue=r.venue, doi=r.doi, abstract=r.abstract,
        cited_by_count=r.cited_by_count, content_level=r.content_level,
        content_source=r.content_source, method_summary=r.method_summary,
        probe_match=r.probe_match, probe_confidence=r.probe_confidence,
        key_findings=r.key_findings, optimization_method=r.optimization_method,
        error=r.error,
    )


def _run_task(task_id: str, project_id: int, mode: str, probe: str):
    task = _tasks[task_id]
    try:
        def on_progress(current, total, title):
            task["current"] = current
            task["total"] = total
            task["detail"] = title

        results = branch_svc.run_analysis(
            project_id=project_id, mode=mode, probe=probe,
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


@router.post("/analyze")
def start_branch_analyze(body: BranchAnalyzeRequest):
    if body.mode == "probe_match" and not body.probe:
        raise HTTPException(400, "probe_match mode requires a probe")
    task_id = uuid.uuid4().hex[:12]
    _tasks[task_id] = {
        "status": "running", "current": 0, "total": 0,
        "detail": "", "result": None, "error": None,
    }
    threading.Thread(
        target=_run_task,
        args=(task_id, body.project_id, body.mode, body.probe),
        daemon=True,
    ).start()
    return {"task_id": task_id}


@router.get("/status")
def get_branch_status(task_id: str = Query(...)):
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    return {
        "status": task["status"], "current": task["current"],
        "total": task["total"], "detail": task["detail"],
        "error": task["error"],
    }


@router.get("/result", response_model=BranchAnalyzeResponse)
def get_branch_result(task_id: str = Query(...)):
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    if task["status"] == "running":
        raise HTTPException(202, "still running")
    if task["status"] == "error":
        raise HTTPException(500, task["error"])
    return task["result"]


@router.get("/results", response_model=BranchAnalyzeResponse)
def get_branch_results(project_id: int = Query(...)):
    results = branch_svc.get_stored_results(project_id)
    level_dist: dict[str, int] = {}
    for r in results:
        src = f"L{r.content_level} ({r.content_source})"
        level_dist[src] = level_dist.get(src, 0) + 1
    return BranchAnalyzeResponse(
        results=[_serialize(r) for r in results],
        total=len(results), mode="stored", level_distribution=level_dist,
    )
