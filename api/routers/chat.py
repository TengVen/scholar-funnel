"""
Chat API —— 主 Agent（Function Calling 工具化）

- send_message：走主 Agent 循环（agents/chat_agent.run_agent）
  模型自主决策：直接回复（讨论）或调用工具（full_search 等）
- full_search 为异步：返回 task_id，前端轮询，完成后生成文字总结
- 会话 ↔ 项目多对多：project_ids（历史检索可回看）

对话只返回文字总结 + 引导跳转，检索详情在检索页查看。
"""
import json
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func

from api.schemas import ChatRequest, ChatResponse
from llm import client as llm
from storage.mysql_db import get_session
from storage.models import Conversation, Message, Project, User, CartItem, Paper, SearchRun, PaperRunLink
from utils.auth import get_current_user, get_owned_project
from utils.task_guard import assert_task_owner
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


def _conv_messages(session, conv: Conversation, limit: int = 30, for_llm: bool = False) -> list[dict]:
    """按时间取会话消息（最近 limit 条）。

    for_llm=True：供 LLM 上下文——把历史工具调用痕迹（attachments.tool_calls）
    注入为可读摘要行（如 [工具] full_search(...) -> 已启动 task=xxx），
    让模型感知历史真实工具执行，避免仅凭话术判断。
    前端历史加载（for_llm=False）不注入，保持纯文本展示。
    """
    rows = (
        session.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.id.asc())
        .all()
    )
    out = []
    for m in rows[-limit:]:
        d = {
            "role": m.role,
            "content": m.content or "",
            "project_id": m.project_id,   # 检索完成消息关联项目（前端"查看项目"按钮）
            "project_name": m.project_name if hasattr(m, "project_name") else None,
            "attachments": m.attachments,  # 结构化消息卡（深度调研等）
        }
        if for_llm and isinstance(m.attachments, dict) and m.attachments.get("tool_calls"):
            lines = []
            for t in m.attachments["tool_calls"]:
                task = f"task_id={t.get('task_id')}" if t.get("task_id") else ""
                lines.append(
                    f"[工具] {t.get('name', '')}({t.get('args', '')[:120]})"
                    f" -> {t.get('result', '')[:100]} {task}".strip()
                )
            if lines:
                d["content"] = f"{d['content']}\n\n{chr(10).join(lines)}".strip()
        out.append(d)
    return out


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

def _apply_runtime_config(body: ChatRequest, user: User) -> None:
    """对话请求前置：OpenAlex 礼貌邮箱 + 运行时 LLM/向量模型配置（/message 与 /message/stream 共用）"""
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


@router.post("/message", response_model=ChatResponse)
def send_message(body: ChatRequest, user: User = Depends(get_current_user)):
    _apply_runtime_config(body, user)

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
        history = _conv_messages(session, conv, for_llm=True)

    # 主 Agent 循环（工具调用 + 自由对话）
    agent_result = chat_agent.run_agent(conv, user, history)

    with get_session() as session:
        # L1 来源卡：answer_with_sources 的 hits 随回复持久化（前端渲染"来源"列表）
        l1_sources = agent_result.get("l1_sources")
        # C：工具调用痕迹随回复落库（attachments.tool_calls；排查可查 + 历史回传 LLM）
        tool_logs = agent_result.get("tool_logs") or []
        att: dict = {}
        if l1_sources:
            att.update({"type": "l1_sources", "level": "L1", "sources": l1_sources})
        if tool_logs:
            att["tool_calls"] = tool_logs
            att.setdefault("type", "tool_calls")
        _append_message(
            session, conv, user.id, "assistant", agent_result["reply"],
            project_id=conv.project_id,
            attachments=att if att else None,
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


def _sse(obj: dict) -> str:
    """SSE 事件帧（单行 JSON，避免多行 payload 破坏帧结构）"""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("/message/stream")
def send_message_stream(body: ChatRequest, user: User = Depends(get_current_user)):
    """流式对话（SSE）——与 /message 同一主 Agent 链路，最终文字逐 token 推送。

    事件帧（text/event-stream，每帧 data: {json}）：
    - {"type":"token","text":...}            生成中文本增量
    - {"type":"done", ...ChatResponse 字段}  完成（assistant 消息已落库）
    - {"type":"error","message":...}         失败（用户消息已存，assistant 未落库，语义同 /message 失败）
    """
    _apply_runtime_config(body, user)

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
        history = _conv_messages(session, conv, for_llm=True)

    def _gen():
        try:
            for ev in chat_agent.run_agent_stream(conv, user, history):
                if ev["type"] == "text":
                    yield _sse({"type": "token", "text": ev["text"]})
                    continue
                # done：先落库 assistant 回复（attachments 组装与 /message 一致），再回执完成事件
                reply = ev["reply"]
                l1_sources = ev.get("l1_sources")
                tool_logs = ev.get("tool_logs") or []
                att: dict = {}
                if l1_sources:
                    att.update({"type": "l1_sources", "level": "L1", "sources": l1_sources})
                if tool_logs:
                    att["tool_calls"] = tool_logs
                    att.setdefault("type", "tool_calls")
                with get_session() as session:
                    _append_message(
                        session, conv, user.id, "assistant", reply,
                        project_id=conv.project_id,
                        attachments=att if att else None,
                    )
                yield _sse({
                    "type": "done",
                    "conversation_id": conv.uuid,
                    "reply": reply,
                    "stage": "chat",
                    "params": conv.params or {},
                    "task_id": ev.get("task_id"),
                    "task_type": ev.get("tool_name"),
                    "l1_sources": l1_sources,
                })
                return
        except llm.LLMError as e:
            logger.warning(f"对话流式生成失败: {e}")
            yield _sse({"type": "error", "message": str(e)})
        except Exception as e:  # 工具/落库等意外：如实透出，前端本地展示错误消息
            logger.exception("对话流式生成意外异常")
            yield _sse({"type": "error", "message": f"生成失败: {e}"})

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 关闭反代缓冲，避免长流被吞（本地直连无碍）
        },
    )


# ── 异步检索：状态 / 结果 / 总结 ──

@router.get("/search/status")
def get_search_status(task_id: str, user: User = Depends(get_current_user)):
    task = chat_agent.get_search_task(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    assert_task_owner(task, user)
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
    assert_task_owner(task, user)
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
    # run_id：关联本次检索的 Run（核心推荐按 Run 归属，工作台论文推荐按 Run 区分）
    run_id = result.get("run_id")
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
                    {"type": "l2_structure", "level": "L2", "run_id": run_id,
                     "cognitive_structure": cognitive}
                    if cognitive else None
                ),
            )

    # 领域地图顺产（T10）：与认知结构同 run 异步生成，不阻塞 finalize 返回；
    # 失败/历史 run 可经工作台「生成领域地图」按需重试（POST /runs/{id}/map）
    if run_id:
        try:
            from agents import map_builder
            map_builder.generate_run_map_async(run_id, project_id, project_name)
        except Exception as e:
            logger.warning(f"领域地图顺产调度失败（可后续按需生成）: {e}")

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

    # 深研项目的 trunk 检索 run（funnel 内部走 pipeline.search，run 已落库）——结果卡按 Run 归属
    try:
        from storage.search_runs import recent_runs
        _runs = recent_runs(project_id, 1)
        _deep_run_id = _runs[0]["id"] if _runs else None
    except Exception:
        _deep_run_id = None

    # 候选富化：从 ai_papers 补作者/被引（推荐理由之外的元数据，供三分类分组下的论文行展示）
    paper_ids = [r.get("paper_id") for r in recs[:12] if r.get("paper_id")]
    paper_info: dict[int, dict] = {}
    if paper_ids:
        from storage.models import Paper as PaperModel
        with get_session() as session:
            for row in session.query(PaperModel).filter(PaperModel.id.in_(paper_ids)).all():
                authors = row.authors if isinstance(row.authors, list) else []
                paper_info[row.id] = {
                    "authors": authors[:3],
                    "authors_note": f"{authors[0]}{' 等' if len(authors) > 1 else ''}" if authors else "",
                    "cited_by_count": row.cited_by_count or 0,
                }

    # 研究成果指标（面向用户：研究形成了什么，而非系统处理了多少数据）
    # 检索过程（主干召回→初筛→Rerank→核心候选）收纳进 process，前端"查看检索过程"展开
    core_n = len(recs)
    payload = {
        "type": "deep_research_result",
        "level": "L3",
        "thread_id": thread_id,
        "project_id": project_id,
        "run_id": _deep_run_id,  # 关联本次检索的 Run（论文推荐按 Run 归属）
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
                "authors_note": paper_info.get(r.get("paper_id"), {}).get("authors_note", ""),
                "cited_by_count": paper_info.get(r.get("paper_id"), {}).get("cited_by_count", 0),
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
            # 0 召回：不产生无意义空子研究——移除会话关联（project 保留为孤儿，工作台不可见）
            if trunk.get("total_found", 0) == 0:
                ids = list(conv.project_ids or [])
                if project_id in ids:
                    ids.remove(project_id)
                conv.project_ids = ids
                if conv.project_id == project_id:
                    conv.project_id = ids[-1] if ids else None
                session.commit()
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
            # 0 召回时结果卡文案明确提示（区别于正常完成）
            if trunk.get("total_found", 0) == 0:
                content = (
                    f"深度调研未能召回到文献（「{pname}」）。\n"
                    "可能原因：关键词过于具体、或数据源暂时不可用。"
                    "建议调整方向描述后重新调研，或稍后再试。"
                )
            _append_message(
                session, conv, user.id, "assistant", content,
                project_id=project_id, project_name=pname, attachments=payload,
            )

    return {"content": content, "attachments": payload}


def _generate_summary(search: dict, project_name: str) -> str:
    """用检索统计生成一句话总结（不调 LLM，避免额外耗时和成本）。
    0 召回时给出明确提示（区别于"正常完成"），引导用户调整关键词。"""
    total = search.get("total_found", 0)
    saved = search.get("new_saved", 0)
    surveys = search.get("survey_count", 0)
    if total == 0:
        return (
            f"「{project_name}」方向的检索未能召回到文献。\n"
            "可能原因：关键词过于具体、或 OpenAlex 暂时限流。"
            "建议调整关键词/方向描述后重新检索，或稍后再试。"
        )
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


# ── 工作台概览（2-page IA：对话 → 子研究 → 四区块）──

@router.get("/conversations/{conversation_id}/workspace")
def get_workspace(conversation_id: str, user: User = Depends(get_current_user)):
    """工作台概览：对话下的子研究列表，每个子研究含
    检索记录 / L2 认知结构（骨架摘要，只读）/ 论文集合（已/未探究）/ 深入研究（已探究论文）。"""
    with get_session() as session:
        conv = (
            session.query(Conversation)
            .filter(Conversation.uuid == conversation_id, Conversation.user_id == user.id)
            .first()
        )
        if conv is None:
            raise HTTPException(404, "会话不存在")
        sub_researches = []
        for pid in (conv.project_ids or []):
            proj = session.get(Project, pid)
            if proj:
                sub_researches.append(_project_workspace(session, proj))
        return {
            "conversation_id": conv.uuid,
            "title": conv.title,
            "sub_researches": sub_researches,
        }


def _project_workspace(session, p: Project) -> dict:
    """单个子研究的四区块摘要（同一 session 聚合，避免嵌套连接）"""
    # 检索记录（时间倒序；每条带归属论文——Search Run 独立资产视图）
    runs = (
        session.query(SearchRun)
        .filter(SearchRun.project_id == p.id)
        .order_by(SearchRun.created_at.desc())
        .limit(20)
        .all()
    )
    run_ids = [r.id for r in runs]
    # 批量加载 run→papers（避免 N+1）：ai_paper_runs + ai_papers 一次查
    run_papers: dict[int, list[dict]] = {rid: [] for rid in run_ids}
    run_keywords: dict[int, list[str]] = {rid: [] for rid in run_ids}  # 各 run 归属论文的高频关键词 top5
    if run_ids:
        links = (
            session.query(PaperRunLink)
            .filter(PaperRunLink.search_run_id.in_(run_ids))
            .all()
        )
        pids = {l.paper_id for l in links}
        paper_map: dict[int, Paper] = {}
        if pids:
            for row in session.query(Paper).filter(Paper.id.in_(pids)).all():
                paper_map[row.id] = row
        for l in links:
            row = paper_map.get(l.paper_id)
            if row:
                run_papers[l.search_run_id].append({
                    "paper_id": row.id,
                    "openalex_id": row.openalex_id,
                    "title": row.title,
                    "year": row.year,
                    "explored": row.explored_at is not None,
                })
                # 关键词聚合（ai_papers.keywords JSON 数组，OpenAlex concepts）
                kws = row.keywords if isinstance(row.keywords, list) else []
                if kws:
                    run_keywords[l.search_run_id].extend(
                        k for k in kws if isinstance(k, str) and k.strip()
                    )
    from collections import Counter
    for rid in run_ids:
        cnt = Counter(run_keywords[rid])
        run_keywords[rid] = [k for k, _ in cnt.most_common(5)]
    # 各 Run 的核心推荐（共用解析：l2_structure 三分类 / deep_research_result 候选分组）
    from storage.search_runs import collect_run_cognitive
    run_cognitive = collect_run_cognitive(session, p.id, run_ids)
    # 领域地图状态（T10：批量查一次，供工作台"生成领域地图/查看地图"按钮态）
    map_statuses: dict[int, str] = {}
    if run_ids:
        from storage.models import RunMap
        for rid, st in (
            session.query(RunMap.run_id, RunMap.status)
            .filter(RunMap.run_id.in_(run_ids))
            .all()
        ):
            map_statuses[rid] = st
    # 论文推荐 = 子研究池内论文（全量/增量检索入库的累积论文池；按 Run 归属由 search_runs.papers 细化）
    paper_rows = (
        session.query(Paper)
        .filter(Paper.project_id == p.id)
        .order_by(Paper.explored_at.desc().nullslast(), Paper.id.desc())
        .limit(100)
        .all()
    )
    papers = [
        {
            "paper_id": row.id,
            "openalex_id": row.openalex_id,
            "title": row.title,
            "year": row.year,
            "stage": row.stage,
            "explored": row.explored_at is not None,
        }
        for row in paper_rows
    ]
    # 深入研究 = 该子研究已探究的历史论文（独立查询：不限推荐集，探究入口可能来自检索页）
    explored_rows = (
        session.query(Paper)
        .filter(Paper.project_id == p.id, Paper.explored_at.isnot(None))
        .order_by(Paper.explored_at.desc())
        .limit(50)
        .all()
    )
    explored_papers = [
        {
            "paper_id": row.id, "openalex_id": row.openalex_id, "title": row.title,
            "year": row.year, "stage": row.stage, "explored": True,
        }
        for row in explored_rows
    ]
    return {
        "project_id": p.id,
        "name": p.name,
        "user_query": p.user_query,
        "tech_probe": p.tech_probe,
        "created_at": p.created_at.isoformat() if p.created_at else "",
        "search_runs": [
            {
                "id": r.id, "run_type": r.run_type, "query": r.query,
                "user_constraint": r.user_constraint, "target_category": r.target_category,
                "total_found": r.total_found, "saved_count": r.saved_count,
                "covered_ratio": r.covered_ratio,
                # ── P1/P3：模式/状态/决策留痕（工作台可见）──
                "mode": r.mode, "status": r.status, "error": r.error,
                "plan_reason": r.plan_reason,
                "year_from": r.year_from, "year_to": r.year_to,
                "methodology": r.methodology, "paper_type": r.paper_type,
                "keywords": run_keywords.get(r.id, []),
                "papers": run_papers.get(r.id, []),
                "cognitive": run_cognitive.get(r.id, {}),
                "map_status": map_statuses.get(r.id, "none"),
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in runs
        ],
        "cognitive": run_cognitive,  # 兼容：顶层汇总（各 Run 已内嵌 cognitive）
        "papers": papers,
        "explored_papers": explored_papers,
    }
