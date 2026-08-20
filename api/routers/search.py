"""
检索执行 API —— 调用 TrunkSearchEngine 执行主干检索
"""
from fastapi import APIRouter, HTTPException

from api.schemas import SearchRequest, SearchResponse
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
