"""
轻量级内存滑动窗口限流 —— 零依赖，单进程部署适用

分组限流（按客户端 IP）：
- 敏感接口（登录/注册）：10 次/分钟，防爆破
- 重接口（检索/分析/LLM 调用）：6-12 次/分钟，防打爆外部 API 与本地模型
- 默认：120 次/分钟

注意：内存实现仅适用于单进程（uvicorn api.main:app --workers 1）。
多进程/多机部署时需替换为 Redis 等共享存储（当前规模不需要）。
"""
import time
import threading
from collections import defaultdict, deque

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

_WINDOW = 60.0  # 窗口秒数


class SlidingWindowLimiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float = _WINDOW) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


# 路由分组 → 每分钟上限（按前缀匹配，前到后优先）
_LIMIT_GROUPS: list[tuple[str, int]] = [
    ("/api/auth/login", 10),
    ("/api/auth/register", 10),
    ("/api/search/", 6),
    ("/api/branch/", 6),
    ("/api/network/", 6),
    ("/api/funnel/", 6),
    ("/api/cart/classify", 6),
    ("/api/cart/summarize", 6),
    ("/api/cart/diagnose", 6),
    ("/api/chat/", 12),
]
_DEFAULT_LIMIT = 120

_limiter = SlidingWindowLimiter()


def _client_ip(request: Request) -> str:
    """取客户端 IP（优先 X-Forwarded-For，兼容反代；无则用直连地址）"""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # CORS 预检请求不计入限流
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        limit = _DEFAULT_LIMIT
        for prefix, lim in _LIMIT_GROUPS:
            if path.startswith(prefix):
                limit = lim
                break

        if not _limiter.allow(f"{_client_ip(request)}:{path.split('?')[0]}", limit):
            raise HTTPException(
                429,
                detail="请求过于频繁，请稍后再试",
                headers={"Retry-After": "60"},
            )
        return await call_next(request)
