"""
retrieval/planner.py —— Retrieval Planner（决策层，纯函数为主）

架构原则（2026-09-01 用户拍板，写入 AGENTS.md 规范）：
Research 管研究意图，Search Run 管一次检索快照，Candidate Pool 管可复用的论文资产，
Retrieval Execution 管实际召回成本；每次新检索先进行 Constraint Diff 与 Coverage Check，
再由 Retrieval Planner 动态组合复用、过滤、增量召回或全量召回，最终独立 Rerank 生成新的 Run 结果。

本模块三件套：
- constraint_diff(prev, new)：约束差异分析（纯函数）
- coverage_check(project_id, constraints)：池覆盖检查（读 DB，独立可测）
- plan(diff, coverage, top_k, prev_exists)：模式决策（纯函数）

模式语义：
- full          全量重跑（查询词/方法论语义变化，旧召回无复用价值）
- incremental   窗口放宽 → 只补新增时间段，与池内合并
- local_filter  窗口收窄/不变 → 池内过滤（不足自动补召回）
- hybrid        方法论偏移 → 池内先筛 + 定向补召回

异常兜底：调用方 try/except 一律回退 full（最安全，语义保证正确）。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# ── 约束结构 ──

@dataclass
class Constraints:
    """一次检索的完整约束（与 ai_search_runs 快照字段对应）"""
    user_query: str = ""
    tech_probe: str = ""
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    methodology: Optional[str] = None
    paper_type: Optional[str] = None  # all / survey / original

    def to_dict(self) -> dict:
        return {
            "user_query": self.user_query,
            "tech_probe": self.tech_probe,
            "year_from": self.year_from,
            "year_to": self.year_to,
            "methodology": self.methodology,
            "paper_type": self.paper_type,
        }

    @classmethod
    def from_run(cls, run) -> "Constraints":
        """从检索记录恢复约束（兼容 ORM 行或 recent_runs 返回的 dict）"""
        def _g(key: str, default=None):
            if isinstance(run, dict):
                return run.get(key, default)
            return getattr(run, key, default)
        return cls(
            user_query=_g("query") or "",
            tech_probe=_g("tech_probe") or "",
            year_from=_g("year_from"),
            year_to=_g("year_to"),
            methodology=_g("methodology"),
            paper_type=_g("paper_type"),
        )


# ── 1. Constraint Diff ──

@dataclass
class Diff:
    query_changed: bool = False       # 查询词/探针变化 → 语义变化
    window: str = "same"              # widen 放宽 / narrow 收窄 / same 不变
    method_shift: bool = False        # 方法论变化
    type_changed: bool = False        # 论文类型变化


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def constraint_diff(prev: Constraints, new: Constraints) -> Diff:
    """约束差异分析：prev 为最近一次 Run 的约束，new 为本次请求约束。"""
    d = Diff()
    d.query_changed = (
        _norm(prev.user_query) != _norm(new.user_query)
        or _norm(prev.tech_probe) != _norm(new.tech_probe)
    )
    d.method_shift = _norm(prev.methodology) != _norm(new.methodology)
    d.type_changed = (prev.paper_type or "") != (new.paper_type or "")

    # 年份窗口：None 语义 = 无界（from None→0，to None→∞）
    pf = prev.year_from or 0
    pt = prev.year_to or 9999
    nf = new.year_from or 0
    nt = new.year_to or 9999
    lower_widen = nf < pf          # 下界放宽（2024+ → 2020+）
    upper_widen = nt > pt          # 上界放宽（-2024 → -2026）
    lower_narrow = nf > pf         # 下界收窄（2020+ → 2024+）
    upper_narrow = nt < pt         # 上界收窄
    if lower_widen or upper_widen:
        d.window = "widen"
    elif lower_narrow or upper_narrow:
        d.window = "narrow"
    else:
        d.window = "same"
    return d


# ── 2. Coverage Check ──

@dataclass
class Coverage:
    in_window: int = 0      # 池内在窗口内的论文数
    sufficient: bool = False  # 是否够直接本地过滤（≥ 阈值）


def coverage_check(project_id: int, constraints: Constraints, top_k: int = 100) -> Coverage:
    """池覆盖检查：Candidate Pool（该子研究 ai_papers）内在新约束窗口下的论文数。
    本地过滤"够不够用"的判据：≥ top_k 的一半（下限 5）即认为可本地兜底。"""
    from storage.mysql_db import get_session
    from storage.models import Paper

    try:
        with get_session() as session:
            q = session.query(Paper.id).filter(Paper.project_id == project_id)
            if constraints.year_from:
                q = q.filter(Paper.year >= constraints.year_from)
            if constraints.year_to:
                q = q.filter(Paper.year <= constraints.year_to)
            count = q.count()
        threshold = max(5, top_k // 2)
        return Coverage(in_window=count, sufficient=count >= threshold)
    except Exception:
        return Coverage(in_window=0, sufficient=False)


# ── 3. Plan（模式决策） ──

@dataclass
class Plan:
    mode: str = "full"               # full / incremental / local_filter / hybrid
    reason: str = ""                 # 决策说明（写入 Run.plan_reason，前端可见）
    incremental_from: Optional[int] = None  # incremental 新增段下界
    incremental_to: Optional[int] = None    # incremental 新增段上界


def plan(diff: Diff, coverage: Coverage, top_k: int = 100, prev_exists: bool = True) -> Plan:
    """模式决策（决策树）：
    - 首次检索（无 prev）→ full
    - 查询词变化 → full（语义变，旧召回无复用价值）
    - 方法论偏移 → hybrid（池内筛 + 定向补召回）
    - 窗口放宽 → incremental（补新增时间段）
    - 窗口收窄/不变 → local_filter（池内过滤，不足内部补召回）
    """
    if not prev_exists:
        return Plan(mode="full", reason="首次检索，全量召回建立研究池")
    if diff.query_changed:
        return Plan(mode="full", reason="查询词/技术探针变化，语义已不同，需全量重跑")
    if diff.method_shift:
        return Plan(mode="hybrid", reason="方法论偏移，池内先筛 + 定向补召回")
    if diff.window == "widen":
        return Plan(mode="incremental", reason="年份窗口放宽，增量补充新增时间段")
    if diff.window in ("narrow", "same"):
        if coverage.sufficient:
            return Plan(mode="local_filter", reason=f"窗口收窄/不变，池内 {coverage.in_window} 篇可本地过滤")
        return Plan(mode="hybrid", reason=f"池内窗口内仅 {coverage.in_window} 篇不足，本地过滤 + 补召回")
    return Plan(mode="full", reason="默认全量")
