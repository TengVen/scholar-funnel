"""
agents/paper_analysis.py —— 单篇论文深度分析（详情页 AI 研究助手）

L2/L3 共用同一套能力；单篇按需触发（点开详情 / 深入探究）→ 内存缓存暂存不落库；
问答交互时由调用方触发落库（转 Research Asset）。

管线：全文获取（OpenAlex oa_pdf_url 下载 → PyMuPDF 分节；失败降级摘要）→
      LLM 六区块（prompt/paper_analysis.py）→ 研究脉络（规则：基础/横向/纵向）→ 缓存。
"""
import json
import threading
import time
from datetime import datetime

from utils.log import setup_logger
from prompt.paper_analysis import build_analysis_prompt

logger = setup_logger("paper_analysis")

# ── 内存缓存（暂存不落库；重启丢失可重算，预热成本可接受）──
_CACHE_TTL_SECONDS = 24 * 3600
_cache: dict[str, dict] = {}          # key: "{project_id}:{openalex_id}" → {status, result, ts}
_tasks: dict[str, dict] = {}          # key 同上 → {status: running/done/error, result, error}
_lock = threading.Lock()


def _key(project_id: int, openalex_id: str) -> str:
    return f"{project_id}:{openalex_id}"


def get_cached(project_id: int, openalex_id: str) -> dict | None:
    """返回缓存分析结果（含状态），过期视为无"""
    k = _key(project_id, openalex_id)
    with _lock:
        item = _cache.get(k)
        if item and time.time() - item["ts"] < _CACHE_TTL_SECONDS:
            return item
        if item:
            _cache.pop(k, None)
    return None


def get_task(project_id: int, openalex_id: str) -> dict | None:
    k = _key(project_id, openalex_id)
    with _lock:
        return _tasks.get(k)


def start_analysis(project_id: int, openalex_id: str, title: str, abstract: str,
                   year: int | None, cited_by_count: int, user_query: str = "",
                   oa_pdf_url: str | None = None,
                   persist: bool = False, paper_id: int | None = None) -> dict:
    """
    触发单篇深度分析（幂等：同论文已有 running 任务则复用）。
    persist=True 且提供 paper_id 时：分析完成后直接写库（L3 直接落库）；
    否则结果仅进内存缓存（L2 预热，落库标志=问答交互）。
    返回 {status, task_id}。
    """
    k = _key(project_id, openalex_id)
    with _lock:
        existing = _tasks.get(k)
        if existing and existing["status"] == "running":
            return {"status": "running", "task_id": k}
        task = {"status": "running", "result": None, "error": None}
        _tasks[k] = task

    threading.Thread(
        target=_run,
        args=(k, project_id, openalex_id, {
            "title": title, "abstract": abstract, "year": year,
            "cited_by_count": cited_by_count, "user_query": user_query,
            "oa_pdf_url": oa_pdf_url,
            "persist": persist, "paper_id": paper_id,
        }),
        daemon=True,
    ).start()
    return {"status": "running", "task_id": k}


def _run(k: str, project_id: int, openalex_id: str, info: dict) -> None:
    """后台执行分析：全文获取 → 分节 → LLM 六区块 → 研究脉络 → 缓存"""
    task = _tasks[k]
    try:
        sections, material, material_type = _load_material(info, openalex_id)
        analysis = _llm_analysis(info, material, material_type)
        analysis["research_context"] = _build_research_context(openalex_id)
        result = {
            "status": "done",
            "sections": sections,
            "analysis": analysis,
            "material_type": material_type,
        }
        task.update({"status": "done", "result": result})
        with _lock:
            _cache[k] = {"status": "done", "result": result, "ts": time.time()}
        if info.get("persist") and info.get("paper_id"):
            _persist_result(info["paper_id"], sections, analysis)
        logger.info(f"论文分析完成: {openalex_id} (material={material_type})")
    except Exception as e:
        logger.error(f"论文分析失败 {openalex_id}: {e}")
        task.update({"status": "error", "error": str(e)})


def _persist_result(paper_id: int, sections, analysis) -> None:
    """L3 直接落库：分析完成即写 ai_papers.paper_analysis + sections（仅当为 None，不覆盖已有）"""
    from storage.models import Paper
    from storage.mysql_db import get_session
    try:
        with get_session() as session:
            p = session.get(Paper, paper_id)
            if p and p.paper_analysis is None and analysis:
                p.paper_analysis = analysis
            if p and p.sections is None and sections:
                p.sections = sections
    except Exception as e:
        logger.warning(f"分析结果落库失败 paper={paper_id}: {e}")


# ── 1. 全文获取 + 分节 ──

def _load_material(info: dict, openalex_id: str) -> tuple[list | None, str, str]:
    """返回 (sections, material_text, material_type)；全文拿不到降级摘要"""
    pdf_url = info.get("oa_pdf_url")
    if pdf_url:
        try:
            sections = _fetch_and_parse_pdf(openalex_id, pdf_url)
            if sections:
                text = "\n\n".join(f"{s['heading']}\n{s['content']}" for s in sections)
                return sections, text, "全文分节"
        except Exception as e:
            logger.warning(f"全文获取失败 {pdf_url}: {e}")
    abstract = (info.get("abstract") or "").strip()
    if not abstract:
        return None, "", "无材料"
    return None, abstract, "摘要"


def _fetch_and_parse_pdf(openalex_id: str, pdf_url: str) -> list:
    """磁盘缓存优先，缺失则下载落盘（复用 sources/pdf_cache.py，避免与预览重复下载）；再从文件分节解析"""
    import io
    from sources.pdf_cache import get_pdf_path, download_pdf
    from sources.pdf_structure import extract_pdf_sections

    path = get_pdf_path(openalex_id) or download_pdf(openalex_id, pdf_url)
    if not path:
        return []
    with open(path, "rb") as f:
        sections = extract_pdf_sections(io.BytesIO(f.read()))
    return sections


# ── 2. LLM 六区块 ──

def _llm_analysis(info: dict, material: str, material_type: str) -> dict:
    from llm import client as llm

    prompt = build_analysis_prompt(
        title=info.get("title", ""),
        year=info.get("year"),
        cited_by_count=info.get("cited_by_count", 0),
        user_query=info.get("user_query", ""),
        material=material,
        material_type=material_type,
    )
    raw = llm.chat_json(prompt)
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(parsed, dict):
        raise ValueError("LLM 分析输出非对象")
    # 归一化必填键
    for key in ("summary", "quick_understand", "core_contributions",
                "method_framework", "experiments", "relation_to_research"):
        parsed.setdefault(key, None)
    return parsed


# ── 3. 研究脉络（规则：基础/横向/纵向，复用 OpenAlex 关系数据）──

def _build_research_context(openalex_id: str) -> dict:
    """围绕锚点的三类关系：基础=后向引用 / 横向=related_works / 纵向=前向被引"""
    from sources.openalex import get_work_by_id, get_citations

    base, horizontal, vertical = [], [], []

    try:
        work = get_work_by_id(openalex_id)
        if work:
            ids = [w for w in (work.referenced_works or [])[:5]]
            base = _fetch_titles(ids)
            ids = [w for w in (work.related_works or [])[:5]]
            horizontal = _fetch_titles(ids)
    except Exception as e:
        logger.warning(f"脉络-基础/横向获取失败: {e}")

    try:
        cites = get_citations(openalex_id, per_page=5)
        vertical = [{"openalex_id": c.openalex_id, "title": c.title, "year": c.year}
                    for c in cites if c.title]
    except Exception as e:
        logger.warning(f"脉络-纵向获取失败: {e}")

    return {"base": base, "horizontal": horizontal, "vertical": vertical}


def _fetch_titles(openalex_ids: list[str]) -> list[dict]:
    """批量拉取论文标题（ID → {openalex_id, title, year}）"""
    from sources.openalex import get_work_by_id
    import concurrent.futures

    out = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(get_work_by_id, wid) for wid in openalex_ids]
        for f in futures:
            try:
                w = f.result()
                if w and w.title:
                    out.append({"openalex_id": w.openalex_id, "title": w.title, "year": w.year})
            except Exception:
                continue
    return out
