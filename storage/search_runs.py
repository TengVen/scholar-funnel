"""
storage/search_runs.py —— 检索记录持久化（工作台"检索记录"视图 + 认知收敛检测数据源）

写入点：检索链路落库后（full_search / gap_search）调用 record_search_run；
covered_ratio 由调用方在保存前统计（反映"本次召回相对库内已有知识的新增率"）。
失败静默（记录不影响检索主链路）。
"""
from storage.mysql_db import get_session
from storage.models import SearchRun, Paper


def record_search_run(
    project_id: int,
    run_type: str,
    query: str = "",
    tech_probe: str = "",
    user_constraint: str = "",
    target_category: str = "",
    top_k: int | None = None,
    score_threshold: float | None = None,
    total_found: int = 0,
    saved_count: int = 0,
    covered_ratio: float | None = None,
    user_id: int | None = None,
) -> None:
    """写入一次检索记录（失败静默，不阻塞检索链路）"""
    try:
        with get_session() as session:
            session.add(SearchRun(
                project_id=project_id, user_id=user_id, run_type=run_type,
                query=query or None, tech_probe=tech_probe or None,
                user_constraint=user_constraint or None,
                target_category=target_category or None,
                top_k=top_k, score_threshold=score_threshold,
                total_found=total_found, saved_count=saved_count,
                covered_ratio=round(covered_ratio, 2) if covered_ratio is not None else None,
            ))
            session.commit()
    except Exception:
        pass


def coverage_ratio(project_id: int, openalex_ids: list[str]) -> float | None:
    """本次召回结果中已在项目库（任意 stage）的占比 0-1；无结果返回 None"""
    ids = [oid for oid in (openalex_ids or []) if oid]
    if not ids:
        return None
    try:
        with get_session() as session:
            known = set(
                oid for (oid,) in session.query(Paper.openalex_id)
                .filter(Paper.project_id == project_id, Paper.openalex_id.in_(ids))
                .all()
            )
        return len(known) / len(ids)
    except Exception:
        return None


def recent_runs(project_id: int, limit: int = 10) -> list[dict]:
    """最近 N 次检索记录（时间倒序，工作台"检索记录"视图）"""
    try:
        with get_session() as session:
            rows = (
                session.query(SearchRun)
                .filter(SearchRun.project_id == project_id)
                .order_by(SearchRun.created_at.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "id": r.id, "run_type": r.run_type, "query": r.query,
                    "tech_probe": r.tech_probe, "user_constraint": r.user_constraint,
                    "target_category": r.target_category,
                    "total_found": r.total_found, "saved_count": r.saved_count,
                    "covered_ratio": r.covered_ratio,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ]
    except Exception:
        return []
