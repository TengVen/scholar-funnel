"""
骨架清单后台服务 —— 加入/移除/分类/导出/AI 建议
"""
import json
from datetime import datetime
from typing import List, Dict

from storage.mysql_db import get_session
from storage.models import CartItem, Paper, Project
from utils.log import setup_logger
from llm import client as llm

logger = setup_logger("cart")

# ── 每类上限 ──
LIMITS = {
    "foundation": 5,    # 奠基
    "mainstream": 10,   # 主流
    "frontier": 5,      # 前沿
}
TOTAL_LIMIT = 20


# ══════════════════════════════════════════════════════════
#  CRUD
# ══════════════════════════════════════════════════════════

def add(project_id: int, paper_id: int, category: str, notes: str = "") -> dict:
    """
    将论文加入骨架。

    返回: {"ok": True/False, "error": "失败原因", "counts": {...}}
    """
    # ── 校验分类名 ──
    if category not in LIMITS:
        logger.warning(f"未知分类: {category}")
        return {"ok": False, "error": f"未知分类: {category}"}

    with get_session() as session:
        # 查论文是否存在
        paper = session.get(Paper, paper_id)
        if not paper:
            return {"ok": False, "error": "论文不存在"}

        # 查是否已在骨架中
        existing = (
            session.query(CartItem)
            .filter_by(project_id=project_id, paper_id=paper_id)
            .first()
        )
        if existing:
            return {"ok": False, "error": "这篇论文已在骨架中"}

        # 查各类别的当前计数
        current_counts = _counts(session, project_id)
        current_total = sum(current_counts.values())

        # 校验该类上限
        if current_counts.get(category, 0) >= LIMITS[category]:
            return {
                "ok": False,
                "error": f"{_cat_label(category)}已达到上限 {LIMITS[category]} 篇，"
                         f"先移除一篇再添加",
            }

        # 校验总数上限
        if current_total >= TOTAL_LIMIT:
            return {"ok": False, "error": f"骨架已满（{TOTAL_LIMIT} 篇），请先移除一篇"}

        # 写入
        item = CartItem(
            project_id=project_id,
            paper_id=paper_id,
            category=category,
            notes=notes or None,
        )
        session.add(item)
        logger.info(f"加入骨架: paper={paper_id} category={category}")

    return {"ok": True, "error": "", "counts": get_counts(project_id)}


def add_by_openalex(
    project_id: int, openalex_id: str, category: str, notes: str = ""
) -> dict:
    """
    按 OpenAlex ID 将论文加入骨架：
    论文若不在 papers 表则先从 OpenAlex 拉取并入库，再调 add 加入骨架。
    """
    from sources.openalex import get_work_by_id

    # ── 校验分类 ──
    if category not in LIMITS:
        return {"ok": False, "error": f"未知分类: {category}"}

    with get_session() as session:
        paper = (
            session.query(Paper)
            .filter_by(openalex_id=openalex_id)
            .first()
        )
        if not paper:
            # 从 OpenAlex 拉取论文详情
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
                stage="network",
                keywords=work.concepts or None,
                github_url=work.github_url,
            )
            session.add(paper)
            session.flush()  # 拿到 paper.id

    # 复用 add 的完整校验逻辑（上限/重复/写入）
    return add(project_id, paper.id, category, notes)


def remove(project_id: int, paper_id: int) -> dict:
    """从骨架中移除论文"""
    with get_session() as session:
        item = (
            session.query(CartItem)
            .filter_by(project_id=project_id, paper_id=paper_id)
            .first()
        )
        if not item:
            return {"ok": False, "error": "该论文不在骨架中"}
        session.delete(item)
        logger.info(f"移出骨架: paper={paper_id}")

    return {"ok": True, "error": "", "counts": get_counts(project_id)}


def change_category(project_id: int, paper_id: int, new_category: str) -> dict:
    """切换论文分类"""
    if new_category not in LIMITS:
        return {"ok": False, "error": f"未知分类: {new_category}"}

    with get_session() as session:
        item = (
            session.query(CartItem)
            .filter_by(project_id=project_id, paper_id=paper_id)
            .first()
        )
        if not item:
            return {"ok": False, "error": "该论文不在骨架中"}

        # 校验目标类上限（排除自身）
        current_counts = _counts(session, project_id)
        target_count = current_counts.get(new_category, 0)
        if item.category != new_category and target_count >= LIMITS[new_category]:
            return {
                "ok": False,
                "error": f"{_cat_label(new_category)}已满（{LIMITS[new_category]} 篇）",
            }

        old = item.category
        item.category = new_category
        logger.info(f"切换分类: paper={paper_id} {old} → {new_category}")

    return {"ok": True, "error": "", "counts": get_counts(project_id)}


def update_notes(project_id: int, paper_id: int, notes: str) -> dict:
    """更新备注"""
    with get_session() as session:
        item = (
            session.query(CartItem)
            .filter_by(project_id=project_id, paper_id=paper_id)
            .first()
        )
        if not item:
            return {"ok": False, "error": "该论文不在骨架中"}
        item.notes = notes or None
    return {"ok": True, "error": ""}


# ══════════════════════════════════════════════════════════
#  查询
# ══════════════════════════════════════════════════════════

def get_items(project_id: int) -> List[Dict]:
    """
    获取完整骨架列表，每项包含论文信息。
    按 category + added_at 排序。
    """
    category_order = {"foundation": 0, "mainstream": 1, "frontier": 2}

    with get_session() as session:
        rows = (
            session.query(CartItem, Paper)
            .join(Paper, CartItem.paper_id == Paper.id)
            .filter(CartItem.project_id == project_id)
            .all()
        )

        results = []
        for item, paper in rows:
            results.append({
                "cart_id": item.id,
                "paper_id": paper.id,
                "openalex_id": paper.openalex_id or "",
                "category": item.category,
                "category_order": category_order.get(item.category, 9),
                "title": paper.title,
                "authors": paper.authors or [],
                "year": paper.year,
                "venue": paper.venue or "",
                "doi": paper.doi or "",
                "arxiv_id": paper.arxiv_id or "",
                "abstract": paper.abstract or "",
                "cited_by_count": paper.cited_by_count or 0,
                "is_survey": paper.is_survey,
                "trunk_score": paper.trunk_score,
                "keywords": paper.keywords if isinstance(paper.keywords, list) else [],
                "github_url": paper.github_url or "",
                "notes": item.notes or "",
                "added_at": item.added_at.isoformat() if item.added_at else "",
            })

        results.sort(key=lambda x: (x["category_order"], x["added_at"]))
        return results


def get_counts(project_id: int) -> Dict[str, int]:
    """获取各类别当前数量"""
    with get_session() as session:
        return _counts(session, project_id)


def get_total(project_id: int) -> int:
    """骨架总篇数"""
    with get_session() as session:
        return session.query(CartItem).filter_by(project_id=project_id).count()


def is_full(project_id: int) -> bool:
    """是否已满"""
    return get_total(project_id) >= TOTAL_LIMIT


def is_in_cart(project_id: int, paper_id: int) -> bool:
    """某篇论文是否已在骨架中"""
    with get_session() as session:
        return (
            session.query(CartItem)
            .filter_by(project_id=project_id, paper_id=paper_id)
            .first()
        ) is not None


# ══════════════════════════════════════════════════════════
#  AI 分类建议
# ══════════════════════════════════════════════════════════

CLASSIFY_PROMPT = """\
你是一个学术论文分类助手。根据论文信息，判断它最适合放在用户骨架清单的哪个分类。

分类说明：
1. foundation（奠基理论）
   - 定义核心问题，提出基础模型或理论框架
   - 高被引（通常被引/年 > 50）
   - 发表时间较早（但不绝对）
2. mainstream（主流方法）
   - 代表当前领域的主流技术路线
   - 通常有可复现的开源代码
   - 是领域内广泛使用或对比的 Baseline
3. frontier（最新前沿）
   - 近 2 年发表的新工作
   - 代表了新的技术趋势或范式
   - 可能还没有大量引用，但有潜力

论文信息：
- 标题：{title}
- 摘要（前 500 字）：{abstract}
- 发表年份：{year}
- 被引量：{cited_by_count}
- 是否综述：{is_survey}

请输出严格 JSON：
{{
  "suggested_category": "foundation" 或 "mainstream" 或 "frontier",
  "confidence": "high" 或 "medium" 或 "low",
  "reason": "一句话理由（20 字以内）"
}}
"""


def suggest_category(paper: Paper) -> dict:
    """
    AI 建议这篇论文在骨架中的分类。
    先走规则引擎，规则判断不了再调 LLM。
    """
    title = (paper.title or "").lower()
    year = paper.year or 0
    cited = paper.cited_by_count or 0
    current_year = datetime.now().year
    cited_per_year = cited / max(current_year - year + 1, 1) if year > 0 else 0

    # ── 规则引擎 ──
    # 综述 → 全部分到 foundation
    if paper.is_survey:
        return {
            "suggested_category": "foundation",
            "confidence": "high",
            "reason": "领域综述，适合入门了解全貌",
        }

    # 高被引 + 早发表 → foundation
    if cited_per_year > 100 and year < current_year - 5:
        return {
            "suggested_category": "foundation",
            "confidence": "high",
            "reason": f"高被引奠基工作（{cited}次引用）",
        }

    # 近 2 年 → frontier
    if year >= current_year - 2:
        return {
            "suggested_category": "frontier",
            "confidence": "high",
            "reason": "近 2 年发表，代表最新进展",
        }

    # 其他情况调 LLM
    try:
        prompt = CLASSIFY_PROMPT.format(
            title=paper.title or "",
            abstract=(paper.abstract or "")[:500],
            year=year,
            cited_by_count=cited,
            is_survey="是" if paper.is_survey else "否",
        )
        raw = llm.chat_json(prompt, temperature=0.1)
        result = json.loads(raw)
        return {
            "suggested_category": result.get("suggested_category", "mainstream"),
            "confidence": result.get("confidence", "medium"),
            "reason": result.get("reason", ""),
        }
    except Exception as e:
        logger.warning(f"AI 分类建议失败: {e}")
        # 兜底
        if year >= current_year - 5 and cited_per_year > 20:
            return {"suggested_category": "mainstream", "confidence": "medium", "reason": "主流方法"}
        return {"suggested_category": "frontier", "confidence": "low", "reason": "默认分类"}


# ══════════════════════════════════════════════════════════
#  AI 诊断
# ══════════════════════════════════════════════════════════

DIAGNOSE_PROMPT = """\
你是一个研究指导助手。用户正在用"主干-分支-网络"三层漏斗搭建文献骨架，
骨架共 20 篇，分为三类：奠基(5篇) / 主流(10篇) / 前沿(5篇)。

当前骨架的论文列表：
{items_text}

请给出诊断建议：
1. 哪类数量不足或过多？
2. 覆盖的技术方向是否有重大盲区？
3. 有什么具体的补充方向建议？

输出严格 JSON：
{{
  "verdict": "overall" | "biased" | "insufficient",
  "summary": "一句话总体评价（15字以内）",
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议补充方向1", "建议补充方向2"]
}}
"""


def diagnose(project_id: int) -> dict:
    """
    诊断骨架完整性，返回 AI 建议。
    """
    counts = get_counts(project_id)
    total = sum(counts.values())

    # ── 先走规则诊断 ──
    issues = []
    suggestions = []
    verdict = "overall"

    if total == 0:
        return {
            "verdict": "insufficient",
            "summary": "骨架为空",
            "issues": ["还没有收录任何论文"],
            "suggestions": ["从主干检索结果中选择论文加入骨架"],
        }

    for cat, limit in LIMITS.items():
        count = counts.get(cat, 0)
        label = _cat_label(cat)
        if count == 0:
            issues.append(f"{label}（0/{limit}）一篇都没有")
            suggestions.append(f"补充一些{label}论文")
            verdict = "insufficient"
        elif count < limit // 2:
            issues.append(f"{label}只有 {count}/{limit}")
            suggestions.append(f"{label}还可以补充")
            if verdict != "insufficient":
                verdict = "biased"

    if total < TOTAL_LIMIT:
        suggestions.append(f"骨架还有 {TOTAL_LIMIT - total} 个空位，可以继续添加")

    # ── 如果已有足够论文，调 LLM 做更深层诊断 ──
    if total >= 5:
        items = get_items(project_id)
        lines = []
        for it in items:
            label = _cat_label(it["category"])
            lines.append(f"[{label}] {it['title']} ({it['year']})")
        items_text = "\n".join(lines)

        try:
            raw = llm.chat_json(
                DIAGNOSE_PROMPT.format(items_text=items_text),
                temperature=0.3,
            )
            llm_result = json.loads(raw)
            # 合并 LLM 诊断
            if llm_result.get("issues"):
                issues.extend(llm_result["issues"][:3])
            if llm_result.get("suggestions"):
                suggestions.extend(llm_result["suggestions"][:3])
            if not verdict or verdict == "overall":
                verdict = llm_result.get("verdict", "overall")
        except Exception as e:
            logger.warning(f"AI 骨架诊断失败: {e}")

    return {
        "verdict": verdict,
        "counts": counts,
        "total": total,
        "issues": issues[:5],
        "suggestions": suggestions[:5],
    }


# ══════════════════════════════════════════════════════════
#  BibTeX 导出
# ══════════════════════════════════════════════════════════

def export_bibtex(project_id: int) -> str:
    """将骨架中的论文导出为 BibTeX 格式"""
    items = get_items(project_id)
    entries = []

    for i, item in enumerate(items):
        # 生成 cite key
        first_author = ""
        if item["authors"] and len(item["authors"]) > 0:
            parts = item["authors"][0].split()
            first_author = parts[-1] if parts else "Unknown"
        cite_key = f"{first_author}{item['year'] or ''}_{item['paper_id']}"

        # 作者列表
        authors = " and ".join(item["authors"][:5]) if item["authors"] else "Unknown"

        # BibTeX 条目
        entry = f"""@article{{{cite_key},
  title = {{{item['title']}}},
  author = {{{authors}}},
  year = {{{item['year'] or ''}}},
  journal = {{{item['venue'] or ''}}},
"""
        if item["doi"]:
            entry += f"  doi = {{{item['doi']}}},\n"
        if item.get("notes"):
            entry += f"  note = {{{item['notes']}}},\n"
        entry += "}"

        entries.append(entry)

    return "\n\n".join(entries)


# ══════════════════════════════════════════════════════════
#  内部工具
# ══════════════════════════════════════════════════════════

def _counts(session, project_id: int) -> Dict[str, int]:
    """（内部）各类别计数"""
    from sqlalchemy import func as sa_func

    rows = (
        session.query(CartItem.category, sa_func.count(CartItem.id))
        .filter_by(project_id=project_id)
        .group_by(CartItem.category)
        .all()
    )
    result = {"foundation": 0, "mainstream": 0, "frontier": 0}
    for cat, cnt in rows:
        if cat in result:
            result[cat] = cnt
    return result


def _cat_label(cat: str) -> str:
    return {"foundation": "奠基理论", "mainstream": "主流方法", "frontier": "最新前沿"}.get(cat, cat)
