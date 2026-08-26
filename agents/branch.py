"""
分支深挖服务 —— 验证骨架论文的方法论覆盖
三种模式：探针匹配 / AI 推荐探针 / 全景扫描

结构化全文降级链（_fetch_full_text）：
    GROBID XML → PDF 落盘+分节 → HTML 全文 → LLM 回忆 → 仅摘要
下游按分析模式用 select_context_for_mode 选节组装 LLM 上下文，
替代原先 full_text[:8000] 的硬截断。
"""
import json
import re
from dataclasses import dataclass, field

from storage.mysql_db import get_session
from storage.models import Paper, CartItem, AnalysisResult, Project
from sources import openalex as oa
from sources import pdf_structure
from sources import tei_parse
from llm import client as llm
from utils.log import setup_logger
from prompt.branch import (
    PROBE_MATCH_PROMPT, LANDSCAPE_PROMPT, AI_SUGGEST_PROMPT, PAPER_PROFILE_PROMPT
)

logger = setup_logger("branch")

# ── 分析模式 ──
MODE_PROBE = "probe_match"
MODE_AI_SUGGEST = "ai_suggest"
MODE_LANDSCAPE = "landscape"


# ══════════════════════════════════════════════════════════
#  结构化全文（替代原先的 flat full_text 字符串）
# ══════════════════════════════════════════════════════════
@dataclass
class StructuredFullText:
    """分支分析用的结构化全文。

    - sections: 分节列表 [{level,title,page_start,page_end,char_len,text}]
    - flat: 扁平全文兜底（非结构化来源 / 调试用）
    - source: grobid_xml | pdf_pymupdf | html_full | llm_recall | abstract_only | none
    - level: 兼容旧语义（2=有全文, 3=LLM回忆, 5=仅摘要）
    - pdf_path: 落盘的 PDF 路径（PDF 来源时）
    """
    title: str | None
    abstract: str
    sections: list
    source: str
    level: int
    flat: str
    pdf_path: str | None = None


# ══════════════════════════════════════════════════════════
#  论文方法学画像（PaperProfile）—— 跨模式共享上下文
# ══════════════════════════════════════════════════════════
@dataclass
class PaperProfile:
    """论文级方法学画像（基于标题+摘要，论文级，带 DB 缓存）。

    作用：为 Landscape / Probe 提供共享领域上下文，
    避免两 Prompt 各自重复判断论文领域。
    """
    research_domain: str = ""
    subdomain: str = ""
    research_type: str = ""
    methodology_type: str = ""
    research_objects: list = field(default_factory=list)
    candidate_method_families: list = field(default_factory=list)


def _profile_context(profile: PaperProfile | None) -> str:
    """把 PaperProfile 渲染成注入 Prompt 的共享上下文文本"""
    if not profile or not profile.research_domain:
        return ""
    parts = [f"领域: {profile.research_domain}"]
    if profile.subdomain:
        parts.append(f"子领域: {profile.subdomain}")
    if profile.research_type:
        parts.append(f"研究类型: {profile.research_type}")
    if profile.methodology_type:
        parts.append(f"方法论范式: {profile.methodology_type}")
    if profile.research_objects:
        parts.append("研究对象: " + ", ".join(profile.research_objects[:6]))
    if profile.candidate_method_families:
        parts.append("候选方法族: " + ", ".join(profile.candidate_method_families[:8]))
    return "\n".join(parts)


def generate_paper_profile(paper_id: int, title: str, abstract: str) -> PaperProfile:
    """生成（或读取缓存）论文方法学画像。

    - 先从 ai_papers.method_profile 读缓存，命中直接返回（避免重复 LLM 调用）；
    - 未命中则调用 PAPER_PROFILE_PROMPT，结果写回缓存。
    任何异常都降级为空画像，不影响主流程。
    """
    # 1) 读缓存
    try:
        with get_session() as session:
            paper = session.get(Paper, paper_id)
            if paper and paper.method_profile:
                cached = paper.method_profile
                if isinstance(cached, dict) and cached.get("research_domain"):
                    return PaperProfile(
                        research_domain=cached.get("research_domain", ""),
                        subdomain=cached.get("subdomain", ""),
                        research_type=cached.get("research_type", ""),
                        methodology_type=cached.get("methodology_type", ""),
                        research_objects=cached.get("research_objects") or [],
                        candidate_method_families=cached.get("candidate_method_families") or [],
                    )
    except Exception as e:
        logger.warning(f"读取 PaperProfile 缓存失败（继续重新生成）: {e}")

    # 2) 生成
    prompt = PAPER_PROFILE_PROMPT.format(
        title=title,
        abstract=abstract or "(无摘要)",
    )
    data: dict = {}
    try:
        raw = llm.chat_json(prompt, temperature=0.1)
        data = json.loads(raw)
    except Exception as e:
        logger.warning(f"PaperProfile LLM 调用失败: {e}")

    profile = PaperProfile(
        research_domain=data.get("research_domain", "") or "",
        subdomain=data.get("subdomain", "") or "",
        research_type=data.get("research_type", "") or "",
        methodology_type=data.get("methodology_type", "") or "",
        research_objects=data.get("research_objects") or [],
        candidate_method_families=data.get("candidate_method_families") or [],
    )

    # 3) 写回缓存（非致命）
    try:
        with get_session() as session:
            paper = session.get(Paper, paper_id)
            if paper:
                paper.method_profile = {
                    "research_domain": profile.research_domain,
                    "subdomain": profile.subdomain,
                    "research_type": profile.research_type,
                    "methodology_type": profile.methodology_type,
                    "research_objects": profile.research_objects,
                    "candidate_method_families": profile.candidate_method_families,
                }
    except Exception as e:
        logger.warning(f"PaperProfile 缓存写回失败（非致命）: {e}")

    return profile


# 各分析模式优先选取的章节关键词（命中标题即纳入上下文）
_MODE_SECTION_KEYWORDS = {
    MODE_PROBE: ["method", "model", "architecture", "approach", "experiment",
                 "evaluation", "result", "study", "framework"],
    MODE_AI_SUGGEST: ["method", "model", "architecture", "conclusion", "discussion"],
    MODE_LANDSCAPE: None,  # None = 全部章节
}


def select_context_for_mode(sft: StructuredFullText, mode: str, paper: dict,
                            budget: int = 8000) -> str:
    """
    按分析模式从结构化全文中选节组装 LLM 上下文。

    关键改进（替代原先 full_text[:8000] 硬截断）：
      - 永远先放 title + abstract；
      - 按模式关键词匹配章节（landscape 用全部章节）；
      - 预算内按文档序补节；仅在「最后一节」超出预算时才截断该节内部，
        绝不在句中腰斩一节。
    非结构化来源（llm_recall/abstract_only）无 sections，直接截断 flat。
    """
    parts: list[str] = []
    if sft.title:
        parts.append(f"Title: {sft.title}")
    if sft.abstract:
        parts.append(f"Abstract: {sft.abstract}")
    used = sum(len(p) for p in parts) + 2 * len(parts)

    sections = sft.sections or []
    if not sections:
        remaining = sft.flat or paper.get("abstract", "") or ""
        avail = budget - used
        if avail > 0:
            parts.append(remaining[:avail])
        return "\n\n".join(parts)

    kws = _MODE_SECTION_KEYWORDS.get(mode)
    if kws is None:
        selected = sections
    else:
        selected = [s for s in sections if any(k in s["title"].lower() for k in kws)]
        if not selected:
            selected = sections  # 模式关键词没命中任何节时退回全部，避免空上下文

    for s in selected:
        body = s.get("text", "") or ""
        chunk = f"\n\n## {s['title']}\n{body}"
        if used + len(chunk) <= budget:
            parts.append(chunk)
            used += len(chunk)
        else:
            avail = budget - used
            if avail > 200:
                parts.append(chunk[:avail])
            break
    return "\n\n".join(parts)


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
    optimization_method: str = ""                  # 兼容字段：回填 implementation_or_application
    # ── 增强字段（跨领域重构）──
    usage_role: str = ""                           # core/auxiliary/baseline/comparison/mentioned/none
    implementation_or_application: str = ""
    probe_relation: str = ""
    research_question: str = ""
    methodology_type: str = ""
    method_category: str = ""
    method_components: list = field(default_factory=list)
    research_design: str = ""
    key_innovation: str = ""
    limitations: str = ""
    evidence: list = field(default_factory=list)   # [{section, description}]
    profile: "PaperProfile | None" = None
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
                usage_role=ar.usage_role or "",
                implementation_or_application=ar.implementation_or_application or "",
                probe_relation=ar.probe_relation or "",
                research_question=ar.research_question or "",
                methodology_type=ar.methodology_type or "",
                method_category=ar.method_category or "",
                method_components=ar.method_components or [],
                research_design=ar.research_design or "",
                key_innovation=ar.key_innovation or "",
                limitations=ar.limitations or "",
                evidence=ar.evidence or [],
            ))
        return results


# ══════════════════════════════════════════════════════════
#  单篇论文分析（核心逻辑）
# ══════════════════════════════════════════════════════════

def _analyze_single_paper(paper: dict, mode: str, probe: str) -> BranchPaperResult:
    """对单篇论文执行分支分析"""

    # ── 第一步：结构化全文降级链 ──
    sft = _fetch_full_text(
        openalex_id=paper["openalex_id"],
        title=paper["title"],
        abstract=paper["abstract"],
    )

    # ── PaperProfile（论文方法学画像，跨模式共享上下文，带 DB 缓存）──
    # ai_suggest 不依赖领域画像，跳过以免浪费一次 LLM 调用
    profile = None
    if mode != MODE_AI_SUGGEST:
        profile = generate_paper_profile(paper["paper_id"], paper["title"], paper["abstract"])

    # ── 第二步：根据模式分析 ──
    if mode == MODE_PROBE:
        return _analyze_probe_match(paper, sft, probe, profile)
    elif mode == MODE_AI_SUGGEST:
        return _analyze_ai_suggest(paper, sft)
    else:
        return _analyze_landscape(paper, sft, profile)


# ══════════════════════════════════════════════════════════
#  降级链：全文获取
# ══════════════════════════════════════════════════════════

def _fetch_full_text(openalex_id: str, title: str, abstract: str) -> StructuredFullText:
    """
    结构化全文降级链（替代原先返回扁平字符串的版本）。

    链路（质量从高到低）：
      Level 2a  GROBID XML（OpenAlex 主源：嵌套分节、零页眉噪声）
      Level 2b  PDF 落盘 → PyMuPDF 启发式分节（OpenAlex 无 GROBID 时兜底）
      Level 2c  HTML 全文（扁平，按整篇当单节）
      Level 3   LLM 回忆（基于标题+摘要，标注[推测]）
      Level 5   仅摘要

    Returns:
        StructuredFullText（sections 可能为空，下游 select_context_for_mode 会兜底）
    """
    short_title = title[:40]
    paper_oa = oa.get_work_by_id(openalex_id) if openalex_id else None

    # ── Level 2a: GROBID XML（结构化主源）──
    if paper_oa is not None:
        try:
            xml = oa.fetch_grobid_xml(openalex_id, paper=paper_oa)
            if xml:
                g_abs, g_secs = tei_parse.parse_tei(xml)
                if g_secs or g_abs:
                    sections = [{
                        "level": s.get("level", 1),
                        "title": s.get("title", ""),
                        "page_start": 0, "page_end": 0,
                        "char_len": len(s.get("text", "")),
                        "text": s.get("text", ""),
                    } for s in g_secs]
                    flat = (g_abs or "") + "\n" + "\n".join(s["text"] for s in g_secs)
                    logger.info(f"[Level 2a ✓] GROBID XML 解析成功 ({len(sections)} 分节): {short_title}")
                    return StructuredFullText(
                        title=title, abstract=g_abs or abstract, sections=sections,
                        source="grobid_xml", level=2, flat=flat,
                    )
        except Exception as e:
            logger.warning(f"[Level 2a ✗] GROBID XML 解析失败，降级: {e}")

    # ── Level 2b: PDF 落盘 → 启发式分节 ──
    if paper_oa is not None:
        try:
            path = oa.download_pdf(openalex_id, title, paper=paper_oa)
            if path:
                res = pdf_structure.extract_pdf_sections(path)
                secs = res.get("sections") or []
                if secs:
                    flat = (res.get("abstract") or "") + "\n" + "\n".join(
                        s.get("text", "") for s in secs)
                    logger.info(f"[Level 2b ✓] PDF 分节成功 ({len(secs)} 分节, {path}): {short_title}")
                    return StructuredFullText(
                        title=title, abstract=res.get("abstract") or abstract,
                        sections=secs, source="pdf_pymupdf", level=2,
                        flat=flat, pdf_path=path,
                    )
        except Exception as e:
            logger.warning(f"[Level 2b ✗] PDF 处理失败，降级: {e}")

    # ── Level 2c: HTML 全文（扁平，整篇当单节）──
    if openalex_id:
        try:
            html = oa.fetch_full_text_html(openalex_id)
            if html and len(html) > 1000:
                logger.info(f"[Level 2c ✓] HTML 全文获取成功 ({len(html)} 字符): {short_title}")
                return StructuredFullText(
                    title=title, abstract=abstract,
                    sections=[{"level": 1, "title": "Full Text",
                               "page_start": 0, "page_end": 0,
                               "char_len": len(html), "text": html}],
                    source="html_full", level=2, flat=html,
                )
        except Exception as e:
            logger.warning(f"[Level 2c ✗] HTML 获取失败，降级: {e}")

    # ── Level 3: LLM 回忆 ──
    if abstract and len(abstract) > 100:
        logger.info(f"[Level 3] 使用 LLM 回忆: {short_title}")
        recalled = _llm_recall(title, abstract)
        if recalled:
            logger.info(f"[Level 3 ✓] LLM 回忆成功 ({len(recalled)} 字符): {short_title}")
            return StructuredFullText(
                title=title, abstract=abstract, sections=[],
                source="llm_recall", level=3, flat=recalled,
            )

    # ── Level 5: 仅摘要 ──
    if abstract:
        logger.warning(f"[Level 5] 仅使用摘要（准确度最低）: {short_title}")
        return StructuredFullText(
            title=title, abstract=abstract, sections=[],
            source="abstract_only", level=5, flat=abstract,
        )

    logger.warning(f"[Level 5] 无任何内容可用: {short_title}")
    return StructuredFullText(
        title=title, abstract="", sections=[],
        source="none", level=5, flat="",
    )


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

请用中文回答，500字以内。如果完全不了解，只说"无把握"。"""

    try:
        response = llm.chat(prompt, temperature=0.3, max_tokens=500)
        if "无把握" in response and len(response) < 20:
            return None
        return response
    except Exception as e:
        logger.warning(f"LLM 回忆失败: {e}")
        return None


# ══════════════════════════════════════════════════════════════════════
#  工具：usage_role / evidence 规范化 + 业务层 probe_match 计算
# ══════════════════════════════════════════════════════════════════════
_USAGE_ROLES = {"core", "auxiliary", "baseline", "comparison", "mentioned", "none"}
# 这些角色表示论文"实际使用/实质性讨论"了该方法 → 匹配为 True
_MATCHING_ROLES = {"core", "auxiliary", "baseline", "comparison"}


def _normalize_usage_role(value) -> str:
    v = (value or "").strip().lower()
    return v if v in _USAGE_ROLES else "none"


def _compute_probe_match(usage_role: str) -> bool:
    """业务层统一计算 probe_match，不让 LLM 自由决定 true/false。"""
    return _normalize_usage_role(usage_role) in _MATCHING_ROLES


def _normalize_evidence(value) -> list:
    """规范化 evidence 为 [{section, description}]，过滤非法项。"""
    if not isinstance(value, list):
        return []
    out = []
    for item in value[:6]:
        if isinstance(item, dict):
            out.append({
                "section": str(item.get("section") or ""),
                "description": str(item.get("description") or ""),
            })
    return out


# ══════════════════════════════════════════════════════════
#  三种分析模式
# ══════════════════════════════════════════════════════════





def _analyze_probe_match(
    paper: dict, sft: StructuredFullText, probe: str, profile: PaperProfile | None,
) -> BranchPaperResult:
    """探针匹配分析（方法语义匹配 + usage_role + evidence）"""

    # 按模式选节组装上下文（替代原先 full_text[:8000] 硬截断）
    text_for_llm = select_context_for_mode(sft, MODE_PROBE, paper)

    prompt = PROBE_MATCH_PROMPT.format(
        probe=probe,
        profile=_profile_context(profile),
        title=paper["title"],
        content_source=sft.source,
        content=text_for_llm,
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.1)
        data = json.loads(raw)
    except Exception as e:
        logger.warning(f"探针匹配 LLM 调用失败: {e}")
        # 兜底：仅基于摘要做简单关键词匹配（确定性产出 usage_role）
        data = _simple_keyword_match(paper, probe)

    # 业务层统一计算 probe_match，不让 LLM 自由决定 true/false
    usage_role = _normalize_usage_role(data.get("usage_role", "none"))
    evidence = _normalize_evidence(data.get("evidence"))
    implementation = data.get("implementation_or_application", "") or ""

    return BranchPaperResult(
        paper_id=paper["paper_id"],
        title=paper["title"],
        authors=paper.get("authors", []),
        year=paper.get("year"),
        venue=paper.get("venue", ""),
        doi=paper.get("doi", ""),
        abstract=paper.get("abstract", ""),
        cited_by_count=paper.get("cited_by_count", 0),
        content_level=sft.level,
        content_source=sft.source,
        method_summary=data.get("method_summary", ""),
        probe_match=_compute_probe_match(usage_role),
        probe_confidence=data.get("confidence", "none") or "none",
        key_findings=data.get("key_findings", ""),
        optimization_method=implementation,          # 兼容字段：回填
        usage_role=usage_role,
        implementation_or_application=implementation,
        probe_relation=data.get("probe_relation", ""),
        evidence=evidence,
        profile=profile,
    )






def _analyze_landscape(
    paper: dict, sft: StructuredFullText, profile: PaperProfile | None,
) -> BranchPaperResult:
    """全景扫描分析（发现论文的方法体系，不做匹配）"""

    text_for_llm = select_context_for_mode(sft, MODE_LANDSCAPE, paper)

    prompt = LANDSCAPE_PROMPT.format(
        title=paper["title"],
        profile=_profile_context(profile),
        content_source=sft.source,
        content=text_for_llm,
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.2)
        data = json.loads(raw)
    except Exception as e:
        logger.warning(f"全景扫描 LLM 调用失败: {e}")
        data = {}

    evidence = _normalize_evidence(data.get("evidence"))
    components = data.get("method_components") or []
    if not isinstance(components, list):
        components = []
    key_innovation = data.get("key_innovation", "") or ""

    return BranchPaperResult(
        paper_id=paper["paper_id"],
        title=paper["title"],
        authors=paper.get("authors", []),
        year=paper.get("year"),
        venue=paper.get("venue", ""),
        doi=paper.get("doi", ""),
        abstract=paper.get("abstract", ""),
        cited_by_count=paper.get("cited_by_count", 0),
        content_level=sft.level,
        content_source=sft.source,
        method_summary=data.get("method_summary", ""),
        probe_match=False,                                   # 全景模式不做匹配
        probe_confidence="none",
        key_findings=key_innovation,                        # 兼容字段：前端"发现"展示
        optimization_method="",                             # 不再 hack 进 method_category
        research_question=data.get("research_question", "") or "",
        methodology_type=data.get("methodology_type", "") or "",
        method_category=data.get("method_category", "") or "",
        method_components=components,
        research_design=data.get("research_design", "") or "",
        key_innovation=key_innovation,
        limitations=data.get("limitations", "") or "",
        evidence=evidence,
        profile=profile,
    )






def _analyze_ai_suggest(
    paper: dict, sft: StructuredFullText,
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
        content_level=sft.level,
        content_source=sft.source,
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
            existing.usage_role = result.usage_role
            existing.implementation_or_application = result.implementation_or_application
            existing.probe_relation = result.probe_relation
            existing.research_question = result.research_question
            existing.methodology_type = result.methodology_type
            existing.method_category = result.method_category
            existing.method_components = result.method_components
            existing.research_design = result.research_design
            existing.key_innovation = result.key_innovation
            existing.limitations = result.limitations
            existing.evidence = result.evidence
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
                usage_role=result.usage_role,
                implementation_or_application=result.implementation_or_application,
                probe_relation=result.probe_relation,
                research_question=result.research_question,
                methodology_type=result.methodology_type,
                method_category=result.method_category,
                method_components=result.method_components,
                research_design=result.research_design,
                key_innovation=result.key_innovation,
                limitations=result.limitations,
                evidence=result.evidence,
            )
            session.add(ar)

    logger.debug(f"保存分析结果: paper={paper_id}, mode={result.mode}, match={result.probe_match}")


def _simple_keyword_match(paper: dict, probe: str) -> dict:
    """LLM 失败时的兜底：基于摘要做简单关键词匹配，确定性产出 usage_role。

    注意：仅做弱证据判断——命中关键词视为 mentioned（提及），不视为 core；
    未命中视为 none。真正的语义角色由 LLM 路径产出，这里只保证不崩溃。
    """
    abstract = (paper.get("abstract") or "").lower()
    probe_lower = probe.lower()

    # 提取探针中的关键词（按逗号、空格分割）
    keywords = re.split(r"[,;\s]+", probe_lower)
    keywords = [kw for kw in keywords if len(kw) > 2]

    matched = any(kw in abstract for kw in keywords)
    usage_role = "mentioned" if matched else "none"

    return {
        "usage_role": usage_role,
        "confidence": "low" if matched else "none",
        "method_summary": f"（关键词匹配兜底）{'可能' if matched else '未'}使用 {probe}",
        "probe_relation": "",
        "key_findings": "",
        "implementation_or_application": "",
        "evidence": [],
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
