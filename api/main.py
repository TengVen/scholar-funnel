"""
FastAPI 入口 —— Scholar Funnel API Server
uvicorn api.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from storage.mysql_db import init_db
from utils.ratelimit import RateLimitMiddleware
from utils.request_log import RequestLogMiddleware
from api.routers import (
    auth, projects, papers, search, cart, branch, network, chat, funnel, settings,
    admin, announcements,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: 应用启动时执行
    init_db()
    yield
    # Shutdown: 应用关闭时执行（如有需要可在此添加清理逻辑）


app = FastAPI(
    title="Scholar Funnel API",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,  # ← 新增
)

# 请求追踪（X-Request-Id + 耗时日志）
app.add_middleware(RequestLogMiddleware)

# 限流（分级：登录 10/min、重接口 6-12/min、轮询只读接口默认 120/min，按 IP 滑动窗口）
app.add_middleware(RateLimitMiddleware)

# CORS —— 放在最外层：让 429/异常响应也能带上 CORS 头（浏览器可读错误详情）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(papers.router, prefix="/api/papers", tags=["papers"])
app.include_router(cart.router, prefix="/api/cart", tags=["cart"])
app.include_router(branch.router, prefix="/api/branch", tags=["branch"])
app.include_router(network.router, prefix="/api/network", tags=["network"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(funnel.router, prefix="/api/funnel", tags=["funnel"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(announcements.router, prefix="/api/announcements", tags=["announcements"])

# uvicorn api.main:app --reload
@app.get("/api/health")
def health():
    return {"status": "ok"}