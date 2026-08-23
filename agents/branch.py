"""
分支深挖服务 —— 验证骨架论文的方法论覆盖
三种模式：探针匹配 / AI 推荐探针 / 全景扫描

降级链：摘要 → LLM 回忆 → HTML 全文 → 引用上下文 → 仅摘要
（MVP 先实现摘要 + LLM 回忆 + HTML 全文，PDF 下载后续补充）
"""
import json
import re
from dataclasses import dataclass, field

from storage.mysql_db import get_session
from storage.models import Paper, CartItem, AnalysisResult, Project
from sources import openalex as oa
from llm import client as llm
from utils.log import setup_logger
from prompt.branch import PROBE_MATCH_PROMPT, LANDSCAPE_PROMPT, AI_SUGGEST_PROMPT

logger = setup_logger("branch")

# ── 分析模式 ──
MODE_PROBE = "probe_match"
MODE_AI_SUGGEST = "ai_suggest"
MODE_LANDSCAPE = "landscape"


@dataclass
class BranchPaperResult:
    """单篇论文的分支分析结果"""
    paper_id: int
    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    venue: str = ""
    doi: str = ""
    abstract: str = ""
    cited_by_count: int = 0
    category: str = ""               # 骨架分类: foundation/mainstream/frontier
    mode: str = ""                   # 分析模式: probe_match/ai_suggest/landscape
    # 分析结果
    content_level: int = 5          # 1-5（数字越小内容越完整）
    content_source: str = "abstract"
    method_summary: str = ""
    probe_match: bool = False
    probe_confidence: str = "none"  # high / medium / low / none
    key_findings: str = ""
    optimization_method: str = ""
    error: str = ""


# ══════════════════════════════════════════════════════════
#  主入口
# ══════════════════════════════════════════════════════════

def run_analysis(
    project_id: int,
    mode: str = MODE_PROBE,
    probe: str = "",
    category: str = "",
    on_progress=None,
) -> list[BranchPaperResult]:
    """
    执行分支深挖分析。

    Args:
        project_id: 项目 ID
        mode: 分析模式
        probe: 技术探针（probe_match 模式必填，其他模式可选）
        category: 分类范围（foundation/mainstream/frontier，空=全部）
        on_progress: 进度回调 fn(current, total, paper_title)

    Returns:
        分析结果列表
    """
    if mode not in (MODE_PROBE, MODE_AI_SUGGEST, MODE_LANDSCAPE):
        raise ValueError(f"未知分析模式: {mode}")

    if mode == MODE_PROBE and not probe:
        raise ValueError("探针匹配模式必须提供技术探针")

    # 获取骨架中的论文（可按分类过滤）
    papers = _get_skeleton_papers(project_id, category)
    if not papers:
        logger.warning(f"项目 {project_id} 骨架为空，无法执行分支分析")
        return []

    logger.info(f"开始分支分析: mode={mode}, probe={probe}, category={category or 'all'}, papers={len(papers)}")

    results = []
    for i, paper in enumerate(papers):
        if on_progress:
            on_progress(i + 1, len(papers), paper["title"])

        try:
            result = _analyze_single_paper(paper, mode, probe)
            result.category = paper.get("category", "")
            result.mode = mode
            results.append(result)

            # 持久化到 AnalysisResult 表
            _save_result(paper["paper_id"], result)

        except Exception as e:
            logger.error(f"分析论文 {paper['paper_id']} 失败: {e}")
            result = BranchPaperResult(
                paper_id=paper["paper_id"],
                title=paper["title"],
                category=paper.get("category", ""),
                mode=mode,
                error=str(e),
            )
            results.append(result)

    # 汇总降级链分布
    level_dist = {}
    for r in results:
        src = f"Level {r.content_level} ({r.content_source})"
        level_dist[src] = level_dist.get(src, 0) + 1
    dist_str = " | ".join(f"{k}: {v}篇" for k, v in level_dist.items())
    logger.info(f"分支分析完成: {len(results)} 篇 | 内容来源分布: {dist_str}")

    return results


def get_stored_results(project_id: int, mode: str = "") -> list[BranchPaperResult]:
    """读取已存储的分析结果（不重新执行分析），可按模式过滤"""
    with get_session() as session:
        q = (
            session.query(AnalysisResult, Paper, CartItem)
            .join(Paper, AnalysisResult.paper_id == Paper.id)
            .join(CartItem, CartItem.paper_id == Paper.id)
            .filter(CartItem.project_id == project_id)
        )
        if mode:
            q = q.filter(AnalysisResult.mode == mode)

        results = []
        for ar, paper, ci in q.all():
            results.append(BranchPaperResult(
                paper_id=paper.id,
                title=paper.title,
                authors=paper.authors or [],
                year=paper.year,
                venue=paper.venue or "",
                doi=paper.doi or "",
                abstract=paper.abstract or "",
                cited_by_count=paper.cited_by_count or 0,
                category=ci.category,
                mode=ar.mode or "",
                content_level=ar.content_level or 5,
                content_source=ar.content_source or "abstract",
                method_summary=ar.method_summary or "",
                probe_match=ar.probe_match or False,
                probe_confidence=ar.probe_confidence or "none",
                optimization_method=ar.optimization_method or "",
                key_findings=ar.key_findings or "",
            ))
        return results


# ══════════════════════════════════════════════════════════
#  单篇论文分析（核心逻辑）
# ══════════════════════════════════════════════════════════

def _analyze_single_paper(paper: dict, mode: str, probe: str) -> BranchPaperResult:
    """对单篇论文执行分支分析"""

    # ── 第一步：降级链获取全文 ──
    full_text, content_level, content_source = _fetch_full_text(
        openalex_id=paper["openalex_id"],
        title=paper["title"],
        abstract=paper["abstract"],
    )

    # ── 第二步：根据模式分析 ──
    if mode == MODE_PROBE:
        return _analyze_probe_match(paper, full_text, content_level,
                                     content_source, probe)
    elif mode == MODE_AI_SUGGEST:
        return _analyze_ai_suggest(paper, full_text, content_level,
                                    content_source)
    else:
        return _analyze_landscape(paper, full_text, content_level,
                                   content_source)


# ══════════════════════════════════════════════════════════
#  降级链：全文获取
# ══════════════════════════════════════════════════════════

def _fetch_full_text(openalex_id: str, title: str, abstract: str):
    """
    五级降级链获取论文全文。

    Returns:
        (full_text, content_level, content_source)
        - content_level: 1-5（1 最完整，5 仅摘要）
        - content_source: 来源标签
    """
    short_title = title[:40]

    # ── Level 2: HTML 全文 ──
    if not openalex_id:
        logger.warning(f"[降级链] 论文无 openalex_id，跳过 HTML: {short_title}")
    else:
        html_text = oa.fetch_full_text_html(openalex_id)
        if html_text and len(html_text) > 1000:
            logger.info(f"[Level 2 ✓] HTML 全文获取成功 ({len(html_text)} 字符): {short_title}")
            return html_text, 2, "html_full"
        else:
            logger.info(f"[Level 2 ✗] HTML 全文获取失败，降级: {short_title}")

    # ── Level 3: LLM 回忆（基于标题+摘要） ──
    if abstract and len(abstract) > 100:
        logger.info(f"[Level 3] 使用 LLM 回忆: {short_title}")
        recalled = _llm_recall(title, abstract)
        if recalled:
            logger.info(f"[Level 3 ✓] LLM 回忆成功 ({len(recalled)} 字符): {short_title}")
            return recalled, 3, "llm_recall"
        else:
            logger.info(f"[Level 3 ✗] LLM 无把握，降级: {short_title}")

    # ── Level 5: 仅摘要 ──
    if abstract:
        logger.warning(f"[Level 5] 仅使用摘要（准确度最低）: {short_title}")
        return abstract, 5, "abstract_only"

    logger.warning(f"[Level 5] 无任何内容可用: {short_title}")
    return "", 5, "none"


def _llm_recall(title: str, abstract: str) -> str | None:
    """Level 3: LLM 基于训练知识回忆论文的方法论内容"""
    prompt = f"""请根据你对以下论文的了解，回忆该论文的核心方法论内容。
如果不确定，请基于摘要推测，但标注"[推测]"。

论文标题：{title}
论文摘要：{abstract}

请输出该论文的：
1. 主要方法/模型名称
2. 核心技术架构（如网络结构、优化目标等）
3. 关键创新点

请用中文回答，200字以内。如果完全不了解，只说"无把握"。"""

    try:
        response = llm.chat(prompt, temperature=0.3, max_tokens=500)
        if "无把握" in response and len(response) < 20:
            return None
        return response
    except Exception as e:
        logger.warning(f"LLM 回忆失败: {e}")
        return None


# ══════════════════════════════════════════════════════════
#  三种分析模式
# ══════════════════════════════════════════════════════════





def _analyze_probe_match(
    paper: dict, full_text: str, content_level: int,
    content_source: str, probe: str,
) -> BranchPaperResult:
    """探针匹配分析"""

    # 截断文本（避免 token 超限）
    text_for_llm = full_text[:8000] if full_text else paper.get("abstract", "")

    prompt = PROBE_MATCH_PROMPT.format(
        probe=probe,
        title=paper["title"],
        content_source=content_source,
        content=text_for_llm,
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.1)
        data = json.loads(raw)
    except Exception as e:
        logger.warning(f"探针匹配 LLM 调用失败: {e}")
        # 兜底：仅基于摘要做简单关键词匹配
        data = _simple_keyword_match(paper, probe)

    return BranchPaperResult(
        paper_id=paper["paper_id"],
        title=paper["title"],
        authors=paper.get("authors", []),
        year=paper.get("year"),
        venue=paper.get("venue", ""),
        doi=paper.get("doi", ""),
        abstract=paper.get("abstract", ""),
        cited_by_count=paper.get("cited_by_count", 0),
        content_level=content_level,
        content_source=content_source,
        method_summary=data.get("method_summary", ""),
        probe_match=bool(data.get("probe_match", False)),
        probe_confidence=data.get("probe_confidence", "none"),
        key_findings=data.get("key_findings", ""),
        optimization_method=data.get("optimization_method", ""),
    )






def _analyze_landscape(
    paper: dict, full_text: str, content_level: int, content_source: str,
) -> BranchPaperResult:
    """全景扫描分析（无探针）"""

    text_for_llm = full_text[:8000] if full_text else paper.get("abstract", "")

    prompt = LANDSCAPE_PROMPT.format(
        title=paper["title"],
        content_source=content_source,
        content=text_for_llm,
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.2)
        data = json.loads(raw)
    except Exception as e:
        logger.warning(f"全景扫描 LLM 调用失败: {e}")
        data = {"method_summary": "分析失败", "key_innovation": "", "limitations": ""}

    key_parts = []
    if data.get("method_category"):
        key_parts.append(f"类别: {data['method_category']}")
    if data.get("key_innovation"):
        key_parts.append(f"创新: {data['key_innovation']}")
    if data.get("limitations"):
        key_parts.append(f"局限: {data['limitations']}")

    return BranchPaperResult(
        paper_id=paper["paper_id"],
        title=paper["title"],
        authors=paper.get("authors", []),
        year=paper.get("year"),
        venue=paper.get("venue", ""),
        doi=paper.get("doi", ""),
        abstract=paper.get("abstract", ""),
        cited_by_count=paper.get("cited_by_count", 0),
        content_level=content_level,
        content_source=content_source,
        method_summary=data.get("method_summary", ""),
        probe_match=False,  # 全景模式不做匹配
        probe_confidence="none",
        key_findings=data.get("key_innovation", ""),
        optimization_method=data.get("method_category", ""),
    )






def _analyze_ai_suggest(
    paper: dict, full_text: str, content_level: int, content_source: str,
) -> BranchPaperResult:
    """AI 探针推荐分析"""

    prompt = AI_SUGGEST_PROMPT.format(
        title=paper["title"],
        abstract=paper.get("abstract", "")[:2000],
        existing_probe="(无)" if not paper.get("_probe") else paper["_probe"],
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.2)
        data = json.loads(raw)
    except Exception as e:
        logger.warning(f"AI 探针推荐 LLM 调用失败: {e}")
        data = {"method_summary": "分析失败", "suggested_probe": "", "probe_reason": ""}

    return BranchPaperResult(
        paper_id=paper["paper_id"],
        title=paper["title"],
        authors=paper.get("authors", []),
        year=paper.get("year"),
        venue=paper.get("venue", ""),
        doi=paper.get("doi", ""),
        abstract=paper.get("abstract", ""),
        cited_by_count=paper.get("cited_by_count", 0),
        content_level=content_level,
        content_source=content_source,
        method_summary=data.get("method_summary", ""),
        probe_match=False,
        probe_confidence="none",
        key_findings=data.get("suggested_probe", ""),
        optimization_method=data.get("probe_reason", ""),
    )


# ══════════════════════════════════════════════════════════
#  工具函数
# ══════════════════════════════════════════════════════════

def _get_skeleton_papers(project_id: int, category: str = "") -> list[dict]:
    """获取骨架中的论文列表（可按分类过滤，category 为空=全部）"""
    with get_session() as session:
        q = (
            session.query(CartItem, Paper)
            .join(Paper, CartItem.paper_id == Paper.id)
            .filter(CartItem.project_id == project_id)
        )
        if category:
            q = q.filter(CartItem.category == category)
        rows = q.all()
        results = []
        for item, paper in rows:
            results.append({
                "paper_id": paper.id,
                "openalex_id": paper.openalex_id or "",
                "title": paper.title or "",
                "authors": paper.authors or [],
                "year": paper.year,
                "venue": paper.venue or "",
                "doi": paper.doi or "",
                "arxiv_id": paper.arxiv_id or "",
                "abstract": paper.abstract or "",
                "cited_by_count": paper.cited_by_count or 0,
                "category": item.category,
            })
        return results


def _save_result(paper_id: int, result: BranchPaperResult):
    """将分析结果持久化到 AnalysisResult 表（按 paper_id + mode 唯一）"""
    with get_session() as session:
        existing = (
            session.query(AnalysisResult)
            .filter_by(paper_id=paper_id, mode=result.mode)
            .first()
        )
        if existing:
            # 更新已有记录
            existing.content_level = result.content_level
            existing.content_source = result.content_source
            existing.method_summary = result.method_summary
            existing.probe_match = result.probe_match
            existing.probe_confidence = result.probe_confidence
            existing.optimization_method = result.optimization_method
            existing.key_findings = result.key_findings
        else:
            # 新建记录
            ar = AnalysisResult(
                paper_id=paper_id,
                mode=result.mode or "probe_match",
                content_level=result.content_level,
                content_source=result.content_source,
                method_summary=result.method_summary,
                probe_match=result.probe_match,
                probe_confidence=result.probe_confidence,
                optimization_method=result.optimization_method,
                key_findings=result.key_findings,
            )
            session.add(ar)

    logger.debug(f"保存分析结果: paper={paper_id}, mode={result.mode}, match={result.probe_match}")


def _simple_keyword_match(paper: dict, probe: str) -> dict:
    """LLM 失败时的兜底：基于摘要做简单关键词匹配"""
    abstract = (paper.get("abstract") or "").lower()
    probe_lower = probe.lower()

    # 提取探针中的关键词（按逗号、空格分割）
    keywords = re.split(r"[,;\s]+", probe_lower)
    keywords = [kw for kw in keywords if len(kw) > 2]

    matched = any(kw in abstract for kw in keywords)

    return {
        "method_summary": f"（关键词匹配）{'可能' if matched else '未'}使用 {probe}",
        "probe_match": matched,
        "probe_confidence": "low" if matched else "none",
        "key_findings": "",
        "optimization_method": "",
    }


def get_content_level_label(level: int) -> str:
    """返回内容来源的可读标签"""
    return {
        1: "📄 PDF 全文",
        2: "🌐 HTML 全文",
        3: "🧠 LLM 回忆",
        4: "📚 引用上下文",
        5: "📋 摘要",
    }.get(level, "❓ 未知")


def get_confidence_label(confidence: str) -> tuple[str, str]:
    """返回 (emoji, 文字描述)"""
    return {
        "high":   ("🟢", "高度匹配"),
        "medium": ("🟡", "中等匹配"),
        "low":    ("🟠", "低度匹配"),
        "none":   ("⚪", "未匹配"),
    }.get(confidence, ("❓", "未知"))


def get_project_probe(project_id: int) -> str:
    """从项目中获取技术探针"""
    with get_session() as session:
        project = session.get(Project, project_id)
        if project and project.tech_probe:
            return project.tech_probe
    return ""
