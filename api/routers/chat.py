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
from utils.log import setup_logger
from agents import chat_agent

router = APIRouter()

logger = setup_logger("chat")


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
    return [
        {
            "role": m.role,
            "content": m.content or "",
            "project_id": m.project_id,   # 检索完成消息关联项目（前端"查看项目"按钮）
            "project_name": m.project_name if hasattr(m, "project_name") else None,
            "attachments": m.attachments,  # 结构化消息卡（深度调研等）
        }
        for m in rows[-limit:]
    ]


def _append_message(session, conv: Conversation, user_id: int, role: str, content: str,
                    project_id: int | None = None, project_name: str | None = None,
                    attachments: dict | None = None):
    session.add(Message(
        uuid=secrets.token_hex(16),
        conversation_id=conv.id,
        user_id=user_id,
        role=role,
        content=content,
        project_id=project_id,
        attachments=attachments,
    ))
    conv.message_count = (conv.message_count or 0) + 1
    conv.last_message_at = datetime.now()
    session.commit()


# ── 对话（主 Agent 循环） ──

@router.post("/message", response_model=ChatResponse)
def send_message(body: ChatRequest, user: User = Depends(get_current_user)):
    # OpenAlex 礼貌邮箱：用户邮箱优先，否则默认（游客/未填邮箱）
    from sources import openalex as oa
    oa.set_mailto(user.email)

    if body.llm_config:
        try:
            llm.configure(
                api_key=body.llm_config.get("api_key"),
                base_url=body.llm_config.get("base_url"),
                model=body.llm_config.get("model"),
            )
        except Exception:
            pass
        # 模型来源切换（对话页高级配置：'local' / 'api'）→ 全局生效（后续检索/深度调研同样生效）
        provider = (body.llm_config or {}).get("embedding_provider")
        if provider in ("local", "api"):
            from retrieval import embedding, reranker
            embedding.configure(provider=provider)
            reranker.configure(provider=provider)

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
        # L1 来源卡：answer_with_sources 的 hits 随回复持久化（前端渲染"来源"列表）
        l1_sources = agent_result.get("l1_sources")
        _append_message(
            session, conv, user.id, "assistant", agent_result["reply"],
            project_id=conv.project_id,
            attachments=(
                {"type": "l1_sources", "level": "L1", "sources": l1_sources}
                if l1_sources else None
            ),
        )

    return ChatResponse(
        conversation_id=conv.uuid,
        reply=agent_result["reply"],
        stage="chat",
        task_id=agent_result.get("task_id"),
        task_type=agent_result.get("tool_name"),
        params=conv.params or {},
        l1_sources=agent_result.get("l1_sources"),
    )


# ── 异步检索：状态 / 结果 / 总结 ──

def _assert_task_owner(task: dict, user: User):
    """校验 task 归属：仅创建者本人可查询/取结果"""
    if task.get("user_id") is not None and task["user_id"] != user.id:
        raise HTTPException(403, "无权访问该任务")


@router.get("/search/status")
def get_search_status(task_id: str, user: User = Depends(get_current_user)):
    task = chat_agent.get_search_task(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    _assert_task_owner(task, user)
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
    _assert_task_owner(task, user)
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

    # L2 认知结构（v0 规则三层分组；T10 地图归纳落地后替换为数据驱动版，schema 不变）
    cognitive = None
    try:
        from agents.structure import build_cognitive_structure
        cognitive = build_cognitive_structure(
            project_id=project_id,
            topic=project_name,
            total_candidates=search.get("total_found") or None,
        )
    except Exception as e:
        logger.warning(f"认知结构构建失败（不影响总结）: {e}")

    # 存会话消息（role=assistant，带 L2 认知结构卡）——按 user 过滤，防跨用户越权
    with get_session() as session:
        conv = (
            session.query(Conversation)
            .filter(
                Conversation.project_id == project_id,
                Conversation.user_id == user.id,
            )
            .first()
        )
        if conv:
            _append_message(
                session, conv, user.id, "assistant",
                summary,
                project_id=project_id, project_name=project_name,
                attachments=(
                    {"type": "l2_structure", "level": "L2", "cognitive_structure": cognitive}
                    if cognitive else None
                ),
            )

    payload = {
        "summary": summary,
        "project_id": project_id,
        "project_name": project_name,
        "cognitive_structure": cognitive,
    }
    task["summarized"] = True
    task["summary_payload"] = payload
    return payload


# ── 深度调研（deep_research）结果卡 ──

def _thread_project_id(thread_id: str) -> int | None:
    """从 funnel thread_id 提取 project_id（格式: funnel-{project_id}-{hex}）"""
    parts = thread_id.split("-")
    if len(parts) >= 2 and parts[0] == "funnel" and parts[1].isdigit():
        return int(parts[1])
    return None


@router.post("/deep-research/{thread_id}/finalize")
def finalize_deep_research(thread_id: str, user: User = Depends(get_current_user)):
    """
    深度调研完成后：把漏斗结果（骨架候选 + 探针 + 统计）写为一条结果卡消息（attachments），
    并返回给前端渲染。幂等：同一 thread 已生成过结果卡则直接返回既有结果。
    """
    from agents.funnel.graph import get_funnel_state

    # 归属校验：thread_id 内嵌 project_id，必须属于当前用户
    pid = _thread_project_id(thread_id)
    if pid is None:
        raise HTTPException(400, "无效的 thread_id")
    with get_session() as session:
        get_owned_project(session, pid, user)

    res = get_funnel_state(thread_id)
    if "error" in res:
        raise HTTPException(404, res["error"])
    state = res.get("state") or {}
    if state.get("stage_status") == "error":
        raise HTTPException(500, state.get("error") or "深度调研执行失败")
    if res.get("interrupted") or state.get("current_stage") != "done" \
            or state.get("stage_status") != "done":
        raise HTTPException(202, "任务进行中")

    project_id = state.get("project_id") or pid
    progress = state.get("progress", {})
    trunk = progress.get("trunk", {}) or {}
    recs = state.get("skeleton_recommendations") or []
    probes = state.get("derived_probes") or []

    # 研究成果指标（面向用户：研究形成了什么，而非系统处理了多少数据）
    # 检索过程（主干召回→初筛→Rerank→核心候选）收纳进 process，前端"查看检索过程"展开
    core_n = len(recs)
    payload = {
        "type": "deep_research_result",
        "level": "L3",
        "thread_id": thread_id,
        "project_id": project_id,
        "metrics": {
            "core_papers": core_n,          # 核心论文（AI 推荐骨架候选）
            "new_papers": trunk.get("new_saved", 0),   # 新增文献（主干新入库）
            "skeleton_candidates": core_n,  # 骨架候选（与核心论文同源，随深研定义演进）
            "research_probes": len(probes), # 研究探针
        },
        "process": {
            "total_found": trunk.get("total_found", 0),   # 主干召回
            "new_saved": trunk.get("new_saved", 0),
            "survey_count": trunk.get("survey_count", 0),  # 综述占比
        },
        "candidates": [
            {
                "paper_id": r.get("paper_id"),
                "title": r.get("title", ""),
                "year": r.get("year", 0),
                "suggested_category": r.get("suggested_category", "mainstream"),
                "reason": r.get("reason", ""),
            }
            for r in recs[:12]
        ],
        "probes": [
            {
                "probe": p.get("probe", ""),
                "description": p.get("description", ""),
                "coverage_ratio": p.get("coverage_ratio", 0),
            }
            for p in probes[:5]
        ],
    }
    content = (
        f"深度调研完成：核心论文 {payload['metrics']['core_papers']} 篇、"
        f"新增文献 {payload['metrics']['new_papers']} 篇、"
        f"骨架候选 {payload['metrics']['skeleton_candidates']} 篇、"
        f"研究探针 {payload['metrics']['research_probes']} 个。"
        "骨架候选未自动入库，可在此加入或到研究空间查看。"
    )

    with get_session() as session:
        conv = (
            session.query(Conversation)
            .filter(Conversation.project_id == project_id, Conversation.user_id == user.id)
            .first()
        )
        if conv:
            # 幂等：该 thread 已生成过结果卡 → 直接返回既有，避免重复落库
            for m in (
                session.query(Message)
                .filter(Message.conversation_id == conv.id)
                .order_by(Message.id.asc())
                .all()
            ):
                att = m.attachments
                if isinstance(att, dict) and att.get("type") == "deep_research_result" \
                        and att.get("thread_id") == thread_id:
                    return {"content": m.content or content, "attachments": att}
            pname = ""
            proj = session.get(Project, project_id)
            if proj:
                pname = proj.name
            _append_message(
                session, conv, user.id, "assistant", content,
                project_id=project_id, project_name=pname, attachments=payload,
            )

    return {"content": content, "attachments": payload}


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
        # 补项目名（历史消息的"查看项目"按钮显示友好名称）
        pids = {m.get("project_id") for m in messages if m.get("project_id")}
        if pids:
            name_map = {
                pid: name for pid, name in (
                    session.query(Project.id, Project.name)
                    .filter(Project.id.in_(pids))
                    .all()
                )
            }
            for m in messages:
                if m.get("project_id") in name_map:
                    m["project_name"] = name_map[m["project_id"]]
        return {
            "conversation_id": conv.uuid,
            "messages": messages,
            "stage": conv.stage,
            "params": conv.params or {},
            "project_id": conv.project_id,
            "project_ids": conv.project_ids or [],
            "title": conv.title,
        }
