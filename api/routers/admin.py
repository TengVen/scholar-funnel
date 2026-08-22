"""
Admin 管理 API —— 仅 admin 角色可访问（require_admin）

- 用户管理：列表 / 禁用启用 / 重置密码
- 数据管理：全库统计 / 项目列表（跨用户）/ 删除任意项目
- 系统配置：sys_settings KV 读写
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from storage.mysql_db import get_session
from storage.models import (
    User, UserCredential, Project, Paper, CartItem, Conversation,
)
from utils.auth import require_admin, hash_password
from sqlalchemy import text

router = APIRouter()


# ── Schemas ──
class UserStatusRequest(BaseModel):
    status: int = Field(ge=0, le=1)


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=6, max_length=128)


class SettingsUpsertRequest(BaseModel):
    key: str
    value: dict | list | str | int | float | bool
    description: str = ""


# ── 用户管理 ──

@router.get("/users")
def list_users(admin: User = Depends(require_admin)):
    """用户列表（含项目数统计）"""
    with get_session() as session:
        rows = session.query(User).order_by(User.id.asc()).all()
        result = []
        for u in rows:
            proj_count = (
                session.query(Project).filter(Project.user_id == u.id).count()
            )
            result.append({
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "role": u.role,
                "status": u.status,
                "created_at": u.created_at.isoformat() if u.created_at else "",
                "project_count": proj_count,
            })
        return result


@router.put("/users/{user_id}/status")
def set_user_status(user_id: int, body: UserStatusRequest, admin: User = Depends(require_admin)):
    """禁用/启用用户"""
    with get_session() as session:
        u = session.get(User, user_id)
        if not u:
            raise HTTPException(404, "用户不存在")
        if u.id == admin.id:
            raise HTTPException(400, "不能禁用自己的账号")
        u.status = body.status
        session.commit()
        return {"ok": True, "username": u.username, "status": u.status}


@router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: int, body: ResetPasswordRequest, admin: User = Depends(require_admin)):
    """重置用户密码"""
    with get_session() as session:
        u = session.get(User, user_id)
        if not u:
            raise HTTPException(404, "用户不存在")
        cred = session.query(UserCredential).filter_by(user_id=user_id).first()
        if cred:
            cred.password_hash = hash_password(body.password)
        else:
            session.add(UserCredential(
                user_id=user_id,
                password_hash=hash_password(body.password),
                password_set_at=datetime.utcnow(),
            ))
        session.commit()
        return {"ok": True, "username": u.username, "message": "密码已重置"}


# ── 数据管理 ──

@router.get("/stats")
def system_stats(admin: User = Depends(require_admin)):
    """全库统计"""
    with get_session() as session:
        users = session.query(User).count()
        projects = session.query(Project).count()
        papers = session.query(Paper).count()
        cart_items = session.query(CartItem).count()
        convs = session.query(Conversation).count()
        return {
            "users": users,
            "projects": projects,
            "papers": papers,
            "cart_items": cart_items,
            "conversations": convs,
        }


@router.get("/projects")
def list_all_projects(admin: User = Depends(require_admin)):
    """所有项目列表（跨用户，含归属信息）"""
    with get_session() as session:
        rows = (
            session.query(Project)
            .order_by(Project.created_at.desc())
            .all()
        )
        owner_names = {}
        for r in rows:
            if r.user_id and r.user_id not in owner_names:
                u = session.get(User, r.user_id)
                owner_names[r.user_id] = u.username if u else "?"
        return [
            {
                "id": r.id,
                "name": r.name,
                "user_id": r.user_id,
                "owner": owner_names.get(r.user_id, "未归属"),
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in rows
        ]


@router.delete("/projects/{project_id}")
def delete_any_project(project_id: int, admin: User = Depends(require_admin)):
    """删除任意项目（级联清理论文/骨架）"""
    with get_session() as session:
        p = session.get(Project, project_id)
        if not p:
            raise HTTPException(404, "项目不存在")
        # 级联清理（手动删关联表，避免外键冲突）
        session.query(CartItem).filter_by(project_id=project_id).delete(synchronize_session=False)
        session.query(Paper).filter_by(project_id=project_id).delete(synchronize_session=False)
        session.delete(p)
        session.commit()
        return {"ok": True, "deleted_project_id": project_id}


# ── 系统配置（sys_settings）──

@router.get("/settings")
def list_settings(admin: User = Depends(require_admin)):
    """全部系统配置"""
    with get_session() as session:
        rows = session.execute(
            text("SELECT key, value, description FROM sys_settings ORDER BY key")
        ).mappings().all()
        return [
            {"key": r["key"], "value": r["value"], "description": r["description"]}
            for r in rows
        ]


@router.put("/settings")
def upsert_setting(body: SettingsUpsertRequest, admin: User = Depends(require_admin)):
    """写入/更新配置项（upsert）"""
    import json
    with get_session() as session:
        session.execute(
            text("""
                INSERT INTO sys_settings (key, value, description, updated_at)
                VALUES (:k, CAST(:v AS jsonb), :d, NOW())
                ON CONFLICT (key) DO UPDATE
                  SET value = EXCLUDED.value,
                      description = EXCLUDED.description,
                      updated_at = NOW()
            """),
            {"k": body.key, "v": json.dumps(body.value, ensure_ascii=False), "d": body.description},
        )
        session.commit()
        return {"ok": True, "key": body.key}


@router.delete("/settings/{key}")
def delete_setting(key: str, admin: User = Depends(require_admin)):
    """删除配置项"""
    with get_session() as session:
        session.execute(text("DELETE FROM sys_settings WHERE key = :k"), {"k": key})
        session.commit()
        return {"ok": True}
