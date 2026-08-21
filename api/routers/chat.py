"""
Chat API - ask → confirm → search (background)
"""
import json
import uuid
import threading
from datetime import datetime
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException

from api.schemas import ChatMessage, ChatRequest, ChatResponse
from llm import client as llm
from retrieval.pipeline import TrunkSearchEngine
from storage.mysql_db import get_session
from storage.models import Project

router = APIRouter()

# ── Memory stores ──

@dataclass
class ConversationState:
    id: str
    title: str = "new"
    messages: list[dict] = field(default_factory=list)
    stage: str = "greeting"
    params: dict = field(default_factory=dict)
    project_id: int | None = None

_conversations: dict[str, ConversationState] = {}
_search_tasks: dict[str, dict] = {}

def _get_conv(conv_id: str) -> ConversationState:
    if conv_id not in _conversations:
        _conversations[conv_id] = ConversationState(id=conv_id)
    return _conversations[conv_id]

ANALYZE_PROMPT = """\
你是一个学术检索助手。根据用户与助手的对话，做两件事：

**第一，提取已有信息：** 整理出用户已经明确告诉你的检索参数。
**第二，追问缺失信息：** 如果还有信息没问到，用自然的一句话追问。

你需要收集 4 样信息：
1. 研究方向（必须）
2. 方法论偏好
3. 年份范围
4. 论文类型

当前对话：
{conversation}

输出 JSON：
{{
  "params": {{
    "user_query": "研究方向描述",
    "tech_probe": "技术探针（没有就""）",
    "methodology": "方法论（"general"表示不限）",
    "paper_type": "论文类型（"survey"综述 / "original"原创 / "all"不限）",
    "year_from": 起始年份（没提就null）,
    "year_to": 结束年份（没提就null，当前{current_year}）
  }},
  "all_complete": true 或 false,
  "next_question": "自然语言追问（all_complete=true 时填空字符串）"
}}

规则：
- all_complete=true：当研究方向、方法论、年份、论文类型都有明确值时
- next_question：all_complete=false 时，用自然口语问最需要的那一个信息
"""


@router.post("/message", response_model=ChatResponse)
def send_message(body: ChatRequest):
    # 若前端携带自定义 LLM 配置（api_key / base_url / model），先应用
    if body.llm_config:
        try:
            llm.configure(
                api_key=body.llm_config.get("api_key"),
                base_url=body.llm_config.get("base_url"),
                model=body.llm_config.get("model"),
            )
        except Exception:
            # 配置失败不阻塞对话，仍使用默认配置
            pass

    conv = _get_conv(body.conversation_id)
    conv.messages.append({"role": "user", "content": body.message})

    lines = []
    for m in conv.messages[-8:]:
        tag = "user" if m["role"] == "user" else "assistant"
        lines.append(f"{tag}: {m['content'][:500]}")
    text = "\n".join(lines)

    if conv.stage == "confirming":
        keywords = ("start", "confirm", "ok", "begin", "yes", "go",
                    "开始", "确认", "好的", "可以", "行", "嗯", "是")
        if any(kw in body.message for kw in keywords):
            if conv.params.get("user_query"):
                conv.stage = "searching"
                return ChatResponse(
                    conversation_id=conv.id, reply="", stage="searching",
                    params=conv.params)

    try:
        raw = llm.chat_json(
            ANALYZE_PROMPT.format(conversation=text, current_year=datetime.now().year),
            temperature=0.3)
        analysis = json.loads(raw)
    except Exception as e:
        reply = f"sorry, cannot parse: {e}"
        conv.messages.append({"role": "assistant", "content": reply})
        return ChatResponse(conversation_id=conv.id, reply=reply, stage=conv.stage)

    params = analysis.get("params", {})
    if not params.get("user_query"):
        conv.stage = "greeting"
        reply = "你想研究什么方向？能再说具体一些吗？"
    elif analysis.get("all_complete"):
        conv.params = params
        conv.stage = "confirming"
        reply = _format_params_summary(params)
    else:
        conv.stage = "greeting"
        reply = analysis.get("next_question", "能再说详细一些吗？")

    conv.messages.append({"role": "assistant", "content": reply})
    return ChatResponse(
        conversation_id=conv.id, reply=reply, stage=conv.stage,
        params=conv.params if conv.stage == "confirming" else {})


# ── Background search ──

def _run_search(task_id: str, conv_id: str, params: dict):
    task = _search_tasks[task_id]
    conv = _get_conv(conv_id)
    try:
        task["detail"] = "creating project..."
        with get_session() as session:
            p = Project(
                name=params.get("user_query", "chat")[:80],
                user_query=params.get("user_query", ""),
                tech_probe=params.get("tech_probe", ""))
            session.add(p)
            session.flush()
            project_id = p.id
        conv.project_id = project_id

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

        conv.stage = "greeting"
        conv.title = params.get("user_query", "new")[:30]
        task["result"] = {"ok": True, "project_id": project_id, "result": result}
        task["status"] = "done"
    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)


@router.post("/search/start")
def start_chat_search(body: dict):
    conv_id = body.get("conversation_id", "")
    conv = _get_conv(conv_id)
    params = body.get("params") or conv.params
    if not params.get("user_query"):
        raise HTTPException(400, "missing user_query")

    task_id = uuid.uuid4().hex[:12]
    _search_tasks[task_id] = {
        "status": "running", "detail": "", "result": None, "error": None}
    threading.Thread(
        target=_run_search, args=(task_id, conv_id, params), daemon=True).start()
    return {"task_id": task_id}


@router.get("/search/status")
def get_search_status(task_id: str):
    task = _search_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    return {"status": task["status"], "detail": task["detail"], "error": task["error"]}


@router.get("/search/result")
def get_search_result(task_id: str):
    task = _search_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    if task["status"] == "running":
        raise HTTPException(202, "still running")
    if task["status"] == "error":
        raise HTTPException(500, task["error"])
    return task["result"]


@router.get("/history")
def get_history(conversation_id: str):
    conv = _get_conv(conversation_id)
    return {
        "conversation_id": conv.id, "messages": conv.messages,
        "stage": conv.stage, "params": conv.params,
        "project_id": conv.project_id, "title": conv.title}


def _format_params_summary(params: dict) -> str:
    m = params.get("methodology", "general")
    method_str = "不限" if m == "general" else m
    pt = params.get("paper_type", "all")
    type_map = {"survey": "综述", "original": "原创", "all": "都看"}
    yf = params.get("year_from")
    yt = params.get("year_to")
    year_str = f"{yf} - {yt}" if yf and yt else "不限"
    lines = [
        "好的，我整理一下：", "",
        f"研究方向：{params.get('user_query', '')}",
        f"方法论：{method_str}",
        f"年份：{year_str}",
        f"类型：{type_map.get(pt, '不限')}"]
    if params.get("tech_probe"):
        lines.append(f"技术探针：{params['tech_probe']}")
    lines.extend(["", '说"开始"我就去检索，或者继续告诉我需要改什么。'])
    return "\n".join(lines)
