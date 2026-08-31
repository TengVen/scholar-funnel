"""
sources/pdf_cache.py —— 论文 PDF 下载 + 磁盘缓存（详情页"原文 PDF"预览 / 分析链路全文获取共用）

缓存命名：data/pdfs/{openalex_id}.pdf（按 ID 稳定定位，支持并发幂等）。
- 通用下载：不校验域名（PMC 等非 arXiv PDF 对分析链路仍有价值）；
  arXiv 限制只在预览路由层（api/routers/papers.py /pdf）执行。
- 校验：下载体须以 %PDF 开头且 >= 1KB，否则视为非 PDF 丢弃。
"""
import os

import httpx

from utils.log import setup_logger

logger = setup_logger("pdf_cache")

_PDF_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "pdfs")
_UA = "ScholarFunnel/1.0 (research-tool)"
_MAX_BYTES = 25 * 1024 * 1024  # 与分析链路一致
_MIN_BYTES = 1024


def _path(openalex_id: str) -> str:
    return os.path.join(_PDF_DIR, f"{openalex_id}.pdf")


def is_arxiv_url(url: str | None) -> bool:
    """arXiv 域名判断（含 export.arxiv.org）：非 arXiv 一律不提供站内 PDF 预览"""
    if not url:
        return False
    try:
        host = url.split("://", 1)[-1].split("/", 1)[0].lower()
    except Exception:
        return False
    return host == "arxiv.org" or host.endswith(".arxiv.org")


def get_pdf_path(openalex_id: str) -> str | None:
    """磁盘缓存命中返回路径，否则 None"""
    p = _path(openalex_id)
    return p if os.path.exists(p) else None


def download_pdf(openalex_id: str, pdf_url: str) -> str | None:
    """
    下载 PDF 落盘缓存（%PDF 魔数校验，临时文件 + os.replace 原子写入）；
    已有缓存直接返回路径。失败返回 None。
    """
    cached = get_pdf_path(openalex_id)
    if cached:
        return cached
    try:
        with httpx.Client(
            timeout=45,
            follow_redirects=True,
            headers={"User-Agent": _UA},
        ) as client:
            resp = client.get(pdf_url)
            resp.raise_for_status()
            if resp.content[:5] != b"%PDF-":
                logger.warning(f"非 PDF 响应（疑似 HTML 落地页）: {pdf_url[:80]}")
                return None
            if len(resp.content) > _MAX_BYTES:
                logger.warning(f"PDF 超过大小限制: {openalex_id}")
                return None
            os.makedirs(_PDF_DIR, exist_ok=True)
            tmp = _path(openalex_id) + ".tmp"
            with open(tmp, "wb") as f:
                f.write(resp.content)
            os.replace(tmp, _path(openalex_id))
        if os.path.getsize(_path(openalex_id)) < _MIN_BYTES:
            os.remove(_path(openalex_id))
            return None
        logger.info(f"PDF 缓存: {_path(openalex_id)}")
        return _path(openalex_id)
    except Exception as e:
        logger.warning(f"PDF 下载失败 {openalex_id}: {e}")
        return None
