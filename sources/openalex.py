"""
OpenAlex API 封装 —— 主数据引擎（免费无需 Key）
文档：https://docs.openalex.org/
"""
import os
import re
import time
import httpx
from dataclasses import dataclass, field
from typing import Any
from utils.log import setup_logger

logger = setup_logger("openalex")

# 礼貌池：加上邮箱可获得更高速率（10万次/天）
BASE_URL = "https://api.openalex.org"
# 默认邮箱（env 可覆盖）：游客 / 未填邮箱的用户统一用它
POLITE_MAILTO = os.getenv("OPENALEX_EMAIL", "1257312717@qq.com")

# 请求级 mailto（按当前用户动态设置；空 = 用默认 POLITE_MAILTO）
_current_mailto: str = ""


def set_mailto(email: str | None) -> None:
    """设置当前请求的 OpenAlex 礼貌邮箱（按用户；空则回退默认）"""
    global _current_mailto
    _current_mailto = (email or "").strip()


def get_mailto() -> str:
    """当前生效的 mailto：用户邮箱优先，否则默认邮箱"""
    return _current_mailto or POLITE_MAILTO


# ── .env 轻量加载（不依赖 python-dotenv，避免新增依赖）──
def _load_dotenv() -> None:
    """读取项目根目录的 .env，填充 os.environ（不覆盖已存在的变量）。"""
    try:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        env_path = os.path.join(root, ".env")
        if not os.path.exists(env_path):
            return
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception:
        pass


_load_dotenv()

# OpenAlex 内容下载密钥（GROBID XML 必需）。无 key 时自动跳过 GROBID 档，
# 退回 PDF / HTML 兜底链。
OPENALEX_API_KEY = (os.getenv("OPENALEX_API_KEY") or "").strip()


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
    # GROBID XML 可用性（OpenAlex 内容分发；下载需 OPENALEX_API_KEY）
    has_grobid_xml: bool = False
    grobid_xml_url: str | None = None
    github_url: str | None = None  # 关联 GitHub 仓库
    concepts: list[str] = field(default_factory=list)
    referenced_works: list[str] = field(default_factory=list)
    related_works: list[str] = field(default_factory=list)


def _make_request(endpoint: str, params: dict | None = None) -> dict:
    """
    统一的 HTTP 请求方法，带重试和速率控制

    - 429：尊重 Retry-After（无则指数退避），最多 3 次
    - 5xx / 网络错误：指数退避重试
    - 其他 HTTP 错误：直接抛出（调用方降级）

    Premium：配置了 OPENALEX_API_KEY 时所有请求携带 api_key，
    走 Premium 配额（10k 请求/天）；否则落匿名公共池（1k/天、按 IP，易 429）。
    """
    if params is None:
        params = {}
    params["mailto"] = get_mailto()
    if OPENALEX_API_KEY:
        params["api_key"] = OPENALEX_API_KEY

    for attempt in range(3):
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(f"{BASE_URL}{endpoint}", params=params)
                if resp.status_code == 429:
                    wait = _retry_after_seconds(resp) or 2 ** attempt
                    logger.warning(f"速率限制，等待 {wait}s 后重试 (第{attempt + 1}次)...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            if code >= 500 and attempt < 2:
                wait = 2 ** attempt
                logger.warning(f"OpenAlex 服务端错误 {code}，{wait}s 后重试 (第{attempt + 1}次)")
                time.sleep(wait)
                continue
            logger.error(f"OpenAlex HTTP {code}")
            raise
        except httpx.RequestError as e:
            if attempt < 2:
                wait = 2 ** attempt
                logger.warning(f"OpenAlex 请求失败: {e}，{wait}s 后重试 (第{attempt + 1}次)")
                time.sleep(wait)
                continue
            logger.error(f"OpenAlex 请求失败（已重试 3 次）: {e}")
            raise

    return {}


def _retry_after_seconds(resp: httpx.Response) -> float | None:
    """解析 Retry-After 头（支持秒数或 HTTP 日期）。

    上限保护：OpenAlex 在超出池限额时可能返回离谱的 Retry-After
    （实测 63003s），若直接 time.sleep 会把 worker 冻结十几小时。
    这里封顶到 30s，避免单请求卡死整条分析链路。
    """
    raw = resp.headers.get("retry-after")
    if not raw:
        return None
    try:
        return min(30.0, max(0.0, float(raw)))
    except ValueError:
        return None


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

    # 提取 GROBID XML 可用性（OpenAlex 内容分发计划）
    has_content = work.get("has_content") or {}
    has_grobid_xml = bool(has_content.get("grobid_xml"))
    content_urls = work.get("content_urls") or {}
    gx = content_urls.get("grobid_xml")
    grobid_xml_url = None
    if isinstance(gx, dict):
        grobid_xml_url = gx.get("url")
    elif isinstance(gx, str):
        grobid_xml_url = gx

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
        has_grobid_xml=has_grobid_xml,
        grobid_xml_url=grobid_xml_url,
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
    raw = " ".join(w for _, w in word_positions)
    return _clean_latex(raw)


def _clean_latex(text: str) -> str:
    r"""
    清洗摘要中的 LaTeX 标记，转成可读纯文本。
    覆盖常见模式：\textbf{}、\textit{}、\text{}、\mathbf{}、$...$、\left \right 等。
    """

    # 1. 移除 \command{...} 类（\textbf{GRIP} → GRIP），保留花括号内内容
    text = re.sub(r"\\[a-zA-Z]+\{([^{}]*)\}", r"\1", text)
    # 2. 移除无参数命令（\quad、\times 等孤立命令）
    text = re.sub(r"\\[a-zA-Z]+", " ", text)
    # 3. 移除行内数学 $...$（保留内部内容，去掉 $$ 分隔符）
    text = re.sub(r"\$\$(.+?)\$\$", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\$(.+?)\$", r"\1", text, flags=re.DOTALL)
    # 4. 移除数学环境 \left( \right) 前缀
    text = re.sub(r"\\left|\\right", "", text)
    # 5. 清理残留的花括号（如孤立的 { } 或 {GRIP} 残余）
    text = text.replace("{", "").replace("}", "")
    # 6. 压缩多余空格
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ──────────────────────────────────────────
#  公开 API 方法
# ──────────────────────────────────────────

def filter_term(kw: str) -> str:
    """OpenAlex filter 值规范化：多词短语加引号，避免被当作 AND 拆开"""
    kw = kw.strip()
    return f'"{kw}"' if " " in kw else kw


def search_works(
    query: str,
    per_page: int = 50,
    page: int = 1,
    sort_by: str = "relevance_score:desc",  # ← 改默认：按相关度排，不再只看被引
    year_from: int | None = None,
    year_to: int | None = None,
    strict_mode: bool = False,
    filter_expr: str | None = None,  # ← 分层查询：调用方构造的 OpenAlex filter 表达式
) -> list[OpenAlexPaper]:
    """
    按关键词搜索论文

    分层查询策略（推荐，由 lexical.LexicalRetriever 构造 filter_expr 传入）：
    - 核心概念：多个核心词 AND，每词"标题或摘要"命中
      （title.search:A|abstract.search:A,title.search:B|abstract.search:B）
    - 同义词：组内 OR（title.search:s1|abstract.search:s1|title.search:s2|...）
    - 辅助概念：弱约束（单个 OR filter，任一命中即可，降低漏召回）
    多路分别召回后由调用方合并去重，最终交给 Embedding + Reranker 语义过滤。
    避免旧 strict_mode 的"全部核心词强 AND 到标题"导致候选集合过度收缩。
    """
    params: dict[str, Any] = {
        "search": query,
        "per_page": min(per_page, 200),
        "page": page,
        "sort": sort_by,
    }

    # ── filter：优先使用调用方构造的分层 filter_expr ──
    if filter_expr:
        params["filter"] = filter_expr
    elif strict_mode:
        # 兼容入口（已不被 lexical 使用）：核心词 AND、每词标题或摘要命中。
        # 修复旧实现"逗号全 AND 到标题/摘要 + 只取首个关键词"导致的召回坍缩。
        import re
        words = [w for w in re.split(r"[\s\-]+", query.lower()) if len(w) > 3]
        keywords = sorted(set(words), key=len, reverse=True)[:3]
        if keywords:
            params["filter"] = ",".join(
                f"title.search:{filter_term(kw)}|abstract.search:{filter_term(kw)}"
                for kw in keywords
            )

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


def fetch_grobid_xml(openalex_id: str, paper: "OpenAlexPaper | None" = None) -> str | None:
    """
    OpenAlex 主源：下载论文的 GROBID TEI XML（结构化分节、零页眉噪声）。
    返回 XML 文本，或 None（无 key / 该论文无 GROBID / 下载失败）。

    注：content.openalex.org 返回的是 gzip 压缩体（content-type=application/gzip），
    需手动解压。
    """
    if not OPENALEX_API_KEY:
        logger.debug("未配置 OPENALEX_API_KEY，跳过 GROBID XML")
        return None
    if not openalex_id:
        return None

    if paper is None:
        paper = get_work_by_id(openalex_id)
    if not paper or not paper.has_grobid_xml or not paper.grobid_xml_url:
        return None

    url = paper.grobid_xml_url
    try:
        import gzip
        with httpx.Client(timeout=40.0, follow_redirects=True) as client:
            resp = client.get(url, params={"api_key": OPENALEX_API_KEY})
            if resp.status_code != 200:
                logger.warning(f"GROBID XML 下载失败 {resp.status_code}: {openalex_id}")
                return None
            data = resp.content
            ct = resp.headers.get("content-type", "")
            if ct.endswith("gzip") or data[:2] == b"\x1f\x8b":
                data = gzip.decompress(data)
            return data.decode("utf-8", "replace")
    except Exception as e:
        logger.warning(f"GROBID XML 获取异常: {e}")
        return None


def download_pdf(
    openalex_id: str,
    title: str,
    paper: "OpenAlexPaper | None" = None,
    save_dir: str | None = None,
) -> str | None:
    """
    兜底源：下载论文 OA PDF 到本地（按论文标题重命名），返回落盘路径或 None。

    - 候选 URL：优先 oa_pdf_url，其次 oa_landing_url（用 %PDF 魔数校验真身）。
    - 文件命名：<论文标题>.pdf；若同名已存在则追加 openalex_id 防冲突。
    - 校验：下载体须以 %PDF 开头且 >= 1KB，否则视为非 PDF 返回 None。
    """
    if not openalex_id:
        return None
    if paper is None:
        paper = get_work_by_id(openalex_id)
    if not paper:
        return None

    candidates = [u for u in (paper.oa_pdf_url, paper.oa_landing_url) if u]
    if not candidates:
        return None

    if not save_dir:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        save_dir = os.path.join(root, "data", "pdfs")
    os.makedirs(save_dir, exist_ok=True)

    base = _sanitize_filename(title)
    path = os.path.join(save_dir, f"{base}.pdf")
    if os.path.exists(path):
        path = os.path.join(save_dir, f"{base}_{openalex_id}.pdf")

    for url in candidates:
        try:
            with httpx.Client(
                timeout=30.0,
                follow_redirects=True,
                headers={"User-Agent": "ScholarFunnel/1.0 (research-tool)"},
            ) as client:
                resp = client.get(url)
                resp.raise_for_status()
                if resp.content[:5] != b"%PDF-":
                    continue  # 非 PDF（可能是 HTML 落地页），试下一个候选
                with open(path, "wb") as f:
                    f.write(resp.content)
            if os.path.getsize(path) < 1000:
                os.remove(path)
                return None
            logger.info(f"PDF 下载成功: {path}")
            return path
        except Exception as e:
            logger.warning(f"PDF 下载失败 {url[:60]}: {e}")
            continue
    return None


def _sanitize_filename(name: str, max_len: int = 120) -> str:
    """把论文标题转成安全的文件名（去非法字符、限长）。"""
    import re
    name = (name or "").strip()
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", name)
    name = name.strip(". ").rstrip(" .")
    if len(name) > max_len:
        name = name[:max_len].rstrip(" .")
    return name or "untitled"