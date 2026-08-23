"""
系统公告 API —— 对话页铃铛展示

- GET    /api/announcements         任意登录用户：当前生效公告（active 且在时间窗内）
- POST   /api/announcements         admin：新增
- PUT    /api/announcements/{id}    admin：编辑
- DELETE /api/announcements/{id}    admin：删除

前端未读状态存浏览器 localStorage（scholar_funnel_read_anns），后端不记录。
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_

from storage.mysql_db import get_session
from storage.models import Announcement, User
from utils.auth import get_current_user, require_admin

router = APIRouter()


class AnnouncementIn(BaseModel):
    level: str = "info"          # info / warning / danger
    title: str
    content: str
    active: bool = True
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None


def _to_dict(a: Announcement) -> dict:
    return {
        "id": a.id,
        "level": a.level,
        "title": a.title,
        "content": a.content,
        "created_at": a.created_at.isoformat() if a.created_at else "",
    }


@router.get("")
def list_announcements(user: User = Depends(get_current_user)):
    """返回当前生效公告（active 且在时间窗内），按创建时间倒序。"""
    now = datetime.utcnow()
    with get_session() as session:
        rows = (
            session.query(Announcement)
            .filter(Announcement.active.is_(True))
            .filter(or_(Announcement.start_at.is_(None), Announcement.start_at <= now))
            .filter(or_(Announcement.end_at.is_(None), Announcement.end_at >= now))
            .order_by(Announcement.created_at.desc())
            .all()
        )
        return [_to_dict(a) for a in rows]


@router.post("")
def create_announcement(body: AnnouncementIn, admin: User = Depends(require_admin)):
    with get_session() as session:
        a = Announcement(
            level=body.level,
            title=body.title,
            content=body.content,
            active=body.active,
            start_at=body.start_at,
            end_at=body.end_at,
        )
        session.add(a)
        session.commit()
        session.refresh(a)
        return {"ok": True, "id": a.id}


@router.put("/{announcement_id}")
def update_announcement(
    announcement_id: int,
    body: AnnouncementIn,
    admin: User = Depends(require_admin),
):
    with get_session() as session:
        a = session.get(Announcement, announcement_id)
        if not a:
            raise HTTPException(404, "公告不存在")
        a.level = body.level
        a.title = body.title
        a.content = body.content
        a.active = body.active
        a.start_at = body.start_at
        a.end_at = body.end_at
        session.commit()
        return {"ok": True, "id": a.id}


@router.delete("/{announcement_id}")
def delete_announcement(announcement_id: int, admin: User = Depends(require_admin)):
    with get_session() as session:
        a = session.get(Announcement, announcement_id)
        if not a:
            raise HTTPException(404, "公告不存在")
        session.delete(a)
        session.commit()
        return {"ok": True}
