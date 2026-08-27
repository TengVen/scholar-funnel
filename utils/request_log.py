"""
请求追踪中间件 —— 为每个请求生成 X-Request-Id 并记录耗时日志

用于外部 API 故障时按请求定位调用链（与 llm/openalex 的日志配合排查）。
内存实现、零依赖；多进程部署时 request_id 由各自进程独立生成（可接受）。
"""
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from utils.log import setup_logger, set_request_id, clear_request_id

logger = setup_logger("http")


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        req_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        request.state.request_id = req_id
        set_request_id(req_id)  # 供 DbLogHandler 落库时关联 request_id

        start = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            logger.error(
                f"[{req_id}] {request.method} {request.url.path} 未捕获异常 "
                f"({(time.monotonic() - start) * 1000:.0f}ms)"
            )
            clear_request_id()
            raise
        duration_ms = (time.monotonic() - start) * 1000
        logger.info(
            f"[{req_id}] {request.method} {request.url.path} -> {response.status_code} "
            f"({duration_ms:.0f}ms)"
        )
        clear_request_id()
        response.headers["X-Request-Id"] = req_id
        return response
