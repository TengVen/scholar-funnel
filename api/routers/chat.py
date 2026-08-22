"""
Chat API —— 主 Agent（Function Calling 工具化）

- send_message：走主 Agent 循环（agents/chat_agent.run_agent）
  模型自主决策：直接回复（讨论）或调用工具（full_search 等）
- full_search 为异步：返回 task_id，前端轮询，完成后生成文字总结
- 会话 ↔ 项目多对多：project_ids（历史检索可回看）

对话只返回文字总结 + 引导跳转，检索详情在检索页查看。
"""
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from api.schemas import ChatRequest, ChatResponse
from llm import client as llm
from storage.mysql_db import get_session
from storage.models import Conversation, Message, Project, User
from utils.auth import get_current_user, get_owned_project
from agents import chat_agent

router = APIRouter()


# ── 会话读写（库） ──

def _get_conv(session, conv_id: str, user: User) -> Conversation:
    """取当前用户的会话；不存在则创建（归属当前用户）"""
    conv = (
        session.query(Conversation)
        .filter(Conversation.uuid == conv_id, Conversation.user_id == user.id)
        .first()
    )
    if conv is None:
        conv = Conversation(
            uuid=conv_id[:32] or secrets.token_hex(16),
            user_id=user.id,
            title="new",
            stage="greeting",
            params={},
        )
        session.add(conv)
        session.commit()
    return conv


def _conv_messages(session, conv: Conversation, limit: int = 30) -> list[dict]:
    """按时间取会话消息（最近 limit 条，供 LLM 上下文）"""
    rows = (
        session.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.id.asc())
        .all()
    )
    return [{"role": m.role, "content": m.content or ""} for m in rows[-limit:]]


def _append_message(session, conv: Conversation, user_id: int, role: str, content: str):
    session.add(Message(
        uuid=secrets.token_hex(16),
        conversation_id=conv.id,
        user_id=user_id,
        role=role,
        content=content,
    ))
    conv.message_count = (conv.message_count or 0) + 1
    conv.last_message_at = datetime.utcnow()
    session.commit()


# ── 对话（主 Agent 循环） ──

@router.post("/message", response_model=ChatResponse)
def send_message(body: ChatRequest, user: User = Depends(get_current_user)):
    if body.llm_config:
        try:
            llm.configure(
                api_key=body.llm_config.get("api_key"),
                base_url=body.llm_config.get("base_url"),
                model=body.llm_config.get("model"),
            )
        except Exception:
            pass

    with get_session() as session:
        conv = _get_conv(session, body.conversation_id, user)
        # 若前端带了 project_id（用户切到某项目后继续讨论）→ 关联会话
        if body.project_id:
            get_owned_project(session, body.project_id, user)
            if conv.project_id != body.project_id:
                ids = list(conv.project_ids or [])
                if body.project_id not in ids:
                    ids.append(body.project_id)
                conv.project_ids = ids
                conv.project_id = body.project_id
                session.commit()

        _append_message(session, conv, user.id, "user", body.message)
        history = _conv_messages(session, conv)

    # 主 Agent 循环（工具调用 + 自由对话）
    agent_result = chat_agent.run_agent(conv, user, history)

    with get_session() as session:
        _append_message(session, conv, user.id, "assistant", agent_result["reply"])

    return ChatResponse(
        conversation_id=conv.uuid,
        reply=agent_result["reply"],
        stage="chat",
        task_id=agent_result.get("task_id"),
        params=conv.params or {},
    )


# ── 异步检索：状态 / 结果 / 总结 ──

@router.get("/search/status")
def get_search_status(task_id: str, user: User = Depends(get_current_user)):
    task = chat_agent.get_search_task(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    return {"status": task["status"], "detail": task["detail"], "error": task["error"]}


@router.post("/search/{task_id}/summary")
def finalize_search_summary(task_id: str, user: User = Depends(get_current_user)):
    """
    检索任务完成后：LLM 生成文字总结 → 存会话消息 → 返回总结 + 项目信息。
    前端轮询到 done 后调用，然后把总结渲染到对话里。
    """
    task = chat_agent.get_search_task(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    if task["status"] == "running":
        raise HTTPException(202, "still running")
    if task["status"] == "error":
        raise HTTPException(500, task["error"])
    if task.get("summarized"):
        return task["summary_payload"]

    result = task["result"]
    search = result.get("result", {})
    project_id = result.get("project_id")
    project_name = result.get("project_name", "")

    # LLM 生成文字总结（基于统计，不塞论文列表）
    summary = _generate_summary(search, project_name)

    # 存会话消息（role=assistant，带项目链接信息）
    with get_session() as session:
        conv = (
            session.query(Conversation)
            .filter(Conversation.project_id == project_id)
            .first()
        )
        if conv:
            _append_message(session, conv, user.id, "assistant",
                            f"【检索完成】{summary}")

    payload = {
        "summary": summary,
        "project_id": project_id,
        "project_name": project_name,
    }
    task["summarized"] = True
    task["summary_payload"] = payload
    return payload


def _generate_summary(search: dict, project_name: str) -> str:
    """用检索统计生成一句话总结（不调 LLM，避免额外耗时和成本）"""
    total = search.get("total_found", 0)
    saved = search.get("new_saved", 0)
    surveys = search.get("survey_count", 0)
    lines = [
        f"「{project_name}」方向的检索已完成：共召回 {total} 篇，新入库 {saved} 篇"
        + (f"，其中综述 {surveys} 篇" if surveys else "") + "。",
        "已生成检索项目，可在检索页查看论文列表（按相关度/被引/年份排序），"
        "并从中挑选论文加入骨架（奠基/主流/前沿）。",
    ]
    return "\n".join(lines)


# ── 会话列表 / 历史 ──

@router.get("/conversations")
def list_conversations(user: User = Depends(get_current_user)):
    """当前用户的会话列表（按最后消息倒序）"""
    with get_session() as session:
        rows = (
            session.query(Conversation)
            .filter(Conversation.user_id == user.id)
            .order_by(Conversation.last_message_at.desc().nullslast(), Conversation.id.desc())
            .limit(100)
            .all()
        )
        return [
            {
                "conversation_id": c.uuid,
                "title": c.title,
                "stage": c.stage,
                "project_id": c.project_id,
                "project_ids": c.project_ids or [],
                "message_count": c.message_count or 0,
                "created_at": c.created_at.isoformat() if c.created_at else "",
                "last_message_at": c.last_message_at.isoformat() if c.last_message_at else "",
            }
            for c in rows
        ]


@router.get("/history")
def get_history(conversation_id: str, user: User = Depends(get_current_user)):
    with get_session() as session:
        conv = (
            session.query(Conversation)
            .filter(Conversation.uuid == conversation_id, Conversation.user_id == user.id)
            .first()
        )
        if conv is None:
            raise HTTPException(404, "会话不存在")
        messages = _conv_messages(session, conv, limit=200)
        return {
            "conversation_id": conv.uuid,
            "messages": messages,
            "stage": conv.stage,
            "params": conv.params or {},
            "project_id": conv.project_id,
            "project_ids": conv.project_ids or [],
            "title": conv.title,
        }
