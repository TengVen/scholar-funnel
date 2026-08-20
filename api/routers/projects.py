"""
项目管理 API —— 创建/列表/详情
"""
from datetime import datetime
from fastapi import APIRouter, HTTPException

from storage.mysql_db import get_session
from storage.models import Project
from api.schemas import ProjectCreate, ProjectOut

router = APIRouter()


@router.get("", response_model=list[ProjectOut])
def list_projects():
    """获取所有项目列表（按创建时间倒序）"""
    with get_session() as session:
        rows = session.query(Project).order_by(Project.created_at.desc()).all()
        return [
            ProjectOut(
                id=r.id,
                name=r.name,
                user_query=r.user_query,
                tech_probe=r.tech_probe,
                created_at=r.created_at.isoformat() if r.created_at else "",
            )
            for r in rows
        ]


@router.post("", response_model=ProjectOut)
def create_project(body: ProjectCreate):
    """创建新项目"""
    with get_session() as session:
        p = Project(name=body.name, user_query=body.user_query, tech_probe=body.tech_probe)
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
def get_project(project_id: int):
    """获取单个项目详情"""
    with get_session() as session:
        r = session.get(Project, project_id)
        if not r:
            raise HTTPException(404, "项目不存在")
        return ProjectOut(
            id=r.id,
            name=r.name,
            user_query=r.user_query,
            tech_probe=r.tech_probe,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
