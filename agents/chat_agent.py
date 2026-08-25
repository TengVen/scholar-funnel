"""
主 Agent（对话层大脑）—— Function Calling 工具化

- 工具注册表：模型"看得见"全部工具，自主决策调用
- Agent 循环：模型 ↔ 工具 ↔ 模型，最多 N 轮（防死循环）
- 工具执行结果回传模型，模型生成最终回复

工具清单（可扩展，加 schema + 执行函数即可）：
  1. full_search           全量检索（异步，生成新项目）
  2. local_semantic_search 已入库论文语义检索（同步，秒级）
  3. gap_search            骨架缺口补充（同步）
  4. get_skeleton_status   当前骨架状态（同步，秒级）
"""
import json
import threading
import uuid
from datetime import datetime

from storage.mysql_db import get_session
from storage.models import Conversation, User
from prompt.chat_agent import SYSTEM_PROMPT

# ── 工具注册表（OpenAI function calling schema）──

TOOL_FULL_SEARCH = {
    "type": "function",
    "function": {
        "name": "full_search",
        "description": "执行一次完整的文献检索（意图拆解→OpenAlex 召回→重排→入库），会生成一个新项目。用户明确要'检索/搜一下/查文献/找论文'且研究方向已明确时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "user_query": {"type": "string", "description": "研究方向描述（必填）"},
                "tech_probe": {"type": "string", "description": "技术探针关键词，如 Transformer"},
                "year_from": {"type": "integer", "description": "起始年份"},
                "year_to": {"type": "integer", "description": "结束年份"},
                "paper_type": {"type": "string", "enum": ["all", "survey", "original"], "description": "论文类型"},
                "methodology": {"type": "string", "description": "方法论偏好"},
            },
            "required": ["user_query"],
        },
    },
}

TOOL_LOCAL_SEARCH = {
    "type": "function",
    "function": {
        "name": "local_semantic_search",
        "description": "在已入库论文中按语义检索（不联网、不新建项目，秒级返回）。用户问'我库里有没有/之前搜过没/本地有什么相关论文'时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "检索内容"},
                "limit": {"type": "integer", "description": "返回条数（默认 5）"},
            },
            "required": ["query"],
        },
    },
}

TOOL_GAP_SEARCH = {
    "type": "function",
    "function": {
        "name": "gap_search",
        "description": "骨架缺口补充检索：为某类别（奠基/主流/前沿）找还缺的论文候选（不入库）。用户说'补一补/缺什么/某类还缺'时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "target_category": {"type": "string", "enum": ["foundation", "mainstream", "frontier"], "description": "目标类别"},
                "user_constraint": {"type": "string", "description": "补充约束"},
            },
            "required": ["target_category"],
        },
    },
}

TOOL_SKELETON_STATUS = {
    "type": "function",
    "function": {
        "name": "get_skeleton_status",
        "description": "查看当前项目骨架的状态（奠基/主流/前沿各类论文数量、是否已满）。用户问'骨架怎么样/骨架缺什么/几个了'时调用。",
        "parameters": {"type": "object", "properties": {}},
    },
}

TOOL_DEEP_RESEARCH = {
    "type": "function",
    "function": {
        "name": "deep_research",
        "description": (
            "执行一次深度调研（多智能体工作流）：意图解析 → 主干检索 → AI 推荐骨架论文（候选，不入库）→ 推导技术探针。"
            "与 full_search 的区别：full_search 只做单次检索入库；deep_research 会额外给出骨架候选与探针，适合用户说"
            "'调研/梳理/了解/综述一下某个方向'、'这个方向该读什么'、'帮我建立一个完整的研究脉络' 等系统性诉求。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_query": {"type": "string", "description": "研究方向描述（必填）"},
                "tech_probe": {"type": "string", "description": "技术探针关键词，如 Transformer"},
                "year_from": {"type": "integer", "description": "起始年份"},
                "year_to": {"type": "integer", "description": "结束年份"},
                "paper_type": {"type": "string", "enum": ["all", "survey", "original"], "description": "论文类型"},
                "methodology": {"type": "string", "description": "方法论偏好"},
            },
            "required": ["user_query"],
        },
    },
}

TOOLS = [
    TOOL_FULL_SEARCH, TOOL_LOCAL_SEARCH, TOOL_GAP_SEARCH, TOOL_SKELETON_STATUS,
    TOOL_DEEP_RESEARCH,
]

# Agent 循环最大轮数（防死循环）
MAX_AGENT_ROUNDS = 4


# ── 后台检索任务（full_search 异步） ──
_search_tasks: dict[str, dict] = {}


def _run_full_search(task_id: str, conv_id: str, params: dict, user_id: int):
    """后台执行全量检索（复用 TrunkSearchEngine），完成后更新会话 project_ids"""
    task = _search_tasks[task_id]
    try:
        from retrieval.pipeline import TrunkSearchEngine
        from storage.models import Project

        task["detail"] = "creating project..."
        with get_session() as session:
            p = Project(
                name=params.get("user_query", "chat")[:80],
                user_query=params.get("user_query", ""),
                tech_probe=params.get("tech_probe", ""),
                user_id=user_id,
            )
            session.add(p)
            session.flush()
            project_id = p.id
            # 会话关联：project_ids 追加 + 当前 project_id
            conv = (
                session.query(Conversation)
                .filter(Conversation.uuid == conv_id, Conversation.user_id == user_id)
                .first()
            )
            if conv:
                ids = list(conv.project_ids or [])
                if project_id not in ids:
                    ids.append(project_id)
                conv.project_ids = ids
                conv.project_id = project_id
                conv.title = params.get("user_query", "new")[:30]
                session.commit()

        task["detail"] = "searching..."
        engine = TrunkSearchEngine()
        result = engine.search(
            project_id=project_id,
            user_query=params.get("user_query", ""),
            tech_probe=params.get("tech_probe", ""),
            year_from=params.get("year_from"),
            year_to=params.get("year_to"),
            score_threshold=params.get("score_threshold", 0.0),
            top_k=params.get("top_k", 100))

        task["result"] = {
            "ok": True, "project_id": project_id,
            "project_name": params.get("user_query", "")[:80],
            "result": result,
        }
        task["status"] = "done"
    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)


def start_full_search(conv_id: str, params: dict, user_id: int) -> dict:
    """启动后台全量检索，返回 task_id"""
    task_id = uuid.uuid4().hex[:12]
    _search_tasks[task_id] = {
        "status": "running", "detail": "", "result": None, "error": None,
        "user_id": user_id,  # 归属校验用
    }
    threading.Thread(
        target=_run_full_search,
        args=(task_id, conv_id, params, user_id),
        daemon=True).start()
    return {"status": "started", "task_id": task_id}


def get_search_task(task_id: str) -> dict | None:
    return _search_tasks.get(task_id)


# ── 工具执行（同步工具） ──

def execute_tool(name: str, args: dict, conv: Conversation, user: User) -> dict:
    """
    执行单个工具，返回给模型的结果。
    异步工具（full_search）返回 task_id，同步工具返回实际数据。
    """
    try:
        if name == "full_search":
            result = start_full_search(conv.uuid, args, user.id)
            return {
                "status": result["status"],
                "task_id": result["task_id"],
                "message": "检索已启动，正在后台执行（预计 1-2 分钟）。完成后再通知用户去检索页查看。",
            }

        if name == "local_semantic_search":
            from storage.vector_store import semantic_recall_papers, ensure_project_embeddings
            query = args.get("query", "")
            limit = int(args.get("limit", 5))
            project_id = conv.project_id
            if not project_id:
                return {"status": "error", "message": "当前会话还没有项目，先发起检索再查询"}
            ensure_project_embeddings(project_id, max_embed=200)
            papers = semantic_recall_papers(
                project_id=project_id, query_text=query,
                limit=limit, similarity_threshold=0.5)
            return {
                "status": "ok",
                "hits": [
                    {"title": p["title"], "year": p["year"],
                     "similarity": p.get("similarity")}
                    for p in papers
                ],
                "message": f"本地语义检索到 {len(papers)} 篇相关论文",
            }

        if name == "gap_search":
            from retrieval.pipeline import TrunkSearchEngine
            category = args.get("target_category", "")
            constraint = args.get("user_constraint", "")
            if not conv.project_id:
                return {"status": "error", "message": "当前会话还没有项目"}
            from storage.models import Project
            with get_session() as session:
                p = session.get(Project, conv.project_id)
                user_query = p.user_query if p else ""
                tech_probe = p.tech_probe or ""
            engine = TrunkSearchEngine()
            res = engine.gap_search(
                project_id=conv.project_id,
                user_query=user_query,
                target_category=category,
                tech_probe=tech_probe,
                user_constraint=constraint,
            )
            cands = res.get("candidates", [])
            return {
                "status": res.get("status", "empty"),
                "found": len(cands),
                "sample_titles": [c["title"][:60] for c in cands[:5]],
                "message": f"缺口补充检索到 {len(cands)} 篇候选（详见检索页候选列表）",
            }

        if name == "get_skeleton_status":
            from storage import cart as cart_svc
            if not conv.project_id:
                return {"status": "error", "message": "当前会话还没有项目"}
            counts = cart_svc.get_counts(conv.project_id)
            labels = {"foundation": "奠基", "mainstream": "主流", "frontier": "前沿"}
            summary = {labels.get(k, k): v for k, v in counts.items()}
            return {
                "status": "ok",
                "counts": summary,
                "message": f"当前骨架：{json.dumps(summary, ensure_ascii=False)}",
            }

        if name == "deep_research":
            result = start_deep_research(conv, user, args)
            return {
                "status": result["status"],
                "thread_id": result.get("thread_id", ""),
                "project_id": result.get("project_id"),
                "message": "深度调研已启动（意图解析→主干检索→骨架候选→探针推导，预计 2-5 分钟）。完成结果会以卡片形式展示在这里。",
            }

        return {"status": "error", "message": f"未知工具: {name}"}
    except Exception as e:
        return {"status": "error", "message": f"工具执行失败: {str(e)}"}


# ── 深度调研（deep_research 异步） ──

def start_deep_research(conv: Conversation, user: User, params: dict) -> dict:
    """
    启动后台深度调研（复用 agents/funnel 的 LangGraph 工作流，auto 模式）。

    - 创建新项目并关联会话（与 full_search 一致）
    - 预生成 funnel thread_id，后台线程执行
    - 写入一条"已启动"消息卡（attachments 持久化 thread_id，切页/多轮后可恢复）
    """
    from agents.funnel.graph import run_funnel
    from storage.models import Message, Project

    thread_id = f"funnel-{uuid.uuid4().hex[:8]}"
    user_query = params.get("user_query", "")

    def bg():
        try:
            with get_session() as session:
                p = Project(
                    name=user_query[:80],
                    user_query=user_query,
                    tech_probe=params.get("tech_probe", ""),
                    user_id=user.id,
                )
                session.add(p)
                session.flush()
                project_id = p.id
                # 会话关联 + 写启动卡
                conv_row = (
                    session.query(Conversation)
                    .filter(Conversation.uuid == conv.uuid, Conversation.user_id == user.id)
                    .first()
                )
                if conv_row:
                    ids = list(conv_row.project_ids or [])
                    if project_id not in ids:
                        ids.append(project_id)
                    conv_row.project_ids = ids
                    conv_row.project_id = project_id
                    conv_row.title = user_query[:30]
                session.add(Message(
                    uuid=uuid.uuid4().hex[:16] + uuid.uuid4().hex[:16],
                    conversation_id=conv_row.id if conv_row else 0,
                    user_id=user.id,
                    role="assistant",
                    content="深度调研已启动：意图解析 → 主干检索 → 骨架候选 → 探针推导（预计 2-5 分钟，完成后在本消息下方展示结果）",
                    project_id=project_id,
                    attachments={
                        "type": "deep_research",
                        "thread_id": thread_id,
                        "project_id": project_id,
                        "status": "running",
                    },
                ))
                session.commit()
                task_project_id = project_id
            # 后台执行漏斗（auto 模式，全自动不中断）
            run_funnel(
                project_id=task_project_id,
                user_input=user_query,
                tech_probe=params.get("tech_probe", ""),
                mode="auto",
                methodology=params.get("methodology", "general"),
                paper_type=params.get("paper_type", "all"),
                year_from=params.get("year_from"),
                year_to=params.get("year_to"),
                thread_id=thread_id,
            )
        except Exception as e:
            # 把错误写入 funnel 状态，供 finalize 读取展示
            try:
                from agents.funnel.graph import _get_graph
                _get_graph().update_state(
                    {"configurable": {"thread_id": thread_id}},
                    {"error": str(e), "stage_status": "error", "interrupted": False},
                )
            except Exception:
                pass

    threading.Thread(target=bg, daemon=True).start()
    return {"status": "started", "thread_id": thread_id}


# ── Agent 主循环 ──



def run_agent(conv: Conversation, user: User, messages: list[dict]) -> dict:
    """
    主 Agent 循环：模型决策 → 执行工具 → 回传 → 直到模型直接回复。

    Args:
        conv: 当前会话（工具执行需要 project_id 等上下文）
        user: 当前用户
        messages: 对话消息列表（含最新用户消息）

    Returns:
        {"reply": str, "task_id": str|None, "tool_summary": str|None}
    """
    from llm import client as llm

    loop_messages = list(messages)
    task_id = None
    tool_name = None
    tool_summary = None

    for _ in range(MAX_AGENT_ROUNDS):
        content, tool_calls = llm.chat_with_tools(
            loop_messages, tools=TOOLS, system=SYSTEM_PROMPT, temperature=0.3)
        if not tool_calls:
            return {
                "reply": (content or "").strip(),
                "task_id": task_id,
                "tool_name": tool_name,
                "tool_summary": tool_summary,
            }
        # 1) 追加 assistant 消息（含 tool_calls 结构，tool 消息必须跟在其后）
        loop_messages.append({
            "role": "assistant",
            "content": content or None,
            "tool_calls": [
                {
                    "id": tc.get("id") or f"call_{i}",
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": json.dumps(tc.get("arguments") or {}, ensure_ascii=False),
                    },
                }
                for i, tc in enumerate(tool_calls)
            ],
        })
        # 2) 执行工具并回传结果
        for tc in tool_calls:
            result = execute_tool(tc["name"], tc.get("arguments") or {}, conv, user)
            # 异步工具（full_search / deep_research）记录 task_id + 工具类型（前端据此选轮询路径）
            if tc["name"] in ("full_search", "deep_research"):
                tid = result.get("task_id") or result.get("thread_id")
                if tid:
                    task_id = tid
                    tool_name = tc["name"]
            if tc["name"] != "full_search":
                tool_summary = result.get("message", "")
            loop_messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id") or "",
                "content": json.dumps(result, ensure_ascii=False),
            })

    # 超出轮数兜底
    return {
        "reply": "好的，已处理。有什么想继续深入的吗？",
        "task_id": task_id, "tool_name": tool_name, "tool_summary": tool_summary,
    }
