"""
轻量级内存滑动窗口限流 —— 零依赖，单进程部署适用

分级限流（按客户端 IP + 请求方法）：
- 敏感接口（登录/注册）：10 次/分钟，防爆破
- 重接口（检索/分析/LLM 调用等 POST 操作）：6-12 次/分钟，防打爆外部 API 与本地模型
- 轮询/只读接口（GET */status、*/state、*/result 等）：不特殊限流，走默认 120 次/分钟
  （前端分支/网络/漏斗/对话检索均以 2-3s 间隔轮询，若与重接口同配额必然误伤 429）

注意：内存实现仅适用于单进程（uvicorn api.main:app --workers 1）。
多进程/多机部署时需替换为 Redis 等共享存储（当前规模不需要）。
"""
import time
import threading
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
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


# (方法, 路径前缀) → 每分钟上限。仅命中"操作型"接口；
# 高频轮询接口（GET status/state/result/history 等）不在表中，走默认配额。
_LIMIT_RULES: list[tuple[str, str, int]] = [
    # 敏感：认证
    ("POST", "/api/auth/login", 10),
    ("POST", "/api/auth/register", 10),
    # 重：检索（trunk/gap/gap-semantic/title 均为 POST 耗时操作）
    ("POST", "/api/search/", 6),
    # 重：分析 / 漏斗启动恢复
    ("POST", "/api/branch/analyze", 6),
    ("POST", "/api/network/analyze", 6),
    ("POST", "/api/funnel/start", 6),
    ("POST", "/api/funnel/resume", 6),
    # 重：骨架 AI 能力
    ("POST", "/api/cart/classify", 6),
    ("POST", "/api/cart/summarize", 6),
    ("POST", "/api/cart/diagnose", 6),
    # 重：LLM 对话与异步任务收尾
    ("POST", "/api/chat/message", 12),
    ("POST", "/api/chat/search/", 6),
    ("POST", "/api/chat/deep-research/", 6),
]
_DEFAULT_LIMIT = 120

_limiter = SlidingWindowLimiter()


def _client_ip(request: Request) -> str:
    """取客户端 IP（优先 X-Forwarded-For，兼容反代；无则用直连地址）"""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _match_limit(request: Request) -> int:
    """按 方法+路径前缀 匹配限流配额；未命中返回默认值（轮询/只读接口不受限）"""
    path = request.url.path
    method = request.method.upper()
    for m, prefix, limit in _LIMIT_RULES:
        if method == m and path.startswith(prefix):
            return limit
    return _DEFAULT_LIMIT


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # CORS 预检请求不计入限流
        if request.method == "OPTIONS":
            return await call_next(request)

        limit = _match_limit(request)

        if not _limiter.allow(f"{_client_ip(request)}:{request.method}:{request.url.path}", limit):
            # 用 JSONResponse 而非 raise HTTPException：
            # 避免 BaseHTTPMiddleware 把它包成 ExceptionGroup，且响应可被外层 CORS 中间件补头
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后再试"},
                headers={"Retry-After": "60"},
            )
        return await call_next(request)
