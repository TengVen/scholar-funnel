"""
agents/structure.py —— L2 认知结构（结构化归纳）

v1（2026-09-03）：规则三层分组 + 推荐理由三件套（用户拍板）——
  [分类] suggested_category（奠基/主流/前沿）
  [一句话理由] one_liner：有摘要 → LLM 按摘要批量生成（≤40 字）；无摘要 → 元数据模板（reason）兜底
  [召回依据] recall_basis：由 Paper.recall_meta 规则转述（matched_terms 命中词 / routes 召回路），
            不暴露 similarity/rerank_score 内部信号
v0 reason（build_reason 元数据模板）保留：无摘要/LLM 失败时作 one_liner 兜底与旧端回退。
输出 schema（topic/total_candidates/selected_count/foundation/mainstream/frontier）保持不变。
T10 地图归纳（LLM 数据驱动分组）落地后仍保持本 schema，前端契约不随实现升级变化。

规则（复用骨架分类判定）：
- foundation：综述 或（年份 < 当前-8 且被引 > 100）
- frontier：年份 >= 当前-2
- mainstream：其余
"""
import json
from datetime import datetime

from storage.mysql_db import get_session
from storage.models import Paper
from prompt.reason import build_reason
from utils.log import setup_logger

logger = setup_logger("structure")

# 每类展示上限（核心推荐论文；超出部分留在候选池，经"查看全部"探索）
_PER_CATEGORY_LIMIT = 10
# 召回路中文转述（内部信号分数不展示，仅路径语义）
_ROUTE_ZH = {
    "core": "核心词匹配",
    "synonym": "同义词扩展",
    "aux": "辅助相关",
    "loose": "宽松扩展",
    "semantic": "本地语义",
}
_ONELINER_SYSTEM = (
    "你是学术文献综述助手。为每篇论文生成一条「一句话推荐理由」（≤40 字）："
    "说明该论文与你给的研究主题之间的相关角度与参考价值，必须基于给出的摘要判断，"
    "不编造摘要之外的内容，语气客观、不用套话。"
)


def _recall_basis_text(meta) -> str:
    """召回依据（证据性事实转述）：命中词 + 召回路；无数据返回空串。"""
    if not isinstance(meta, dict):
        return ""
    terms = meta.get("matched_terms") or []
    routes = meta.get("routes") or []
    parts = []
    if terms:
        parts.append("命中词：" + "、".join(str(t) for t in terms[:5]))
    if routes:
        parts.append("召回路：" + "/".join(_ROUTE_ZH.get(str(r), str(r)) for r in routes[:4]))
    return "；".join(parts)


def _generate_one_liners(topic: str, papers: list[dict]) -> dict[int, str]:
    """一次 LLM 批量调用为有摘要的推荐论文生成一句话理由；失败静默降级（调用方兜底）。"""
    feed = [p for p in papers if p.get("abstract_src")]
    if not feed:
        return {}
    lines = []
    for i, p in enumerate(feed, 1):
        lines.append(
            f"[{i}] paper_id={p['paper_id']}\n"
            f"标题：{p.get('title') or ''}（{p.get('year') or '未知年份'}）\n"
            f"摘要：{p['abstract_src']}"
        )
    prompt = (
        f"研究主题：{topic or '（未提供）'}\n"
        "以下是候选论文，请逐篇生成一句话推荐理由（各自独立、不要雷同、不要用'该文与主题相关'这类空话）：\n\n"
        + "\n\n".join(lines)
        + '\n\n请严格输出 JSON：{"reasons": [{"paper_id": <数字>, "one_liner": "<一句话理由>"}]}'
    )
    try:
        from llm.client import chat_json
        raw = chat_json(prompt, system=_ONELINER_SYSTEM, temperature=0.3, max_tokens=4000)
        data = json.loads(raw)
        out: dict[int, str] = {}
        for item in data.get("reasons") or []:
            try:
                pid = int(item.get("paper_id"))
            except (TypeError, ValueError):
                continue
            txt = str(item.get("one_liner") or "").strip()
            if txt:
                out[pid] = txt[:80]
        return out
    except Exception as e:
        logger.warning(f"一句话理由生成失败（降级元数据模板）: {e}")
        return {}


def build_cognitive_structure(
    project_id: int,
    topic: str = "",
    total_candidates: int | None = None,
    limit: int = 50,
) -> dict:
    """
    基于项目内主干论文生成三层认知结构（v1 规则版 + 推荐理由三件套）。

    Args:
        project_id: 项目
        topic: 研究主题（推荐理由注入）
        total_candidates: 本次检索候选结果池总数（无则用已入库数）
        limit: 参与分组的论文上限（按 trunk_score 取前 N）

    Returns:
        {topic, total_candidates, selected_count,
         foundation: [..], mainstream: [..], frontier: [..]}
        每项论文: {paper_id, title, year, cited_by_count, suggested_category,
                   reason（元数据模板，无摘要/LLM 失败兜底）, one_liner（一句话理由）, recall_basis（召回依据）}
    """
    current_year = datetime.now().year

    with get_session() as session:
        rows = (
            session.query(Paper)
            .filter(Paper.project_id == project_id, Paper.stage == "trunk")
            .order_by(Paper.trunk_score.desc().nullslast())
            .limit(limit)
            .all()
        )

    groups: dict[str, list[dict]] = {"foundation": [], "mainstream": [], "frontier": []}
    selected: list[dict] = []
    for r in rows:
        if r.is_survey or (r.year and r.year < current_year - 8 and (r.cited_by_count or 0) > 100):
            cat = "foundation"
        elif r.year and r.year >= current_year - 2:
            cat = "frontier"
        else:
            cat = "mainstream"
        if len(groups[cat]) >= _PER_CATEGORY_LIMIT:
            continue
        reason = build_reason(
            cat, topic,
            title=r.title or "",
            year=r.year,
            cited=r.cited_by_count or 0,
            is_survey=bool(r.is_survey),
        )
        item = {
            "paper_id": r.id,
            "title": r.title,
            "year": r.year,
            "cited_by_count": r.cited_by_count or 0,
            "suggested_category": cat,
            "reason": reason,
            # 召回依据（规则转述 recall_meta，零 LLM）
            "recall_basis": _recall_basis_text(r.recall_meta),
            # 摘要源（临时字段，生成一句话理由后移除）
            "abstract_src": (r.abstract or "").strip()[:1200],
        }
        groups[cat].append(item)
        selected.append(item)

    # 一句话理由：有摘要 → LLM 批量生成（一次调用）；无摘要/失败 → reason（元数据模板）兜底
    if selected:
        one_liners = _generate_one_liners(topic, selected)
        for it in selected:
            it["one_liner"] = one_liners.get(it["paper_id"]) or it["reason"]
            it.pop("abstract_src", None)

    selected_total = sum(len(v) for v in groups.values())
    if total_candidates is None:
        total_candidates = len(rows)

    logger.info(
        f"认知结构 v1: project={project_id} 选中 {selected_total} / 候选 {total_candidates} "
        f"(奠基{len(groups['foundation'])}/主流{len(groups['mainstream'])}/前沿{len(groups['frontier'])}"
        f"/一句话理由 {sum(1 for it in selected if it['one_liner'] != it['reason'])})"
    )
    return {
        "topic": topic or "",
        "total_candidates": total_candidates,
        "selected_count": selected_total,
        **groups,
    }
