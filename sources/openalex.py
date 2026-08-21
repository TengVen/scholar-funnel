"""
OpenAlex API 封装 —— 主数据引擎（免费无需 Key）
文档：https://docs.openalex.org/
"""
import os
import time
import httpx
from dataclasses import dataclass, field
from typing import Any
from utils.log import setup_logger

logger = setup_logger("openalex")

# 礼貌池：加上邮箱可获得更高速率（10万次/天）
BASE_URL = "https://api.openalex.org"
POLITE_MAILTO = os.getenv("OPENALEX_EMAIL", "")  # 设置邮箱可获得更高速率


@dataclass
class OpenAlexPaper:
    """从 OpenAlex API 解析出的论文结构"""
    openalex_id: str = ""
    title: str = ""
    authors: list[str] = field(default_factory=list)
    year: int = 0
    venue: str = ""
    doi: str | None = None
    arxiv_id: str | None = None
    abstract: str = ""
    cited_by_count: int = 0
    is_oa: bool = False
    oa_pdf_url: str | None = None
    oa_landing_url: str | None = None  # HTML 落地页（全文入口）
    github_url: str | None = None  # 关联 GitHub 仓库
    concepts: list[str] = field(default_factory=list)
    referenced_works: list[str] = field(default_factory=list)
    related_works: list[str] = field(default_factory=list)


def _make_request(endpoint: str, params: dict | None = None) -> dict:
    """
    统一的 HTTP 请求方法，带重试和速率控制
    """
    if params is None:
        params = {}
    params["mailto"] = POLITE_MAILTO

    for attempt in range(3):
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(f"{BASE_URL}{endpoint}", params=params)
                if resp.status_code == 429:
                    # 速率限制，等待后重试
                    wait = 2 ** attempt
                    logger.warning(f"速率限制，等待 {wait}s 后重试...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAlex HTTP {e.response.status_code}")
            if attempt == 2:
                raise
            time.sleep(1)
        except httpx.RequestError as e:
            logger.error(f"OpenAlex 请求失败: {e}")
            if attempt == 2:
                raise
            time.sleep(1)

    return {}


def _parse_work(work: dict) -> OpenAlexPaper:
    """将 OpenAlex 原始 JSON 解析为结构化对象"""

    # 提取作者名
    authors = []
    for authorship in work.get("authorships", []):
        author_info = authorship.get("author", {})
        name = author_info.get("display_name", "")
        if name:
            authors.append(name)

    # 提取发表渠道
    venue = ""
    primary_location = work.get("primary_location") or {}
    source = primary_location.get("source") or {}
    venue = source.get("display_name", "")

    # 提取 DOI（去掉前缀）
    doi_raw = work.get("doi") or ""
    doi = doi_raw.replace("https://doi.org/", "") if doi_raw else None

    # 提取 arXiv ID
    arxiv_id = None
    for loc in work.get("locations", []):
        landing = loc.get("landing_page_url") or ""
        if "arxiv.org" in landing:
            # 从 URL 中提取 arXiv ID
            parts = landing.rstrip("/").split("/")
            if parts:
                arxiv_id = parts[-1]
                break

    # 提取 OA 链接
    oa_pdf_url = None
    oa_landing_url = None
    is_oa = work.get("open_access", {}).get("is_oa", False)
    oa_url = work.get("open_access", {}).get("oa_url")
    if oa_url:
        oa_pdf_url = oa_url
    # 从 best_oa_location 提取 landing_page_url（HTML 全文入口）
    best_loc = work.get("best_oa_location") or {}
    if best_loc.get("landing_page_url"):
        oa_landing_url = best_loc["landing_page_url"]
    # 也尝试从 locations 中找
    if not oa_landing_url:
        for loc in work.get("locations", []):
            if loc.get("landing_page_url"):
                oa_landing_url = loc["landing_page_url"]
                break
    # 也尝试从 locations 中找 PDF
    if not oa_pdf_url:
        for loc in work.get("locations", []):
            pdf_url = loc.get("pdf_url")
            if pdf_url:
                oa_pdf_url = pdf_url
                break

    # 提取摘要（OpenAlex 用 inverted index 存储）
    abstract = _reconstruct_abstract(work.get("abstract_inverted_index"))

    # 提取 GitHub 仓库链接（扫描所有 location 的 URL）
    github_url = None
    for loc in work.get("locations", []):
        for url_key in ("landing_page_url", "pdf_url"):
            u = loc.get(url_key) or ""
            if "github.com" in u:
                github_url = u
                break
        if github_url:
            break
    if not github_url:
        for u in (work.get("open_access", {}).get("oa_url") or "",
                  (work.get("best_oa_location") or {}).get("landing_page_url") or ""):
            if "github.com" in u:
                github_url = u
                break

    # 提取概念标签
    concepts = []
    for concept in work.get("concepts", []):
        if concept.get("score", 0) > 0.3:
            concepts.append(concept.get("display_name", ""))

    return OpenAlexPaper(
        openalex_id=work.get("id", "").replace("https://openalex.org/", ""),
        title=work.get("title", "") or "",
        authors=authors,
        year=work.get("publication_year", 0) or 0,
        venue=venue,
        doi=doi,
        arxiv_id=arxiv_id,
        abstract=abstract,
        cited_by_count=work.get("cited_by_count", 0),
        is_oa=is_oa,
        oa_pdf_url=oa_pdf_url,
        oa_landing_url=oa_landing_url,
        github_url=github_url,
        concepts=concepts,
        referenced_works=[
            ref.replace("https://openalex.org/", "")
            for ref in work.get("referenced_works", [])
        ],
        related_works=[
            rel.replace("https://openalex.org/", "")
            for rel in work.get("related_works", [])
        ],
    )


def _reconstruct_abstract(inverted_index: dict | None) -> str:
    """
    OpenAlex 的摘要以 inverted index 形式存储，需重建原文
    格式：{"word1": [0, 5], "word2": [1, 3], ...}
    """
    if not inverted_index:
        return ""

    word_positions: list[tuple[int, str]] = []
    for word, positions in inverted_index.items():
        for pos in positions:
            word_positions.append((pos, word))

    word_positions.sort(key=lambda x: x[0])
    return " ".join(w for _, w in word_positions)


# ──────────────────────────────────────────
#  公开 API 方法
# ──────────────────────────────────────────

def search_works(
    query: str,
    per_page: int = 50,
    page: int = 1,
    sort_by: str = "relevance_score:desc",  # ← 改默认：按相关度排，不再只看被引
    year_from: int | None = None,
    year_to: int | None = None,
    strict_mode: bool = False,  # ← 新增：严格模式
) -> list[OpenAlexPaper]:
    """
    按关键词搜索论文

    strict_mode=True 时，强制要求 query 中的核心词必须出现在
    标题或摘要中（通过 OpenAlex filter 实现），显著降低噪声
    """
    params: dict[str, Any] = {
        "search": query,
        "per_page": min(per_page, 200),
        "page": page,
        "sort": sort_by,
    }

    # ── 严格模式：用 title.search + abstract.search 强制关键词命中 ──
    if strict_mode:
        # 提取 query 中的实词（长度>3）作为强制过滤条件
        import re
        words = [w for w in re.split(r"[\s\-]+", query.lower()) if len(w) > 3]
        # 取前 3 个最长的词作为强制条件，避免条件太苛刻导致零结果
        keywords = sorted(set(words), key=len, reverse=True)[:3]
        if keywords:
            filters = []
            for kw in keywords:
                # OpenAlex filter 语法：title.search:kw 或 abstract.search:kw
                # 用 OR 逻辑（|）放宽一点：标题或摘要出现即可
                filters.append(f"title.search:{kw}")
                filters.append(f"abstract.search:{kw}")
            # 多个 filter 用逗号表示 AND，这里我们只取前两个做 AND
            # 例如 title.search:diffusion,abstract.search:power
            if len(filters) >= 2:
                params["filter"] = f"{filters[0]},{filters[1]}"

    # 年份过滤
    if year_from or year_to:
        year_filter = "publication_year:"
        if year_from and year_to:
            year_filter += f"{year_from}-{year_to}"
        elif year_from:
            year_filter += f">{year_from - 1}"
        elif year_to:
            year_filter += f"<{year_to + 1}"

        # 严格模式下 filter 已存在，需要拼接
        if "filter" in params:
            params["filter"] += f",{year_filter}"
        else:
            params["filter"] = year_filter

    data = _make_request("/works", params)
    results = data.get("results", [])

    return [_parse_work(w) for w in results]


def get_work_by_id(openalex_id: str) -> OpenAlexPaper | None:
    """
    通过 OpenAlex ID 获取单篇论文详情
    """
    if not openalex_id.startswith("W"):
        openalex_id = f"W{openalex_id}"

    try:
        data = _make_request(f"/works/{openalex_id}")
        return _parse_work(data)
    except Exception:
        return None


def get_citations(
    openalex_id: str,
    per_page: int = 50,
    page: int = 1,
    sort_by: str = "cited_by_count:desc",
) -> list[OpenAlexPaper]:
    """
    获取引用了某篇论文的论文（前向追踪）
    """
    full_id = f"https://openalex.org/{openalex_id}"
    params: dict[str, Any] = {
        "filter": f"cites:{full_id}",
        "per_page": min(per_page, 200),
        "page": page,
        "sort": sort_by,
    }

    data = _make_request("/works", params)
    results = data.get("results", [])
    return [_parse_work(w) for w in results]


def get_references(openalex_id: str) -> list[str]:
    """
    获取某篇论文引用的论文 ID 列表（后向追溯）
    直接从论文详情中提取 referenced_works
    """
    paper = get_work_by_id(openalex_id)
    if paper:
        return paper.referenced_works
    return []


def search_citing_works(
    openalex_id: str,
    per_page: int = 20,
    year_from: int | None = None,
) -> list[OpenAlexPaper]:
    """
    查找引用了指定论文的近期工作（前向追踪）。
    使用 OpenAlex 的 cites: 过滤器。
    """
    params = {
        "filter": f"cites:{openalex_id}",
        "per-page": min(per_page, 50),
        "sort": "cited_by_count:desc",
    }

    if year_from:
        params["filter"] += f",publication_year:>{year_from - 1}"

    data = _make_request("/works", params)
    results = data.get("results", [])
    return [_parse_work(w) for w in results]


def search_by_title(title: str) -> OpenAlexPaper | None:
    """
    通过标题精确查找（取第一个结果）
    """
    results = search_works(title, per_page=1)
    if results and results[0].title.lower().strip() in title.lower().strip():
        return results[0]
    return results[0] if results else None


def get_oa_url(openalex_id: str) -> str | None:
    """
    获取论文的 Open Access 全文 URL（优先 HTML 落地页，其次 PDF）。
    用于分支深挖的全文获取降级链。

    返回: 可访问的 URL 字符串，或 None（无 OA）
    """
    paper = get_work_by_id(openalex_id)
    if not paper:
        return None

    # 优先返回 HTML 落地页（全文入口，非 PDF）
    if paper.oa_landing_url:
        return paper.oa_landing_url

    # 其次返回 PDF 链接（fetch_full_text_html 会判断并跳过）
    if paper.oa_pdf_url:
        return paper.oa_pdf_url

    return None


def fetch_full_text_html(openalex_id: str) -> str | None:
    """
    尝试通过 OA URL 获取论文全文 HTML。
    返回纯文本（去除 HTML 标签），或 None。

    这是分支深挖五级降级链的 Level 2。
    """
    import re

    url = get_oa_url(openalex_id)
    if not url:
        logger.debug(f"论文 {openalex_id} 无 OA 链接")
        return None

    # 如果是 PDF 链接，跳过（HTML 模式不处理 PDF）
    if url.lower().endswith(".pdf") or "/pdf/" in url.lower():
        logger.debug(f"论文 {openalex_id} OA 链接为 PDF，跳过 HTML 获取")
        return None

    try:
        with httpx.Client(
            timeout=20.0,
            follow_redirects=True,
            headers={"User-Agent": "ScholarFunnel/1.0 (research-tool)"},
        ) as client:
            resp = client.get(url)
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                logger.debug(f"论文 {openalex_id} OA 内容非 HTML: {content_type}")
                return None

            html = resp.text

            # 粗提取：去 script/style，取 body 文本
            html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
            html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
            html = re.sub(r"<nav[^>]*>.*?</nav>", "", html, flags=re.DOTALL | re.IGNORECASE)
            html = re.sub(r"<footer[^>]*>.*?</footer>", "", html, flags=re.DOTALL | re.IGNORECASE)
            html = re.sub(r"<header[^>]*>.*?</header>", "", html, flags=re.DOTALL | re.IGNORECASE)
            html = re.sub(r"<[^>]+>", " ", html)
            html = re.sub(r"\s+", " ", html).strip()

            if len(html) < 200:
                logger.debug(f"论文 {openalex_id} HTML 文本太短（{len(html)} 字符）")
                return None

            logger.info(f"论文 {openalex_id} HTML 全文获取成功（{len(html)} 字符）")
            return html

    except Exception as e:
        logger.warning(f"论文 {openalex_id} HTML 全文获取失败: {e}")
        return None