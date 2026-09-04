"""
agents/map_builder.py —— 领域地图结构化归纳（T10）

对一次检索 run 的结果集做数据驱动结构归纳，回答"这个领域长什么样"：
综述锚点（入门该读谁）/ 方法主线（怎么切分与竞争）/ 活跃问题（热点在哪）/ 时间演进。

产物是 run 级业务实体（ai_run_maps 独立表，三端只读同一快照），不随消息流存储。

两条硬约束：
1. 防幻觉外链：LLM 输出的每个 paper_id 必须属于该 run 结果集，越界即丢弃（跨线归属允许）；
2. 失败可降级：LLM 异常/解析失败/空结果 → 规则版（综述优先锚点 + 关键词聚合主线），
   地图仍可展示并标注规则版，不阻塞 run 认知产物。

模块结构：顶层只依赖标准库（纯函数可独立单测）；
DB / LLM / 日志等重依赖延迟到使用它们的函数内 import。
"""
import json
import threading
from collections import Counter

# ── 常量（归纳规模约束：控制单次 LLM 输入与结构体量）──
_FEED_LIMIT = 40            # 送入归纳的论文数（综述优先 + 被引降序 截取）
_ABSTRACT_CHARS = 400       # 摘要送入长度（控制 token）
_MAINLINES_MAX = 5          # 主线条数上限
_HOTSPOTS_MAX = 4           # 热点数上限

_SYSTEM = (
    "你是学术文献综述助手。给定一个研究主题与一批相关论文，归纳该领域的结构："
    "综述锚点（2-3 篇最适合入门的总览性论文）、方法主线（3-5 条，每条一句话说明其主张并配支撑论文）、"
    "活跃问题（2-4 个当前被关注/有争议的子问题）、时间演进（3-4 段可选）。"
    "只允许引用给定论文（用其 paper_id 引用），不得虚构论文；描述须客观精炼。"
)

# run_id → 生成中标记（同 run 并发防重）
_generating: set[int] = set()
_generating_lock = threading.Lock()


# ══════════════════════════════════════════════════════════
#  纯函数层（无第三方依赖，可独立单测）
# ══════════════════════════════════════════════════════════

def _paper_feed(papers) -> list[dict]:
    """论文 ORM 行 → 结构化特征（送 prompt / 规则兜底共用；纯转换无副作用）。

    仅读取 title/year/cited/keywords/abstract/is_survey，保持调用方无关性。
    """
    feed = []
    for p in papers:
        kws = p.keywords if isinstance(p.keywords, list) else []
        feed.append({
            "paper_id": p.id,
            "title": p.title or "",
            "year": p.year,
            "cited_by_count": p.cited_by_count or 0,
            "is_survey": bool(p.is_survey),
            "abstract": (p.abstract or "").strip()[:_ABSTRACT_CHARS],
            "keywords": [str(k) for k in kws[:5]],
        })
    return feed


def _fallback_map(topic: str, feed: list[dict]) -> dict:
    """LLM 失败时的规则版：综述优先 → 锚点；高频关键词聚类 → 粗略主线。

    返回带 fallback=True 标记，前端可标注"规则版"。
    """
    anchors = [
        {"paper_id": f["paper_id"], "title": f["title"], "year": f["year"], "is_survey": True}
        for f in feed if f["is_survey"]
    ][:3]
    taken = {a["paper_id"] for a in anchors}
    if len(anchors) < 2:  # 综述不足 → 高被引补位
        for f in sorted(feed, key=lambda x: x["cited_by_count"], reverse=True):
            if f["paper_id"] not in taken and f["cited_by_count"] >= 50:
                anchors.append({
                    "paper_id": f["paper_id"], "title": f["title"],
                    "year": f["year"], "is_survey": False,
                })
                taken.add(f["paper_id"])
            if len(anchors) >= 3:
                break

    # 主线兜底：按关键词聚合（同词 ≥2 篇即成一线）
    kw_counter: Counter = Counter()
    for f in feed:
        kw_counter.update(f["keywords"])
    mainlines = []
    for kw, _ in kw_counter.most_common(_MAINLINES_MAX):
        members = [f["paper_id"] for f in feed if kw in f["keywords"]]
        if len(members) >= 2:
            mainlines.append({
                "name": f"围绕「{kw}」的工作",
                "description": "由高频关键词自动归并（规则版）",
                "paper_ids": members[:4],
            })

    return {
        "topic": topic or "",
        "fallback": True,
        "anchors": anchors,
        "mainlines": mainlines,
        "hotspots": [],
        "evolution": [],
    }


def _build_prompt(topic: str, feed: list[dict]) -> str:
    """组装归纳 prompt（含输出 schema 示例与防幻觉措辞）。"""
    lines = []
    for f in feed:
        meta = f"《{f['title']}》（{f['year'] or '未知'} · 被引 {f['cited_by_count']}"
        if f["is_survey"]:
            meta += " · 综述"
        if f["keywords"]:
            meta += " · 关键词 " + "、".join(f["keywords"])
        meta += "）"
        lines.append(f"[{f['paper_id']}] {meta}\n摘要：{f['abstract'] or '（无）'}")
    schema = {
        "topic": "主题一句话",
        "anchors": [{"paper_id": 0, "title": "…", "year": 0, "is_survey": False}],
        "mainlines": [{"name": "主线名", "description": "≤60 字主张", "paper_ids": [0, 0]}],
        "hotspots": [{"question": "被关注子问题", "paper_ids": [0]}],
        "evolution": [{"stage": "阶段名", "description": "≤40 字", "year_from": 0, "year_to": 0}],
    }
    return (
        f"研究主题：{topic or '（未提供，请据论文归纳共同主题）'}\n"
        f"候选论文（{len(feed)} 篇，一律用 paper_id 引用，不得虚构论文）：\n"
        + "\n".join(lines)
        + "\n\n请严格输出 JSON：\n" + json.dumps(schema, ensure_ascii=False)
    )


def _extract_and_validate(raw, allowed: set[int], fallback_topic: str = "") -> dict | None:
    """解析 LLM JSON 并校验 paper_id 归属；结构不合法返回 None（调用方走规则兜底）。"""
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None

    def clean_ids(ids) -> list[int]:
        out = []
        for pid in (ids or []):
            try:
                pid = int(pid)
            except (TypeError, ValueError):
                continue
            if pid in allowed and pid not in out:
                out.append(pid)
        return out

    anchors = []
    for a in (data.get("anchors") or [])[:3]:
        if isinstance(a, dict) and a.get("paper_id") in allowed:
            anchors.append({
                "paper_id": int(a["paper_id"]),
                "title": str(a.get("title") or "")[:200],
                "year": a.get("year"),
                "is_survey": bool(a.get("is_survey")),
            })
    mainlines = []
    for m in (data.get("mainlines") or [])[:_MAINLINES_MAX]:
        if not isinstance(m, dict):
            continue
        ids = clean_ids(m.get("paper_ids"))
        if ids:
            mainlines.append({
                "name": str(m.get("name") or "")[:60],
                "description": str(m.get("description") or "")[:120],
                "paper_ids": ids[:4],
            })
    hotspots = []
    for h in (data.get("hotspots") or [])[:_HOTSPOTS_MAX]:
        if not isinstance(h, dict):
            continue
        ids = clean_ids(h.get("paper_ids"))
        if ids:
            hotspots.append({
                "question": str(h.get("question") or "")[:80],
                "paper_ids": ids[:4],
            })
    evolution = []
    for e in (data.get("evolution") or [])[:4]:
        if not isinstance(e, dict) or not str(e.get("stage") or "").strip():
            continue
        evolution.append({
            "stage": str(e.get("stage"))[:30],
            "description": str(e.get("description") or "")[:80],
            "year_from": e.get("year_from"),
            "year_to": e.get("year_to"),
        })

    if not anchors and not mainlines:
        return None  # 无任何有效结构 → 失败，走兜底
    return {
        "topic": str(data.get("topic") or fallback_topic)[:300],
        "anchors": anchors,
        "mainlines": mainlines,
        "hotspots": hotspots,
        "evolution": evolution,
        "fallback": False,
    }


def _generate_with_llm(topic: str, feed: list[dict]) -> dict | None:
    """一次 LLM 调用 → 解析校验后的地图（None = 失败，走规则兜底）。"""
    allowed = {f["paper_id"] for f in feed}
    try:
        from llm.client import chat_json
        raw = chat_json(_build_prompt(topic, feed), system=_SYSTEM, temperature=0.3, max_tokens=6000)
        return _extract_and_validate(raw, allowed, fallback_topic=topic)
    except Exception as e:
        _log(f"领域地图 LLM 生成失败（走规则兜底）: {e}")
        return None


# ══════════════════════════════════════════════════════════
#  DB / 调度层（重依赖延迟 import；真实后端环境运行）
# ══════════════════════════════════════════════════════════

_logger = None


def _log(msg: str) -> None:
    """惰性创建 logger（避免纯函数单测引入 DB 依赖）。"""
    global _logger
    if _logger is None:
        from utils.log import setup_logger
        _logger = setup_logger("map")
    _logger.info(msg)


def _run_papers(session, run_id: int) -> list:
    """该 run 结果集的论文行（综述优先、被引降序，供归纳与校验）。"""
    from storage.models import Paper, PaperRunLink
    return (
        session.query(Paper)
        .join(PaperRunLink, PaperRunLink.paper_id == Paper.id)
        .filter(PaperRunLink.search_run_id == run_id)
        .order_by(Paper.is_survey.desc(), Paper.cited_by_count.desc().nullslast())
        .limit(_FEED_LIMIT)
        .all()
    )


def _persist(run_id: int, project_id: int, topic: str, status: str,
             payload: dict | None = None, model: str | None = None, error: str | None = None) -> None:
    """写 ai_run_maps（upsert：同 run 重生成覆盖旧快照）。"""
    from sqlalchemy import func as sa_func
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from storage.mysql_db import get_session
    from storage.models import RunMap
    with get_session() as session:
        session.execute(
            pg_insert(RunMap)
            .values(run_id=run_id, project_id=project_id,
                    topic=(payload or {}).get("topic", topic)[:300],
                    status=status, map=payload or {}, model=model, error=error)
            .on_conflict_do_update(
                index_elements=["run_id"],
                set_={"status": status, "map": payload or {}, "model": model,
                      "error": error, "updated_at": sa_func.now()},
            )
        )
        session.commit()


def build_run_map(run_id: int, project_id: int, topic: str = "", model: str | None = None) -> str:
    """生成/重生成某 run 的领域地图并落库；返回最终 status（done / failed）。

    同步执行核心；需要后台化时由调用方包装线程（generate_run_map_async）。
    """
    from storage.mysql_db import get_session
    with get_session() as session:
        papers = _run_papers(session, run_id)
    feed = _paper_feed(papers)
    if not feed:
        _persist(run_id, project_id, topic, "failed", error="该 run 无可用论文（结果集为空）")
        _log(f"领域地图 failed（空结果集）: run={run_id}")
        return "failed"

    payload = _generate_with_llm(topic, feed)
    if payload is None:
        payload = _fallback_map(topic, feed)
        _persist(run_id, project_id, topic, "done", payload, model="rule-fallback")
        _log(f"领域地图（规则兜底）: run={run_id} 锚点{len(payload['anchors'])} 主线{len(payload['mainlines'])}")
        return "done"

    _persist(run_id, project_id, topic, "done", payload, model=model)
    _log(
        f"领域地图 done: run={run_id} 锚点{len(payload['anchors'])}/"
        f"主线{len(payload['mainlines'])}/热点{len(payload['hotspots'])}"
    )
    return "done"


def generate_run_map_async(run_id: int, project_id: int, topic: str = "") -> str:
    """后台线程生成（防同 run 并发）。返回 'generating'（已在生成）或 'none'（本次启动）。"""
    with _generating_lock:
        if run_id in _generating:
            return "generating"
        _generating.add(run_id)

    def _worker() -> None:
        try:
            build_run_map(run_id, project_id, topic)
        finally:
            with _generating_lock:
                _generating.discard(run_id)

    threading.Thread(target=_worker, daemon=True).start()
    return "none"


def get_run_map(run_id: int) -> dict:
    """读取地图状态与快照；无记录返回 {status: 'none'}。"""
    from storage.mysql_db import get_session
    from storage.models import RunMap
    try:
        with get_session() as session:
            row = session.query(RunMap).filter(RunMap.run_id == run_id).first()
            if row is None:
                return {"status": "none"}
            return {
                "status": row.status,
                "topic": row.topic or "",
                "map": row.map or {},
                "model": row.model,
                "error": row.error,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
    except Exception as e:
        _log(f"读取领域地图失败 run={run_id}: {e}")
        return {"status": "none"}
