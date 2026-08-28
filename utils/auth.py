"""
认证核心：JWT 签发/校验 + bcrypt 密码哈希 + FastAPI 依赖注入

- Access Token：无状态 JWT（2h）
- Refresh Token：随机串，SHA-256 哈希存 ai_user_sessions（可吊销）
- 游客：自动创建 guest 用户（role='guest'），注册时升级为正式用户
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from utils.config import settings
from storage.mysql_db import get_session
from storage.models import User  # 由 auth models 提供

# ── 常量 ──
ACCESS_TOKEN_TTL = timedelta(hours=6)          # Access 有效期
REFRESH_TOKEN_TTL = timedelta(days=7)          # Refresh 有效期
JWT_ALGORITHM = "HS256"
# 密钥由 config 强制要求（缺失即启动失败），此处直接取用，不再回退默认值
JWT_SECRET = settings.jwt_secret

_bearer = HTTPBearer(auto_error=False)


# ══════════════════════════════════════════════════════════
#  JWT 工具
# ══════════════════════════════════════════════════════════

def create_access_token(user_id: int, role: str = "user") -> str:
    """签发 Access Token（无状态 JWT）"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + ACCESS_TOKEN_TTL,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """解析 Access Token，失败抛 401"""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录已过期，请重新登录")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效的登录凭证")


def generate_refresh_token() -> tuple[str, str]:
    """生成 Refresh Token（原始串 + SHA-256 哈希）"""
    raw = secrets.token_urlsafe(48)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    """Token 哈希（存库用，不存原始串）"""
    return hashlib.sha256(raw.encode()).hexdigest()


# ══════════════════════════════════════════════════════════
#  密码工具
# ══════════════════════════════════════════════════════════

def hash_password(password: str) -> str:
    """bcrypt 密码哈希"""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """校验密码"""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


# ══════════════════════════════════════════════════════════
#  依赖注入：当前用户
# ══════════════════════════════════════════════════════════

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> "User":
    """
    FastAPI 依赖：从 Authorization: Bearer <access_token> 解析当前用户。
    游客也有 user 记录（role='guest'），所以所有登录态（含游客）都走这里。
    """
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    payload = decode_access_token(credentials.credentials)
    user_id = int(payload["sub"])
    with get_session() as session:
        user = session.get(User, user_id)
        if user is None or user.status != 1:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在或已禁用")
        # 预加载所有列属性（session 关闭后返回的 User 可安全访问，避免 detached 懒加载）
        from sqlalchemy import inspect
        for attr in inspect(user).mapper.column_attrs:
            getattr(user, attr.key)
        return user


def require_admin(user: "User" = Depends(get_current_user)) -> "User":
    """FastAPI 依赖：要求 admin 角色"""
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "需要管理员权限")
    return user


def is_first_user() -> bool:
    """是否首个用户（用于自动设为 admin）"""
    with get_session() as session:
        from storage.models import User
        return session.query(User).count() == 0


def get_owned_project(session, project_id: int, user: "User"):
    """
    校验项目归属：取当前用户的项目；不存在或非本人 → 404（不泄露存在性）。
    业务路由统一用它做用户隔离。
    """
    from storage.models import Project
    r = session.get(Project, project_id)
    if not r or r.user_id != user.id:
        from fastapi import HTTPException
        raise HTTPException(404, "项目不存在")
    return r
