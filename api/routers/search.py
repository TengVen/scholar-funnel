"""
检索执行 API —— 主干检索 + 缺口补充检索
"""
from fastapi import APIRouter, HTTPException

from api.schemas import (
    SearchRequest, SearchResponse,
    GapSearchRequest, GapSearchResponse, GapCandidate,
    TitleLookupRequest,
)
from retrieval.pipeline import TrunkSearchEngine

router = APIRouter()


@router.post("/trunk", response_model=SearchResponse)
def run_trunk_search(body: SearchRequest):
    """
    执行主干检索。

    这是一个耗时操作（通常 30-120s），包含：
    1. LLM 意图拆解
    2. OpenAlex 文献召回
    3. BGE Reranker 重排
    4. 评分 + 入库
    """
    try:
        engine = TrunkSearchEngine()
        result = engine.search(
            project_id=body.project_id,
            user_query=body.user_query,
            tech_probe=body.tech_probe,
            per_query=body.per_query,
            year_from=body.year_from,
            year_to=body.year_to,
            score_threshold=body.score_threshold,
            top_k=body.top_k,
            max_queries=body.max_queries,
        )
        return SearchResponse(**result)
    except Exception as e:
        raise HTTPException(500, f"检索失败: {str(e)}")


@router.post("/gap", response_model=GapSearchResponse)
def run_gap_search(body: GapSearchRequest):
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


@router.post("/title", response_model=GapSearchResponse)
def run_title_lookup(body: TitleLookupRequest):
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
