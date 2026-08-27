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
)
from storage.models import User
from utils.auth import get_current_user, get_owned_project
from utils.task_guard import acquire_or_reuse
from storage.mysql_db import get_session
from retrieval.pipeline import TrunkSearchEngine

router = APIRouter()

def _check(project_id: int, user: User):
    """校验项目归属（用户隔离）+ 设置 OpenAlex 礼貌邮箱（用户邮箱优先，否则默认 1257312717@qq.com）"""
    from sources import openalex as oa
    oa.set_mailto(user.email)
    with get_session() as session:
        get_owned_project(session, project_id, user)


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
    _check(body.project_id, user)
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
    _check(body.project_id, user)
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
    _check(body.project_id, user)
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
    _check(body.project_id, user)
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
