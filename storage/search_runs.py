"""
storage/search_runs.py —— 检索记录持久化（工作台"检索记录"视图 + 认知收敛检测 + Retrieval Planner 快照）

写入点：检索链路落库后（full_search / gap_search）调用 record_search_run；
covered_ratio 由调用方在保存前统计（反映"本次召回相对库内已有知识的新增率"）。
P1：返回 run_id，供论文 ↔ 检索记录多对多关联（link_paper_runs）；记录 mode/status/error/plan_reason 留痕。
失败静默（记录不影响检索主链路）。
"""
from sqlalchemy.dialects.postgresql import insert as pg_insert
from storage.mysql_db import get_session
from storage.models import SearchRun, PaperRunLink, Message


def collect_run_cognitive(session, project_id: int, run_ids: list[int]) -> dict[int, dict]:
    """各 Run 的核心推荐（按 run_id 关联消息卡，session 复用避免重复连接）：
    l2_structure（full_search 三分类认知结构）或 deep_research_result（深研骨架候选，按 suggested_category 分组）。
    返回 {run_id: {topic, selected_count, foundation[], mainstream[], frontier[]}}（无推荐 run 为 {}）。
    与工作台概览（chat.py）共用同一解析逻辑。"""
    run_cognitive: dict[int, dict] = {rid: {} for rid in run_ids}
    if not run_ids:
        return run_cognitive
    for m in (
        session.query(Message)
        .filter(Message.project_id == project_id)
        .order_by(Message.id.desc())
        .all()
    ):
        att = m.attachments
        if not isinstance(att, dict):
            continue
        rid = att.get("run_id")
        if rid not in run_cognitive or run_cognitive[rid]:
            continue
        if att.get("type") == "l2_structure" and isinstance(att.get("cognitive_structure"), dict):
            cs = att["cognitive_structure"]
            run_cognitive[rid] = {
                "topic": cs.get("topic", ""),
                "selected_count": cs.get("selected_count", 0),
                "foundation": cs.get("foundation", []) or [],
                "mainstream": cs.get("mainstream", []) or [],
                "frontier": cs.get("frontier", []) or [],
            }
        elif att.get("type") == "deep_research_result":
            cands = att.get("candidates") or []
            groups: dict[str, list] = {"foundation": [], "mainstream": [], "frontier": []}
            for c in cands:
                cat = c.get("suggested_category", "mainstream")
                groups.setdefault(cat, []).append({
                    "paper_id": c.get("paper_id"),
                    "title": c.get("title", ""),
                    "year": c.get("year", 0),
                    "reason": c.get("reason", ""),
                })
            run_cognitive[rid] = {
                "topic": att.get("project_name") or "",
                "selected_count": sum(len(v) for v in groups.values()),
                **groups,
            }
    return run_cognitive


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
    # ── P1：模式/状态/约束快照（Retrieval Planner）──
    mode: str | None = None,
    status: str = "done",
    error: str | None = None,
    plan_reason: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    methodology: str | None = None,
    paper_type: str | None = None,
) -> int | None:
    """写入一次检索记录，返回 run_id（失败返回 None，不阻塞检索链路）"""
    try:
        with get_session() as session:
            run = SearchRun(
                project_id=project_id, user_id=user_id, run_type=run_type,
                query=query or None, tech_probe=tech_probe or None,
                user_constraint=user_constraint or None,
                target_category=target_category or None,
                top_k=top_k, score_threshold=score_threshold,
                total_found=total_found, saved_count=saved_count,
                covered_ratio=round(covered_ratio, 2) if covered_ratio is not None else None,
                mode=mode, status=status, error=error, plan_reason=plan_reason,
                year_from=year_from, year_to=year_to,
                methodology=methodology, paper_type=paper_type,
            )
            session.add(run)
            session.commit()
            return run.id
    except Exception:
        return None


def link_paper_runs(paper_ids: list[int], run_id: int) -> None:
    """论文 ↔ 检索记录多对多关联（幂等：同对不重复）。失败静默。"""
    ids = [pid for pid in (paper_ids or []) if pid]
    if not ids or not run_id:
        return
    try:
        with get_session() as session:
            for pid in ids:
                session.execute(
                    pg_insert(PaperRunLink)
                    .values(paper_id=pid, search_run_id=run_id)
                    .on_conflict_do_nothing(index_elements=["paper_id", "search_run_id"])
                )
            session.commit()
    except Exception:
        pass


def papers_of_run(run_id: int) -> list[int]:
    """某次检索记录归属的论文 id 列表（Search Run 独立资产视图）"""
    try:
        with get_session() as session:
            return [pid for (pid,) in (
                session.query(PaperRunLink.paper_id)
                .filter(PaperRunLink.search_run_id == run_id)
                .all()
            )]
    except Exception:
        return []


def coverage_ratio(project_id: int, openalex_ids: list[str]) -> float | None:
    """本次召回结果中已在项目库（任意 stage）的占比 0-1；无结果返回 None"""
    ids = [oid for oid in (openalex_ids or []) if oid]
    if not ids:
        return None
    try:
        from storage.models import Paper
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
    """最近 N 次检索记录（时间倒序，工作台"检索记录"视图 + Planner 约束快照）"""
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
                    # ── P1/P3：约束快照 + 模式（Planner 复用）──
                    "mode": r.mode, "status": r.status, "error": r.error,
                    "plan_reason": r.plan_reason,
                    "year_from": r.year_from, "year_to": r.year_to,
                    "methodology": r.methodology, "paper_type": r.paper_type,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ]
    except Exception:
        return []
