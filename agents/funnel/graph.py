"""
漏斗编排 Graph —— 基于 LangGraph 的四阶段多智能体工作流

状态图结构：
    ┌──────────┐    ┌─────────┐    ┌──────────────┐    ┌─────────────┐
    │  intent  │───→│  trunk  │───→│  skeleton    │───→│    probe    │───→ END
    │ (意图解析) │    │ (主干)   │    │ (骨架收敛)    │    │ (探针推导)   │
    └──────────┘    └─────────┘    └──────────────┘    └─────────────┘
         │               │               │                   │
     [interrupt]     [interrupt]     [interrupt]         [interrupt]
     信息不足时       step模式        step模式            step模式

四阶段职责：
1. intent：从自然语言中提取研究方向、技术探针等结构化参数
2. trunk：主干检索（复用 TrunkSearchEngine）
3. skeleton：骨架收敛（规则 + LLM 推荐 20 篇核心论文）
4. probe：探针推导（从骨架论文中分析方法论，推导技术探针）

使用方式：
    from agents.funnel.graph import run_funnel, resume_funnel

    # 自然语言启动（自动提取意图）
    result = run_funnel(
        project_id=1,
        user_input="我想研究图像修复中用了最小二乘法的论文",
        mode="step",
    )

    # 用户确认后恢复
    result = resume_funnel(thread_id=result["thread_id"], user_input={...})
"""
from __future__ import annotations
import uuid
from typing import Optional

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from agents.funnel.state import (
    FunnelState,
    STAGE_TRUNK,
    STAGE_SKELETON,
    STAGE_PROBE,
    STAGE_DONE,
    create_initial_state,
)
from agents.funnel.intent_agent import parse_intent
from agents.funnel.skeleton_agent import recommend_skeleton
from agents.funnel.probe_agent import derive_probes
from agents.funnel.tools import logger, paper_to_dict


# ══════════════════════════════════════════════════════════
#  Agent 节点
# ══════════════════════════════════════════════════════════

def intent_node(state: FunnelState) -> dict:
    """
    阶段零：意图解析 Agent

    从用户的自然语言输入中提取结构化参数：
    - user_query：研究方向（英文）
    - tech_probe：技术探针
    - methodology：方法论偏好
    - paper_type：论文类型偏好
    - year_from/year_to：年份范围

    如果信息不足（all_complete=false），中断并返回追问。
    """
    logger.info(f"[漏斗] 意图解析: input={state['user_query'][:80]}")

    result = parse_intent(user_input=state["user_query"])

    logger.info(
        f"[漏斗] 意图解析完成: "
        f"query={result.user_query} | "
        f"probe={result.tech_probe} | "
        f"complete={result.all_complete} | "
        f"confidence={result.confidence}"
    )

    # 将解析结果写入状态（包括检索参数）
    updates = {
        "user_query": result.user_query or state["user_query"],
        "tech_probe": result.tech_probe or state.get("tech_probe", ""),
        # 检索参数：从意图解析中提取，供 trunk_node 使用
        "methodology": result.methodology or "general",
        "paper_type": result.paper_type or "all",
        "year_from": result.year_from,
        "year_to": result.year_to,
        "stage_status": "running",
        "progress": {
            **state.get("progress", {}),
            "intent": {
                "status": "done",
                "original_input": state["user_query"],
                "parsed_query": result.user_query,
                "parsed_probe": result.tech_probe,
                "methodology": result.methodology,
                "paper_type": result.paper_type,
                "year_from": result.year_from,
                "year_to": result.year_to,
                "confidence": result.confidence,
                "reasoning": result.reasoning,
                "all_complete": result.all_complete,
                "next_question": result.next_question,
            },
        },
    }

    # 如果信息不足，标记需要中断
    if not result.all_complete:
        updates["stage_status"] = "waiting_confirm"
        updates["current_stage"] = "intent"

    return updates


def trunk_node(state: FunnelState) -> dict:
    """
    阶段一：主干检索 Agent

    复用现有 TrunkSearchEngine，执行五步检索流水线。
    输出：trunk_results（论文列表）、trunk_intent（拆解意图）、trunk_trace（耗时）
    """
    from retrieval.pipeline import TrunkSearchEngine

    logger.info(
        f"[漏斗] 阶段一启动: 主干检索 | "
        f"query={state['user_query']} | "
        f"methodology={state.get('methodology', 'general')} | "
        f"paper_type={state.get('paper_type', 'all')} | "
        f"year={state.get('year_from')}-{state.get('year_to')}"
    )

    engine = TrunkSearchEngine()

    # 从状态中读取意图解析提取的检索参数
    year_from = state.get("year_from")
    year_to = state.get("year_to")
    paper_type = state.get("paper_type", "all")

    # 如果用户指定了只看综述，调整 top_k（综述通常较少）
    top_k = 50 if paper_type == "survey" else 100

    result = engine.search(
        project_id=state["project_id"],
        user_query=state["user_query"],
        tech_probe=state.get("tech_probe", ""),
        year_from=year_from,
        year_to=year_to,
        top_k=top_k,
    )

    # 将检索到的论文转为 dict 列表（从 DB 加载已入库的论文）
    from storage.mysql_db import get_session
    from storage.models import Paper

    with get_session() as session:
        rows = (
            session.query(Paper)
            .filter_by(project_id=state["project_id"], stage="trunk")
            .order_by(Paper.trunk_score.desc().nullslast())
            .all()
        )
        trunk_results = [paper_to_dict(r) for r in rows]

    survey_count = sum(1 for p in trunk_results if p.get("is_survey"))

    logger.info(
        f"[漏斗] 主干检索完成: {len(trunk_results)} 篇 | "
        f"综述 {survey_count} 篇 | "
        f"耗时 {result.get('trace', {}).get('timing', {}).get('total', '?')}s"
    )

    return {
        "trunk_intent": {
            "queries": result.get("expanded_queries", []),
            "reasoning": result.get("reasoning", ""),
        },
        "trunk_results": trunk_results,
        "trunk_trace": result.get("trace", {}),
        "trunk_survey_count": survey_count,
        "current_stage": STAGE_SKELETON,
        "stage_status": "running",
        "progress": {
            **state.get("progress", {}),
            STAGE_TRUNK: {
                "status": "done",
                "total_found": result.get("total_found", 0),
                "after_rerank": result.get("after_rerank", 0),
                "new_saved": result.get("new_saved", 0),
                "survey_count": survey_count,
            },
        },
    }


def skeleton_node(state: FunnelState) -> dict:
    """
    阶段二：骨架收敛 Agent

    从主干检索结果中推荐 20 篇骨架论文。
    输出：skeleton_recommendations（推荐列表）
    """
    logger.info(f"[漏斗] 阶段二启动: 骨架收敛 | {len(state.get('trunk_results', []))} 篇候选")

    recommendations = recommend_skeleton(
        papers=state.get("trunk_results", []),
        max_total=20,
    )

    logger.info(f"[漏斗] 骨架收敛完成: {len(recommendations)} 篇推荐")

    # 如果是 auto 模式，自动将所有推荐标记为 accept
    if state.get("mode") == "auto":
        for rec in recommendations:
            rec["user_decision"] = "accept"

    return {
        "skeleton_recommendations": recommendations,
        "current_stage": STAGE_PROBE,
        "stage_status": "waiting_confirm" if state.get("mode") == "step" else "running",
        "progress": {
            **state.get("progress", {}),
            STAGE_SKELETON: {
                "status": "done",
                "recommended": len(recommendations),
                "by_category": {
                    cat: sum(1 for r in recommendations if r["suggested_category"] == cat)
                    for cat in ["foundation", "mainstream", "frontier"]
                },
            },
        },
    }


def probe_node(state: FunnelState) -> dict:
    """
    阶段三：探针推导 Agent

    从骨架论文中分析方法论，推导技术探针。
    输出：derived_probes（探针列表）
    """
    logger.info("[漏斗] 阶段三启动: 探针推导")

    # 获取骨架论文（用户确认的，或 auto 模式下全部推荐的）
    recommendations = state.get("skeleton_recommendations", [])

    # 筛选已确认的论文
    if state.get("mode") == "step":
        confirmed_ids = set(state.get("skeleton_confirmed", []))
        skeleton_papers = [
            _rec_to_paper_dict(r) for r in recommendations
            if r["paper_id"] in confirmed_ids
        ]
    else:
        skeleton_papers = [_rec_to_paper_dict(r) for r in recommendations]

    if not skeleton_papers:
        logger.warning("[漏斗] 骨架为空，跳过探针推导")
        return {
            "derived_probes": [],
            "current_stage": STAGE_DONE,
            "stage_status": "done",
        }

    derived = derive_probes(
        skeleton_papers=skeleton_papers,
        user_query=state.get("user_query", ""),
        max_probes=5,
    )

    logger.info(f"[漏斗] 探针推导完成: {len(derived)} 个探针")

    return {
        "derived_probes": derived,
        "current_stage": STAGE_DONE,
        "stage_status": "waiting_confirm" if state.get("mode") == "step" else "done",
        "progress": {
            **state.get("progress", {}),
            STAGE_PROBE: {
                "status": "done",
                "probes_count": len(derived),
                "top_probe": derived[0]["probe"] if derived else "",
            },
        },
    }


def _rec_to_paper_dict(rec: dict) -> dict:
    """将 SkeletonRecommendation 转为 probe_agent 需要的 paper dict"""
    return {
        "paper_id": rec.get("paper_id"),
        "title": rec.get("title", ""),
        "year": rec.get("year", 0),
        "cited_by_count": rec.get("cited_by_count", 0),
        "venue": rec.get("venue", ""),
        "abstract": rec.get("abstract", ""),
    }


# ══════════════════════════════════════════════════════════
#  条件路由
# ══════════════════════════════════════════════════════════

def route_after_intent(state: FunnelState) -> str:
    """
    意图解析后的路由：
    - 信息不足 → 中断，让用户补充信息
    - 信息充足 → 进入主干检索
    """
    progress = state.get("progress", {})
    intent_info = progress.get("intent", {})

    if not intent_info.get("all_complete", True):
        # 信息不足，中断等待用户补充
        return "interrupt"

    # 信息充足，进入主干检索
    return "trunk"


def route_after_trunk(state: FunnelState) -> str:
    """主干检索后的路由：step 模式中断确认"""
    if state.get("mode") == "step":
        return "interrupt"
    return "skeleton"


def route_after_skeleton(state: FunnelState) -> str:
    """骨架收敛后的路由：step 模式中断确认"""
    if state.get("mode") == "step":
        return "interrupt"
    return "probe"


def route_after_probe(state: FunnelState) -> str:
    """探针推导后的路由：step 模式中断确认"""
    if state.get("mode") == "step":
        return "interrupt"
    return END


# ══════════════════════════════════════════════════════════
#  构建 LangGraph
# ══════════════════════════════════════════════════════════

def build_funnel_graph() -> StateGraph:
    """
    构建漏斗编排的 LangGraph 状态图。

    节点：intent → trunk → skeleton → probe
    边：每个节点后有条件路由
    """
    graph = StateGraph(FunnelState)

    # 注册四个节点
    graph.add_node("intent", intent_node)
    graph.add_node("trunk", trunk_node)
    graph.add_node("skeleton", skeleton_node)
    graph.add_node("probe", probe_node)

    # 入口：意图解析
    graph.set_entry_point("intent")

    # intent → 条件路由（信息不足时中断）
    graph.add_conditional_edges(
        "intent",
        route_after_intent,
        {
            "trunk": "trunk",
            "interrupt": END,
        },
    )

    # trunk → 条件路由（step 模式中断确认）
    graph.add_conditional_edges(
        "trunk",
        route_after_trunk,
        {
            "skeleton": "skeleton",
            "interrupt": END,
        },
    )

    # skeleton → 条件路由
    graph.add_conditional_edges(
        "skeleton",
        route_after_skeleton,
        {
            "probe": "probe",
            "interrupt": END,
        },
    )

    # probe → 条件路由
    graph.add_conditional_edges(
        "probe",
        route_after_probe,
        {
            END: END,
            "interrupt": END,
        },
    )

    return graph


# ══════════════════════════════════════════════════════════
#  公开 API
# ══════════════════════════════════════════════════════════

# 全局 checkpointer（内存存储，用于中断恢复）
_checkpointer = MemorySaver()

# 编译好的图实例（单例）
_compiled_graph = None


def _get_graph():
    """获取编译好的漏斗图（懒加载单例）"""
    global _compiled_graph
    if _compiled_graph is None:
        graph = build_funnel_graph()
        _compiled_graph = graph.compile(
            checkpointer=_checkpointer,
        )
    return _compiled_graph


def run_funnel(
    project_id: int,
    user_input: str,
    tech_probe: str = "",
    mode: str = "auto",
    methodology: str = "general",
    paper_type: str = "all",
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
) -> dict:
    """
    启动漏斗编排。

    支持两种输入方式：
    1. 自然语言：user_input="我想研究图像修复中用了最小二乘法的论文"
       → 自动经过意图解析，提取 user_query、tech_probe、methodology 等
    2. 结构化：user_input="图像修复"，tech_probe="least squares"
       → 意图解析会识别出信息已完整，直接进入主干检索

    Args:
        project_id: 项目 ID
        user_input: 用户输入（自然语言或研究方向描述）
        tech_probe: 技术探针（可选，如果用户输入中已包含则不需要）
        mode: "auto"（全自动）或 "step"（逐步确认）
        methodology: 方法论偏好（可选，如已知可直接传入）
        paper_type: 论文类型（可选：all/survey/original）
        year_from: 起始年份（可选）
        year_to: 结束年份（可选）

    Returns:
        {
            "thread_id": str,       # 线程 ID，用于 resume
            "state": FunnelState,   # 当前状态
            "interrupted": bool,    # 是否被中断
            "current_stage": str,   # 当前阶段
        }
    """
    graph = _get_graph()

    # 生成唯一的 thread_id
    thread_id = f"funnel-{project_id}-{uuid.uuid4().hex[:8]}"

    # 创建初始状态
    # user_input 作为初始的 user_query 传入，intent_node 会解析并更新
    initial_state = create_initial_state(
        project_id=project_id,
        user_query=user_input,
        tech_probe=tech_probe,
        mode=mode,
        methodology=methodology,
        paper_type=paper_type,
        year_from=year_from,
        year_to=year_to,
    )

    config = {"configurable": {"thread_id": thread_id}}

    logger.info(
        f"[漏斗] 启动: mode={mode} | input={user_input[:80]} | "
        f"project={project_id} | thread={thread_id}"
    )

    # 执行图
    final_state = None
    for event in graph.stream(initial_state, config, stream_mode="values"):
        final_state = event

    # 检查是否被中断
    snapshot = graph.get_state(config)
    interrupted = snapshot.next != ()

    result_state = dict(final_state) if final_state else dict(initial_state)

    return {
        "thread_id": thread_id,
        "state": result_state,
        "interrupted": interrupted,
        "current_stage": result_state.get("current_stage", "intent"),
    }


def resume_funnel(
    thread_id: str,
    user_input: Optional[dict] = None,
) -> dict:
    """
    恢复被中断的漏斗编排。

    支持多种中断场景的恢复：
    1. 意图解析中断（信息不足）：user_input 传 {"user_input": "补充的信息"}
    2. 骨架确认中断：user_input 传 {"skeleton_confirmed": [...], "skeleton_skipped": [...]}
    3. 探针选择中断：user_input 传 {"selected_probe": "..."}

    Args:
        thread_id: 从 run_funnel 返回的 thread_id
        user_input: 用户的确认/调整输入

    Returns:
        同 run_funnel
    """
    graph = _get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    # 获取当前状态
    snapshot = graph.get_state(config)
    if not snapshot or not snapshot.values:
        return {"error": "thread not found", "thread_id": thread_id}

    current_state = dict(snapshot.values)
    current_stage = current_state.get("current_stage", "")

    # 根据当前中断阶段，处理用户输入
    if user_input:
        # 意图解析中断：用户补充了信息
        if current_stage == "intent" and "user_input" in user_input:
            # 将用户补充的信息追加到 user_query
            original = current_state.get("user_query", "")
            supplement = user_input["user_input"]
            current_state["user_query"] = f"{original} {supplement}".strip()

        # 骨架确认中断
        if "skeleton_confirmed" in user_input:
            current_state["skeleton_confirmed"] = user_input["skeleton_confirmed"]
        if "skeleton_skipped" in user_input:
            current_state["skeleton_skipped"] = user_input["skeleton_skipped"]

        # 探针选择中断
        if "selected_probe" in user_input:
            current_state["selected_probe"] = user_input["selected_probe"]

        # 更新推荐中的用户决策
        if "skeleton_confirmed" in user_input:
            confirmed_set = set(user_input["skeleton_confirmed"])
            for rec in current_state.get("skeleton_recommendations", []):
                if rec["paper_id"] in confirmed_set:
                    rec["user_decision"] = "accept"
                else:
                    rec["user_decision"] = "skip"

    logger.info(f"[漏斗] 恢复: thread={thread_id} | stage={current_stage}")

    # 更新状态并恢复执行
    graph.update_state(config, current_state)

    # 继续执行
    final_state = None
    for event in graph.stream(None, config, stream_mode="values"):
        final_state = event

    # 检查是否再次被中断
    snapshot = graph.get_state(config)
    interrupted = snapshot.next != ()

    result_state = dict(final_state) if final_state else current_state

    return {
        "thread_id": thread_id,
        "state": result_state,
        "interrupted": interrupted,
        "current_stage": result_state.get("current_stage", STAGE_DONE),
    }


def get_funnel_state(thread_id: str) -> dict:
    """
    获取漏斗的当前状态（不恢复执行）。

    用于前端轮询进度。
    """
    graph = _get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    snapshot = graph.get_state(config)
    if not snapshot or not snapshot.values:
        return {"error": "thread not found"}

    state = dict(snapshot.values)
    return {
        "thread_id": thread_id,
        "state": state,
        "interrupted": snapshot.next != (),
        "current_stage": state.get("current_stage", ""),
        "stage_status": state.get("stage_status", ""),
        "progress": state.get("progress", {}),
    }
