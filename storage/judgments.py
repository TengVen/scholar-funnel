"""
论文研究判断服务（采纳 / 排除 / 存疑）——记忆机制的地基

设计要点（md/P0改造设计-2026-08-30.md）：
- 与骨架（ai_cart）语义分离：排除/存疑不进骨架、不占限额
- UNIQUE(project_id, paper_id)：最新判断覆盖旧判断；action=none 表示撤销（删行）
- 排除回流：filter_excluded 把已排除论文从后续召回池过滤（按 openalex_id 匹配）
"""
from storage.models import Paper, PaperJudgment
from storage.mysql_db import get_session
from utils.log import setup_logger

logger = setup_logger("judgments")

VALID_ACTIONS = {"adopt", "exclude", "uncertain", "none"}


def set_judgment(
    project_id: int,
    paper_id: int,
    action: str,
    reason: str | None = None,
    source: str = "chat",
) -> dict:
    """记录/覆盖/撤销判断。action=none 为撤销（删行）。返回 {ok, action}。"""
    if action not in VALID_ACTIONS:
        return {"ok": False, "error": f"非法 action: {action}"}

    with get_session() as session:
        paper = session.get(Paper, paper_id)
        if not paper or paper.project_id != project_id:
            return {"ok": False, "error": "论文不存在或不属于该项目"}

        if action == "none":
            row = (
                session.query(PaperJudgment)
                .filter_by(project_id=project_id, paper_id=paper_id)
                .first()
            )
            if row:
                session.delete(row)
            return {"ok": True, "action": "none", "cleared": True}

        row = (
            session.query(PaperJudgment)
            .filter_by(project_id=project_id, paper_id=paper_id)
            .first()
        )
        if row:
            row.action = action
            row.reason = reason
            row.source = source
        else:
            session.add(PaperJudgment(
                project_id=project_id,
                paper_id=paper_id,
                action=action,
                reason=reason,
                source=source,
            ))
    return {"ok": True, "action": action}


def list_judgments(project_id: int) -> list[dict]:
    """项目全部判断（带论文标题，供记忆面板/agent 上下文使用）"""
    with get_session() as session:
        rows = (
            session.query(PaperJudgment, Paper.title)
            .join(Paper, Paper.id == PaperJudgment.paper_id)
            .filter(PaperJudgment.project_id == project_id)
            .order_by(PaperJudgment.updated_at.desc())
            .all()
        )
        return [
            {
                "paper_id": j.paper_id,
                "title": title,
                "action": j.action,
                "reason": j.reason,
                "source": j.source,
                "updated_at": j.updated_at.isoformat() if j.updated_at else None,
            }
            for j, title in rows
        ]


def excluded_openalex_ids(project_id: int) -> set[str]:
    """已排除论文的 openalex_id 集合（检索回流过滤用）"""
    with get_session() as session:
        rows = (
            session.query(Paper.openalex_id)
            .join(PaperJudgment, PaperJudgment.paper_id == Paper.id)
            .filter(
                PaperJudgment.project_id == project_id,
                PaperJudgment.action == "exclude",
            )
            .all()
        )
        return {r[0] for r in rows}


def filter_excluded(project_id: int, candidates: list[dict]) -> tuple[list[dict], int]:
    """从召回候选中过滤已排除论文。返回 (过滤后列表, 排除数)。"""
    excluded = excluded_openalex_ids(project_id)
    if not excluded or not candidates:
        return candidates, 0
    kept = [c for c in candidates if c.get("id") not in excluded]
    return kept, len(candidates) - len(kept)


def resolve_paper_by_ref(project_id: int, ref: str) -> Paper | None:
    """按标题片段 / 数字 ID 在项目内定位论文（对话修正用）"""
    ref = (ref or "").strip()
    if not ref:
        return None
    with get_session() as session:
        if ref.isdigit():
            paper = session.get(Paper, int(ref))
            if paper and paper.project_id == project_id:
                return paper
        return (
            session.query(Paper)
            .filter(
                Paper.project_id == project_id,
                Paper.title.ilike(f"%{ref}%"),
            )
            .order_by(Paper.trunk_score.desc().nullslast())
            .first()
        )
