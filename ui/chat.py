"""
对话式检索 —— 逐步问询 → 确认 → 自动检索
"""
import json
import streamlit as st
from datetime import datetime

from llm import client as llm
from retrieval import TrunkSearchEngine
from storage.mysql_db import get_session
from storage.models import Project
from utils.log import setup_logger

logger = setup_logger("chat")

# ── 对话阶段 ──
STAGE_GREETING = 0
STAGE_CONFIRMING = 1
STAGE_SEARCHING = 2


def init_conversation():
    if "chat_conversations" not in st.session_state:
        st.session_state.chat_conversations = []
    if "chat_active_id" not in st.session_state:
        st.session_state.chat_active_id = None
    if "_input_counter" not in st.session_state:
        st.session_state._input_counter = 0
    if "_pending_ai" not in st.session_state:
        st.session_state._pending_ai = False


def _active_conv() -> dict | None:
    for c in st.session_state.chat_conversations:
        if c["id"] == st.session_state.chat_active_id:
            return c
    return None


def get_active_project_id() -> int | None:
    conv = _active_conv()
    return conv.get("project_id") if conv else None


def get_search_summary(project_id: int) -> dict | None:
    return st.session_state.get(f"search_summary_{project_id}")


def _add_message(role: str, content: str, **kwargs):
    conv = _active_conv()
    if conv is None:
        return
    conv["messages"].append({"role": role, "content": content, **kwargs})


def new_conversation():
    conv_id = datetime.now().strftime("%Y%m%d%H%M%S")
    conv = {
        "id": conv_id,
        "title": "新对话",
        "messages": [],
        "stage": STAGE_GREETING,
        "params": {},
        "project_id": None,
    }
    st.session_state.chat_conversations.append(conv)
    st.session_state.chat_active_id = conv_id

    _add_message("assistant",
        "你好！我是 Scholar Funnel，可以帮你快速检索学术文献。\n\n"
        "**你想研究什么方向？** 随便说，比如：\n"
        "> \"风力发电预测\"\n"
        "> \"对比 Transformer 和 CNN 在图像修复中的效果\"\n"
        "> \"知识蒸馏在推荐系统中的应用\""
    )


# ═══════════════════════════════════════════
#  LLM 辅助
# ═══════════════════════════════════════════

ANALYZE_PROMPT = """\
你是一个学术检索助手。根据用户与助手的对话，做两件事：

**第一，提取已有信息：** 整理出用户已经明确告诉你的检索参数。
**第二，追问缺失信息：** 如果还有信息没问到，用自然的一句话追问。要像人一样说话，参考用户刚才的回答来问。

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
- year_from/year_to 含义：近3年=今年前3年到现在
"""


def _analyze_conversation() -> dict:
    conv = _active_conv()
    if conv is None:
        return {"params": {}, "all_complete": False, "next_question": ""}

    lines = []
    for m in conv["messages"]:
        tag = "用户" if m["role"] == "user" else "助手"
        lines.append(f"{tag}: {m['content'][:500]}")
    text = "\n".join(lines[-8:])

    try:
        raw = llm.chat_json(
            ANALYZE_PROMPT.format(conversation=text, current_year=datetime.now().year),
            temperature=0.3,
        )
        return json.loads(raw)
    except Exception as e:
        st.error(f"分析失败: {e}")
        return {"params": {}, "all_complete": False, "next_question": ""}


def _params_summary(params: dict) -> str:
    m = params.get("methodology", "general")
    method_str = "不限" if m == "general" else m
    pt = params.get("paper_type", "all")
    type_map = {"survey": "综述", "original": "原创", "all": "都看"}
    yf = params.get("year_from")
    yt = params.get("year_to")
    year_str = f"{yf} - {yt}" if yf and yt else "不限"

    lines = [
        "好的，我整理一下：",
        "",
        f"📌 **研究方向**：{params.get('user_query', '')}",
        f"🔬 **方法论**：{method_str}",
        f"📅 **年份**：{year_str}",
        f"📑 **类型**：{type_map.get(pt, '不限')}",
    ]
    if params.get("tech_probe"):
        lines.append(f"📍 **技术探针**：{params['tech_probe']}")
    lines.extend(["", "说 **开始** 我就去检索，或者继续告诉我需要改什么。"])
    return "\n".join(lines)


# ═══════════════════════════════════════════
#  检索执行
# ═══════════════════════════════════════════

def execute_search(params: dict):
    conv = _active_conv()
    if conv is None:
        return

    with get_session() as session:
        p = Project(
            name=params.get("user_query", "对话检索")[:80],
            user_query=params.get("user_query", ""),
            tech_probe=params.get("tech_probe", ""),
        )
        session.add(p)
        session.flush()
        project_id = p.id
    conv["project_id"] = project_id

    try:
        with st.status("🔍 正在检索...", expanded=True) as status:
            status.write("📡 LLM 拆解研究意图...")
            engine = TrunkSearchEngine()
            result = engine.search(
                project_id=project_id,
                user_query=params.get("user_query", ""),
                tech_probe=params.get("tech_probe", ""),
                year_from=params.get("year_from"),
                year_to=params.get("year_to"),
                score_threshold=0.0,
                top_k=100,
            )
            status.update(label="✅ 检索完成", state="complete")

        conv["title"] = params.get("user_query", "新对话")[:30]
        total = result.get("new_saved", 0)
        survey = result.get("survey_count", 0)
        trace = result.get("trace", {})
        timing = trace.get("timing", {})
        queries = result.get("expanded_queries", [])

        st.session_state[f"search_summary_{project_id}"] = {
            "total": total,
            "survey": survey,
            "timing": timing,
            "queries": queries,
        }

        conv["stage"] = STAGE_GREETING

    except Exception as e:
        _add_message("assistant", f"❌ 检索失败：{str(e)}")
        conv["stage"] = STAGE_CONFIRMING


# ═══════════════════════════════════════════
#  UI 渲染
# ═══════════════════════════════════════════

def render_sidebar():
    init_conversation()
    st.sidebar.title("💬 Scholar Funnel")
    st.sidebar.caption("对话式文献检索")

    if st.sidebar.button("➕ 新对话", use_container_width=True, type="primary"):
        new_conversation()
        st.rerun()

    st.sidebar.divider()
    st.sidebar.subheader("📋 对话历史")

    for conv in reversed(st.session_state.chat_conversations):
        title = conv.get("title", "新对话")
        active = conv["id"] == st.session_state.chat_active_id
        label = f"👉 {title}" if active else f"💬 {title}"
        if st.sidebar.button(label, key=f"cv_{conv['id']}",
                             use_container_width=True, disabled=active):
            st.session_state.chat_active_id = conv["id"]
            st.rerun()


def render_chat():
    """
    严格三步执行，确保交互顺序：

    Run 1: 用户点击发送 → 添加用户消息 → 标记 _pending_ai=True → rerun
    Run 2: 渲染消息列表（用户消息先显示在右边）→ 检测到 _pending_ai →
           显示 assistant spinner → 执行 LLM → 添加 AI 消息 → 清除标记 → rerun
    Run 3: 渲染完整消息列表（用户 + AI）→ 显示空输入框
    """
    init_conversation()
    conv = _active_conv()

    if conv is None:
        new_conversation()
        st.rerun()
        return

    # ═══════════════════════════════════════
    #  阶段 1：处理用户提交（只添加消息，不调用 AI）
    # ═══════════════════════════════════════
    submitted_text = st.session_state.get("_submitted_text")
    if submitted_text:
        st.session_state["_submitted_text"] = None
        _add_message("user", submitted_text)
        st.session_state["_pending_ai"] = True
        st.session_state["_last_user_text"] = submitted_text
        st.rerun()
        return

    # ═══════════════════════════════════════
    #  阶段 2：渲染所有消息（用户消息优先显示）
    # ═══════════════════════════════════════
    for msg in conv["messages"]:
        avatar = "🧑" if msg["role"] == "user" else "🔍"
        with st.chat_message(msg["role"], avatar=avatar):
            st.markdown(msg["content"])

    # ═══════════════════════════════════════
    #  阶段 3：处理 AI 回复（必须在消息渲染之后）
    # ═══════════════════════════════════════
    if st.session_state.get("_pending_ai") and conv["stage"] != STAGE_SEARCHING:
        text = st.session_state.get("_last_user_text", "")

        # 检查是否是确认后的搜索指令（避免 spinner 嵌套 st.status）
        if conv["stage"] == STAGE_CONFIRMING:
            if any(kw in text for kw in ("开始", "确认", "好的", "可以", "行", "嗯", "是")):
                params = conv.get("params", {})
                if params.get("user_query"):
                    st.session_state["_pending_ai"] = False
                    st.session_state["_last_user_text"] = None
                    execute_search(params)
                    st.rerun()
                    return

        # 显示 AI 思考状态，在 spinner 内执行 LLM
        with st.chat_message("assistant", avatar="🔍"):
            with st.spinner("正在理解你的需求..."):
                analysis = _analyze_conversation()
                params = analysis.get("params", {})

                if not params.get("user_query"):
                    reply = "你想研究什么方向？能再说具体一些吗？"
                    conv["stage"] = STAGE_GREETING
                elif analysis.get("all_complete"):
                    conv["params"] = params
                    conv["stage"] = STAGE_CONFIRMING
                    reply = _params_summary(params)
                else:
                    reply = analysis.get("next_question", "能再说详细一些吗？")
                    conv["stage"] = STAGE_GREETING

                _add_message("assistant", reply)

        st.session_state["_pending_ai"] = False
        st.session_state["_last_user_text"] = None
        st.rerun()
        return

    # ═══════════════════════════════════════
    #  阶段 4：渲染输入框（key 动态变化强制清空）
    # ═══════════════════════════════════════
    if conv["stage"] != STAGE_SEARCHING:
        placeholder = "继续说..." if conv["stage"] != STAGE_GREETING else "告诉我你想研究什么..."
        input_key = f"chat_input_{st.session_state._input_counter}"

        with st.form("chat_input_form", border=False):
            cols = st.columns([6, 1])
            with cols[0]:
                prompt = st.text_input(
                    "消息",
                    placeholder=placeholder,
                    label_visibility="collapsed",
                    key=input_key,
                )
            with cols[1]:
                sent = st.form_submit_button("发送", use_container_width=True)

        if sent and prompt and prompt.strip():
            st.session_state["_submitted_text"] = prompt.strip()
            st.session_state._input_counter += 1
            st.rerun()