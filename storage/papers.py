"""
论文落库服务（轻量）—— L1"加入研究"：把回答来源论文纳入项目候选

语义（产品原则 §九 L1）：用户主动将论文从"回答来源"纳入"当前研究"（成为项目候选），
不进骨架、不触发分支/网络分析。stage=candidate，不被 trunk 重建回收。
与 cart.add_by_openalex（加入骨架）语义分离。
"""
from storage.models import Paper
from storage.mysql_db import get_session
from utils.log import setup_logger

logger = setup_logger("papers")


def save_openalex_paper(project_id: int, openalex_id: str, stage: str = "candidate") -> dict:
    """
    从 OpenAlex 拉取论文并落库到项目（幂等：已存在则直接返回）。
    返回 {ok, paper_id, created}。
    """
    from sources.openalex import get_work_by_id

    openalex_id = (openalex_id or "").strip()
    if not openalex_id:
        return {"ok": False, "error": "缺少 openalex_id"}

    with get_session() as session:
        paper = (
            session.query(Paper)
            .filter_by(openalex_id=openalex_id, project_id=project_id)
            .first()
        )
        if paper:
            # 已存在：低阶段（trunk 等）提升为 candidate 防止被 trunk 重建回收
            if paper.stage != stage:
                paper.stage = stage
                logger.info(f"论文阶段提升: {openalex_id} → {stage}")
            return {"ok": True, "paper_id": paper.id, "created": False}

        work = get_work_by_id(openalex_id)
        if not work:
            return {"ok": False, "error": f"OpenAlex 未找到该论文: {openalex_id}"}

        paper = Paper(
            project_id=project_id,
            openalex_id=work.openalex_id,
            title=work.title or "",
            authors=work.authors or [],
            year=work.year or 0,
            venue=work.venue or "",
            doi=work.doi,
            abstract=work.abstract or "",
            cited_by_count=work.cited_by_count or 0,
            is_survey=False,
            stage=stage,
            keywords=work.concepts or None,
            github_url=work.github_url,
        )
        session.add(paper)
        session.flush()
        logger.info(f"论文纳入项目候选: {openalex_id} (project={project_id})")
        return {"ok": True, "paper_id": paper.id, "created": True}
