"""
sources/abstract_fallback.py —— 摘要兜底源（Semantic Scholar TLDR）

背景（2026-09-01）：Elsevier 无 OA 论文在 OpenAlex / Crossref / Semantic Scholar
均无原文摘要（abstract_inverted_index MISSING），ScienceDirect 落地页有但被
Cloudflare 管理式 challenge 拦截（自动化浏览器 headed/headless/stealth 全拦）。

兜底方案：Semantic Scholar 的 tldr 字段（AI 生成概要，tldr@v2.0.0）——免费、
无反爬、稳定 API。非原文摘要，使用处必须明确标注"AI 生成概要（Semantic Scholar）"。

查询路径：
- DOI（首选，S2 支持 DOI 直查，实测稳定）
- 无 DOI → 返回 None（OpenAlex ID / title 搜索实测不可靠）

限流：S2 无 key 约 100 req/5min；进程内缓存 TTL 24h + 最小请求间隔兜底。
失败静默（返回 None），绝不阻塞主链路。
"""
import threading
import time

import httpx

from utils.log import setup_logger

logger = setup_logger("abstract_fallback")

S2_API = "https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}?fields=tldr,title"
_CACHE_TTL = 24 * 3600
_MIN_INTERVAL = 0.5  # 秒，最小请求间隔（兜底节流）

_cache: dict[str, dict] = {}          # doi -> {"text": str, "ts": float}
_cache_lock = threading.Lock()
_last_req = 0.0
_req_lock = threading.Lock()


def _throttle() -> None:
    """最小请求间隔（进程内线程安全）"""
    global _last_req
    with _req_lock:
        now = time.time()
        wait = _MIN_INTERVAL - (now - _last_req)
        if wait > 0:
            time.sleep(wait)
        _last_req = time.time()


def fetch_tldr(doi: str | None) -> str | None:
    """按 DOI 查 Semantic Scholar TLDR（AI 生成概要）。失败/无 tldr → None。"""
    if not doi:
        return None
    doi = doi.strip()
    with _cache_lock:
        hit = _cache.get(doi)
        if hit and time.time() - hit["ts"] < _CACHE_TTL:
            return hit["text"]

    _throttle()
    try:
        with httpx.Client(timeout=6, follow_redirects=True) as client:
            resp = client.get(S2_API.format(doi=doi), headers={"User-Agent": "ScholarFunnel/1.0"})
            # S2 无 key 偶发 429/5xx（实测瞬时限流）→ 重试一次
            if resp.status_code in (429, 500, 502, 503):
                time.sleep(1.5)
                resp = client.get(S2_API.format(doi=doi), headers={"User-Agent": "ScholarFunnel/1.0"})
            if resp.status_code != 200:
                logger.debug(f"S2 tldr 非 200 ({resp.status_code}): {doi}")
                return None
            data = resp.json()
            tldr = data.get("tldr") or {}
            text = (tldr.get("text") or "").strip()
            if not text:
                return None
    except Exception as e:
        logger.debug(f"S2 tldr 查询失败 {doi}: {e}")
        return None

    with _cache_lock:
        _cache[doi] = {"text": text, "ts": time.time()}
    return text
