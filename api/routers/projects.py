"""
项目管理 API —— 创建/列表/详情（用户隔离：只操作自己的项目）
"""
from fastapi import APIRouter, Depends, HTTPException

from storage.mysql_db import get_session
from storage.models import Project, User
from api.schemas import ProjectCreate, ProjectOut
from utils.auth import get_current_user

router = APIRouter()


def _out(r: Project) -> ProjectOut:
    return ProjectOut(
        id=r.id,
        name=r.name,
        user_query=r.user_query,
        tech_probe=r.tech_probe,
        created_at=r.created_at.isoformat() if r.created_at else "",
    )


def _get_owned_project(session, project_id: int, user: User) -> Project:
    """取当前用户的项目；不存在或非本人 → 404（不泄露存在性）"""
    r = session.get(Project, project_id)
    if not r or r.user_id != user.id:
        raise HTTPException(404, "项目不存在")
    return r


@router.get("", response_model=list[ProjectOut])
def list_projects(user: User = Depends(get_current_user)):
    """获取当前用户的项目列表（按创建时间倒序）"""
    with get_session() as session:
        rows = (
            session.query(Project)
            .filter(Project.user_id == user.id)
            .order_by(Project.created_at.desc())
            .all()
        )
        return [_out(r) for r in rows]


@router.post("", response_model=ProjectOut)
def create_project(body: ProjectCreate, user: User = Depends(get_current_user)):
    """创建新项目（归属当前用户）"""
    with get_session() as session:
        p = Project(
            name=body.name,
            user_query=body.user_query,
            tech_probe=body.tech_probe,
            user_id=user.id,
        )
        session.add(p)
        session.flush()
        pid = p.id
        created = p.created_at
    return ProjectOut(
        id=pid,
        name=body.name,
        user_query=body.user_query,
        tech_probe=body.tech_probe,
        created_at=created.isoformat() if created else "",
    )


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, user: User = Depends(get_current_user)):
    """获取单个项目详情（仅本人）"""
    with get_session() as session:
        return _out(_get_owned_project(session, project_id, user))
