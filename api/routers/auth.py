"""
认证 API —— 注册 / 登录 / 刷新 / 登出 / 游客 / 当前用户

游客模型：首次访问自动创建 guest 用户（role='guest'）；
注册时若当前是游客 → 升级该记录（补 username/password，role→user），
游客期间数据零迁移归入新账号。

首个注册用户自动成为 admin，并认领 user_id IS NULL 的系统级项目。
"""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from storage.mysql_db import get_session
from storage.models import (
    User, UserCredential, UserSecurity, UserSession,
)
from utils.auth import (
    create_access_token, generate_refresh_token, hash_token,
    hash_password, verify_password, get_current_user,
    ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL,
)
from utils.log import setup_logger

logger = setup_logger("auth")
router = APIRouter()


# ── Schemas ──
class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    email: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


def _auth_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "nickname": user.nickname,
        "role": user.role,
        "email": user.email,
        "is_guest": user.role == "guest",
    }


def _issue_tokens(session, user: User, ip: str = "") -> dict:
    """签发 access + refresh，refresh 哈希存 ai_user_sessions"""
    access = create_access_token(user.id, user.role)
    raw_refresh, refresh_hash = generate_refresh_token()
    db_session = UserSession(
        user_id=user.id,
        session_id=secrets.token_hex(16),
        refresh_token_hash=refresh_hash,
        ip_address=ip,
        expires_at=datetime.utcnow() + REFRESH_TOKEN_TTL,
    )
    session.add(db_session)
    session.commit()
    return {"access_token": access, "refresh_token": raw_refresh, "token_type": "bearer", "user": _auth_payload(user)}


# ── 注册 ──
@router.post("/register", response_model=AuthResponse)
def register(body: RegisterRequest, request=None):
    """注册新用户；若已是游客则升级该游客账号（认领游客数据）"""
    with get_session() as session:
        # 用户名/邮箱查重
        if session.query(User).filter(User.username == body.username).first():
            raise HTTPException(400, "用户名已存在")
        if body.email and session.query(User).filter(User.email == body.email).first():
            raise HTTPException(400, "邮箱已被注册")

        # 游客升级：若当前请求带游客 token，直接升级该游客
        # （简化版：注册时始终新建正式账号；游客升级走 /me/upgrade 接口）
        is_first = session.query(User).count() == 0

        user = User(
            uuid="usr_" + secrets.token_hex(12),
            username=body.username,
            email=body.email,
            role="admin" if is_first else "user",
        )
        session.add(user)
        session.flush()  # 拿到 user.id

        cred = UserCredential(
            user_id=user.id,
            password_hash=hash_password(body.password),
            password_set_at=datetime.utcnow(),
        )
        session.add(cred)
        session.add(UserSecurity(user_id=user.id))
        session.commit()

        # 首个用户（admin）认领系统级项目（user_id IS NULL）
        if is_first:
            from storage.models import Project
            session.query(Project).filter(Project.user_id.is_(None)).update(
                {Project.user_id: user.id}, synchronize_session=False
            )
            session.commit()
            logger.info(f"首个用户 {user.username} 成为 admin，认领系统级项目")

        return _issue_tokens(session, user)


# ── 游客 ──
@router.post("/guest", response_model=AuthResponse)
def guest_login(request=None):
    """自动创建/返回游客账号（无密码，role='guest'）"""
    with get_session() as session:
        username = "guest_" + secrets.token_hex(6)
        user = User(
            uuid="usr_" + secrets.token_hex(12),
            username=username,
            role="guest",
        )
        session.add(user)
        session.flush()
        session.add(UserSecurity(user_id=user.id))
        session.commit()
        logger.info(f"游客创建: {username}")
        return _issue_tokens(session, user)


# ── 登录 ──
@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest, request=None):
    """用户名/密码登录"""
    with get_session() as session:
        user = session.query(User).filter(User.username == body.username).first()
        if not user:
            # 防用户枚举：统一报错
            raise HTTPException(401, "用户名或密码错误")
        if user.status == 0:
            raise HTTPException(403, "账号已被禁用")
        if user.role == "guest":
            raise HTTPException(400, "游客账号无法登录，请注册正式账号")

        cred = session.query(UserCredential).filter_by(user_id=user.id).first()
        if not cred or not verify_password(body.password, cred.password_hash):
            raise HTTPException(401, "用户名或密码错误")

        # 更新安全信息
        sec = session.query(UserSecurity).filter_by(user_id=user.id).first()
        if sec:
            sec.login_fail_count = 0
            sec.last_login_at = datetime.utcnow()
        session.commit()
        return _issue_tokens(session, user)


# ── 刷新 ──
@router.post("/refresh", response_model=AuthResponse)
def refresh(body: RefreshRequest):
    """用 Refresh Token 换新 Access Token"""
    r_hash = hash_token(body.refresh_token)
    with get_session() as session:
        sess = session.query(UserSession).filter_by(refresh_token_hash=r_hash).first()
        if not sess:
            raise HTTPException(401, "无效的 Refresh Token")
        if sess.revoked_at is not None:
            raise HTTPException(401, "Refresh Token 已吊销")
        if sess.expires_at < datetime.utcnow():
            raise HTTPException(401, "Refresh Token 已过期")
        user = session.get(User, sess.user_id)
        if not user or user.status != 1:
            raise HTTPException(401, "用户不可用")
        # 吊销旧 refresh，签发新的一对
        sess.revoked_at = datetime.utcnow()
        return _issue_tokens(session, user)


# ── 登出 ──
@router.post("/logout")
def logout(body: RefreshRequest, user: User = Depends(get_current_user)):
    """吊销 Refresh Token"""
    r_hash = hash_token(body.refresh_token)
    with get_session() as session:
        sess = session.query(UserSession).filter_by(
            refresh_token_hash=r_hash, user_id=user.id
        ).first()
        if sess:
            sess.revoked_at = datetime.utcnow()
            session.commit()
    return {"ok": True}


# ── 当前用户 ──
@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return _auth_payload(user)


# ── 游客升级为正式账号（认领游客数据）──
class UpgradeRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    email: str | None = None


@router.post("/upgrade", response_model=AuthResponse)
def upgrade_guest(body: UpgradeRequest, user: User = Depends(get_current_user)):
    """游客注册：把当前游客账号升级为正式用户（数据零迁移归入新账号）"""
    if user.role != "guest":
        raise HTTPException(400, "当前账号不是游客")
    with get_session() as session:
        if session.query(User).filter(User.username == body.username).first():
            raise HTTPException(400, "用户名已存在")
        user.username = body.username
        user.email = body.email
        user.role = "user"
        session.add(UserCredential(
            user_id=user.id,
            password_hash=hash_password(body.password),
            password_set_at=datetime.utcnow(),
        ))
        session.commit()
        return _issue_tokens(session, user)
