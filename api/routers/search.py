"""
检索执行 API —— 主干检索 + 缺口补充检索
"""
from fastapi import APIRouter, Depends, HTTPException

from api.schemas import (
    SearchRequest, SearchResponse,
    GapSearchRequest, GapSearchResponse, GapCandidate,
    SemanticGapRequest, TitleLookupRequest,
)
from storage.models import User
from utils.auth import get_current_user, get_owned_project
from storage.mysql_db import get_session
from retrieval.pipeline import TrunkSearchEngine

router = APIRouter()

def _check(project_id: int, user: User):
    """校验项目归属（用户隔离）"""
    with get_session() as session:
        get_owned_project(session, project_id, user)





@router.post("/trunk", response_model=SearchResponse)
def run_trunk_search(body: SearchRequest, user: User = Depends(get_current_user)):
    _check(body.project_id, user)
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
