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
import time
import uuid
from datetime import datetime

from storage.mysql_db import get_session
from storage.models import Conversation, User
from prompt.chat_agent import SYSTEM_PROMPT
from utils.log import setup_logger

logger = setup_logger("chat_agent")
# 回答分层路由日志（L0/L1/L2 推断，供误升监控抽检；复用 DbLogHandler 落 sys_app_logs）
_routing_logger = setup_logger("chat.routing")

# ── 工具注册表（OpenAI function calling schema）──

TOOL_FULL_SEARCH = {
    "type": "function",
    "function": {
        "name": "full_search",
        "description": (
            "执行文献检索（意图拆解→召回→重排→入库）。"
            "触发场景：① 用户明确要'检索/搜一下/查文献/找论文'且研究方向已明确（生成新项目）；"
            "② 用户对已有方向说'重新检索/再搜一次/换个关键词再搜/重新跑一遍'——re_search=true，"
            "复用该子研究重跑（不新建项目，由 Retrieval Planner 自动选择增量/过滤/全量模式）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_query": {"type": "string", "description": "研究方向描述（必填）"},
                "tech_probe": {"type": "string", "description": "技术探针关键词，如 Transformer"},
                "year_from": {"type": "integer", "description": "起始年份"},
                "year_to": {"type": "integer", "description": "结束年份"},
                "paper_type": {"type": "string", "enum": ["all", "survey", "original"], "description": "论文类型"},
                "methodology": {"type": "string", "description": "方法论偏好（如 diffusion）"},
                "re_search": {"type": "boolean", "description": "是否对已有子研究重新检索（用户说'重新检索/再搜一次/换限定'时 true，复用当前子研究而非新建）"},
                "target_project_id": {"type": "integer", "description": "re_search=true 时目标子研究 id（从对话上下文/消息卡 project_id 判断；缺省用会话当前子研究）"},
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

TOOL_JUDGMENT = {
    "type": "function",
    "function": {
        "name": "record_paper_judgment",
        "description": (
            "记录用户对某篇论文的研究判断（对话式修正，判断会沉淀并在后续检索生效）："
            "exclude=这篇不对/不相关（后续检索不再返回，可逆）；uncertain=先存疑；"
            "adopt=采纳并加入骨架（用户指定分类或用系统建议分类）；none=撤销之前的判断（恢复）。"
            "当用户在对话中对具体论文给出评价、修正、排除、说'这篇不对/不相关/先存疑/加入骨架'等指令时调用。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["adopt", "exclude", "uncertain", "none"], "description": "判断动作"},
                "paper_ref": {"type": "string", "description": "论文标识：标题片段或数字 ID（来自检索结果/对话上下文）"},
                "reason": {"type": "string", "description": "用户给出的理由（可空）"},
                "category": {"type": "string", "enum": ["foundation", "mainstream", "frontier"], "description": "仅 adopt 需要：骨架分类，缺省由系统按规则/AI 建议"},
            },
            "required": ["action", "paper_ref"],
        },
    },
}

TOOL_ANSWER_WITH_SOURCES = {
    "type": "function",
    "function": {
        "name": "answer_with_sources",
        "description": (
            "轻量带证据回答：检索 3-8 条与问题相关的文献来源（优先当前项目库内，其次 OpenAlex），"
            "不建研究空间、不入库。当问题需要具体文献支撑（谁提出的/最早出处/方法归属/事实来源）"
            "且用户未要求系统性检索时调用。拿到来源后，在下一条回复中组织答案并逐条编号引用，"
            "来源给不到的细节不要编造。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "需要文献支撑的问题或检索词（必填）"},
            },
            "required": ["query"],
        },
    },
}

TOOLS = [
    TOOL_FULL_SEARCH, TOOL_LOCAL_SEARCH, TOOL_GAP_SEARCH, TOOL_SKELETON_STATUS,
    TOOL_DEEP_RESEARCH, TOOL_JUDGMENT, TOOL_ANSWER_WITH_SOURCES,
]

# Agent 循环最大轮数（防死循环）
MAX_AGENT_ROUNDS = 4


# ── 后台检索任务（full_search 异步） ──
_search_tasks: dict[str, dict] = {}
_TASK_TTL = 3600  # 完成的任务 1h 后清理（防内存驻留）

# 会话级检索防重（P1 并发地基）：同一会话同时只允许一个 full_search 在跑（防用户连点双开）
_conv_busy: set[str] = set()
_conv_busy_lock = threading.Lock()


def _try_acquire_conv(conv_id: str) -> bool:
    with _conv_busy_lock:
        if conv_id in _conv_busy:
            return False
        _conv_busy.add(conv_id)
        return True


def _release_conv(conv_id: str) -> None:
    with _conv_busy_lock:
        _conv_busy.discard(conv_id)


def _cleanup_stale_tasks() -> None:
    """惰性清理：删除完成/失败超过 TTL 的任务（get/start 时触发）"""
    now = time.time()
    stale = [
        tid for tid, t in _search_tasks.items()
        if t.get("status") != "running"
        and (now - t.get("_done_at", now)) > _TASK_TTL
    ]
    for tid in stale:
        _search_tasks.pop(tid, None)


def _run_full_search(task_id: str, conv_id: str, params: dict, user_id: int):
    """后台执行检索（复用 TrunkSearchEngine + Retrieval Planner）。

    - 新建场景（默认）：创建新 Project 并关联会话
    - 重检索场景（re_search=true）：复用目标子研究（target_project_id 或会话当前 project），
      由 Planner 决策模式（incremental/local_filter/hybrid/full）
    - 0 召回（新建场景）：不追加 project_ids（不产生无意义空子研究），对话端提示
    """
    task = _search_tasks[task_id]
    re_search = bool(params.get("re_search"))
    target_pid = params.get("target_project_id")
    try:
        from retrieval.pipeline import TrunkSearchEngine
        from retrieval.planner import Constraints, constraint_diff, coverage_check, plan
        from storage.models import Project
        from storage.search_runs import recent_runs

        user_query = params.get("user_query", "")
        tech_probe = params.get("tech_probe", "")
        year_from = params.get("year_from")
        year_to = params.get("year_to")
        methodology = params.get("methodology") or ""
        paper_type = params.get("paper_type") or ""

        # ── 1. 确定 project_id（新建 or 复用）──
        with get_session() as session:
            conv = (
                session.query(Conversation)
                .filter(Conversation.uuid == conv_id, Conversation.user_id == user_id)
                .first()
            )
            if re_search and target_pid:
                p = session.get(Project, target_pid)
                if not p or p.user_id != user_id:
                    raise RuntimeError("目标子研究不存在或无权访问")
                project_id = p.id
            elif re_search and conv and conv.project_id:
                project_id = conv.project_id
            else:
                p = Project(
                    name=user_query[:80],
                    user_query=user_query,
                    tech_probe=tech_probe,
                    user_id=user_id,
                )
                session.add(p)
                session.flush()
                project_id = p.id
            if conv:
                ids = list(conv.project_ids or [])
                if project_id not in ids:
                    ids.append(project_id)
                conv.project_ids = ids
                conv.project_id = project_id
                conv.title = user_query[:30]
                session.commit()

        # ── 2. Retrieval Planner：约束差异 → 模式决策 ──
        prev_run = None
        runs = recent_runs(project_id, 1)
        if runs:
            prev_run = runs[0]
        new_c = Constraints(
            user_query=user_query, tech_probe=tech_probe,
            year_from=year_from, year_to=year_to,
            methodology=methodology or None, paper_type=paper_type or None,
        )
        mode = "full"
        plan_reason = "首次检索，全量召回建立研究池"
        pool_from = pool_to = None
        recall_from, recall_to = year_from, year_to
        try:
            if prev_run:
                prev_c = Constraints.from_run(prev_run)
                diff = constraint_diff(prev_c, new_c)
                cov = coverage_check(project_id, new_c, top_k=params.get("top_k", 100))
                p = plan(diff, cov, top_k=params.get("top_k", 100), prev_exists=True)
                mode, plan_reason = p.mode, p.reason
                if p.mode == "incremental":
                    # 新增段 = 新窗口与 prev 窗口的差集；池合并窗口 = 新完整窗口
                    pf = prev_c.year_from or 0
                    pt = prev_c.year_to or 9999
                    nf = new_c.year_from or 0
                    nt = new_c.year_to or 9999
                    if nf < pf and nt <= pt:
                        recall_from, recall_to = nf, (pf - 1) or None
                    elif nt > pt and nf >= pf:
                        recall_from, recall_to = (pt + 1) if pt < 9999 else None, nt
                    else:  # 双侧放宽（罕见）：全窗口召回
                        recall_from, recall_to = new_c.year_from, new_c.year_to
                    pool_from, pool_to = new_c.year_from, new_c.year_to
                task["mode"] = mode
                task["plan_reason"] = plan_reason
        except Exception as e:
            logger.warning(f"Planner 决策失败，回退 full: {e}")
            mode, plan_reason = "full", "Planner 异常，回退全量"

        # ── 3. 执行检索 ──
        task["detail"] = "searching..."
        engine = TrunkSearchEngine()
        result = engine.search(
            project_id=project_id,
            user_query=user_query,
            tech_probe=tech_probe,
            year_from=recall_from,
            year_to=recall_to,
            score_threshold=params.get("score_threshold", 0.0),
            top_k=params.get("top_k", 100),
            mode=mode,
            pool_window_from=pool_from,
            pool_window_to=pool_to,
            methodology=methodology or None,
            plan_reason=plan_reason,
        )

        # ── 4. 0 召回（新建场景）：移除 project_ids 关联，不产生空子研究 ──
        if result.get("total_found", 0) == 0 and not re_search:
            with get_session() as session:
                conv = (
                    session.query(Conversation)
                    .filter(Conversation.uuid == conv_id, Conversation.user_id == user_id)
                    .first()
                )
                if conv:
                    ids = list(conv.project_ids or [])
                    if project_id in ids:
                        ids.remove(project_id)
                    conv.project_ids = ids
                    if conv.project_id == project_id:
                        conv.project_id = ids[-1] if ids else None
                    session.commit()
            logger.info(f"检索 0 召回，子研究 {project_id} 未关联会话（工作台不显示空子研究）")

        task["result"] = {
            "ok": True, "project_id": project_id,
            "project_name": user_query[:80],
            "run_id": result.get("run_id"),
            "result": result,
        }
        task["status"] = "done"
    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)
    finally:
        task["_done_at"] = time.time()
        _release_conv(conv_id)


def start_full_search(conv_id: str, params: dict, user_id: int) -> dict:
    """启动后台全量检索，返回 task_id。同会话已有检索在跑 → busy（不启动，防连点双开）。"""
    _cleanup_stale_tasks()
    if not _try_acquire_conv(conv_id):
        return {"status": "busy", "message": "该会话已有检索正在进行，请等待完成后再试"}
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
    _cleanup_stale_tasks()
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
            if result.get("status") == "busy":
                # 同会话已有检索在跑（P1 并发防重）：如实告知，不假装启动
                return {"status": "busy", "message": result.get("message", "该会话已有检索正在进行，请等待完成后再试")}
            return {
                "status": result["status"],
                "task_id": result.get("task_id"),
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

        if name == "answer_with_sources":
            return _answer_with_sources(user, conv, args)

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

        if name == "record_paper_judgment":
            from storage import judgments
            from storage import cart as cart_svc

            action = args.get("action", "")
            paper_ref = args.get("paper_ref", "")
            reason = args.get("reason", "")
            category = args.get("category")
            project_id = conv.project_id
            if not project_id:
                return {"status": "error", "message": "当前会话还没有项目，先发起检索再对论文做判断"}

            paper = judgments.resolve_paper_by_ref(project_id, paper_ref)
            if not paper:
                return {
                    "status": "error",
                    "message": f"没有在当前项目的论文中找到「{paper_ref}」，请让用户提供更精确的标题或论文编号",
                }

            if action == "adopt":
                if not category:
                    suggestion = cart_svc.suggest_category(paper)
                    category = (suggestion or {}).get("category", "mainstream")
                result = cart_svc.add(project_id, paper.id, category, reason)
                if not result.get("ok"):
                    return {"status": "error", "message": f"加入骨架失败：{result.get('error')}"}

            j = judgments.set_judgment(
                project_id, paper.id, action, reason=reason or None, source="chat"
            )
            if not j.get("ok"):
                return {"status": "error", "message": j.get("error")}

            label = {
                "adopt": "已加入骨架", "exclude": "已排除", "uncertain": "已标记存疑", "none": "已撤销判断",
            }.get(action, action)
            extra = f"（分类：{category}）" if action == "adopt" and category else ""
            return {
                "status": "ok",
                "message": f"《{paper.title[:60]}》{label}{extra}。排除的论文后续检索将不再出现，随时可说'恢复'撤销。",
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


# ── L1 轻量带证据回答（answer_with_sources） ──

def _answer_with_sources(user: User, conv: Conversation, args: dict) -> dict:
    """
    轻量带证据回答（L1 层）：检索 3-8 条来源，不建研究空间、不入库。

    来源优先级：当前项目库内语义召回 → 不足或没有项目时 OpenAlex 轻量单查。
    返回 hits 供主循环第二轮组织答案并编号引用；来源给不到的细节不编造。
    """
    query = (args.get("query") or "").strip()
    if not query:
        return {"status": "error", "message": "检索词为空"}

    hits: list[dict] = []
    seen_doi: set[str] = set()
    # 自然语言推荐理由（内部分数/匹配类型不外露；模板+主题注入）
    l1_reason = f"与你问的「{query[:20]}」相关，可作为该问题的文献支撑。"

    def _push(h: dict):
        key = (h.get("doi") or h.get("title") or "").lower()
        if key and key not in seen_doi:
            seen_doi.add(key)
            hits.append(h)

    # 1) 项目库内语义召回（秒级；embedding 缺失时惰性补齐，失败则静默跳过）
    project_id = conv.project_id
    if project_id:
        try:
            from storage.vector_store import semantic_recall_papers, ensure_project_embeddings
            ensure_project_embeddings(project_id, max_embed=200)
            for p in semantic_recall_papers(
                project_id=project_id, query_text=query,
                limit=8, similarity_threshold=0.5,
            ):
                _push({
                    "openalex_id": p.get("id"),
                    "title": p["title"],
                    "year": p.get("year"),
                    "venue": p.get("venue") or "",
                    "doi": p.get("doi"),
                    "abstract": (p.get("abstract") or "")[:600],
                    "reason": l1_reason,
                    "source": "project",
                })
        except Exception as e:
            logger.warning(f"L1 库内语义召回失败，改走 OpenAlex: {e}")

    # 2) 库内不足 3 条（或无项目）→ OpenAlex 轻量单查（秒级，不入库、不形成项目资产）
    if len(hits) < 3:
        try:
            from sources import openalex as oa
            oa.set_mailto(user.email)
            works = oa.search_works(query, per_page=8)
            for w in works:
                _push({
                    "openalex_id": getattr(w, "openalex_id", None),
                    "title": w.title,
                    "year": w.year,
                    "venue": w.venue or "",
                    "doi": w.doi,
                    "abstract": (w.abstract or "")[:600],
                    "reason": l1_reason,
                    "source": "openalex",
                })
        except Exception as e:
            logger.warning(f"L1 OpenAlex 轻量单查失败: {e}")

    if not hits:
        return {"status": "error", "message": "没有找到与问题相关的文献，请尝试换一种问法或改用系统性检索"}

    return {
        "status": "ok",
        "hits": hits[:8],
        "message": f"找到 {len(hits)} 条相关文献，请基于这些来源组织回答并编号引用；来源给不到的细节不要编造。",
    }


# ── 深度调研（deep_research 异步） ──

def start_deep_research(conv: Conversation, user: User, params: dict) -> dict:
    """
    启动后台深度调研（复用 agents/funnel 的 LangGraph 工作流，auto 模式）。

    - 同步创建项目并关联会话（拿到 project_id 后生成合规 thread_id，后台只跑漏斗）
    - 写入一条"已启动"消息卡（attachments 持久化 thread_id，切页/多轮后可恢复）
    """
    from agents.funnel.graph import run_funnel
    from storage.models import Message, Project

    user_query = params.get("user_query", "")

    # 同步建项目 + 写启动卡：必须先拿到 project_id 才能生成合规 thread_id
    # （格式 funnel-{project_id}-{hex}，/funnel/state 与 finalize 的归属校验依赖内嵌 project_id）
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
        thread_id = f"funnel-{project_id}-{uuid.uuid4().hex[:8]}"
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

    def bg():
        try:
            # 后台执行漏斗（auto 模式，全自动不中断）
            run_funnel(
                project_id=project_id,
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

# 层级映射（L0-L3，2026-08-30 对齐《产品原则》§九）：
# 辅助工具（judgment/local_semantic_search/get_skeleton_status）不改变层级。
# full_search → L2 结构化认知；deep_research/gap_search → L3 深度科研（骨架/深研属项目资产操作）。
_L2_TOOLS = ("full_search",)
_L3_TOOLS = ("deep_research", "gap_search")


def _infer_level(first_round_tools: list[str]) -> str:
    """回答分层推断（L0-L3）：层级 = 首轮工具选择（处理深度，不等同于论文详情页访问权限）。"""
    if any(t in _L3_TOOLS for t in first_round_tools):
        return "L3"
    if any(t in _L2_TOOLS for t in first_round_tools):
        return "L2"
    if "answer_with_sources" in first_round_tools:
        return "L1"
    return "L0"



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
    l1_sources: list[dict] | None = None  # L1 来源卡（answer_with_sources hits，随回复落卡）
    tool_logs: list[dict] = []            # 本轮工具调用痕迹（随回复落库，供排查与历史回传）
    # 回答分层路由（L0/L1/L2）：层级 = 首轮工具选择；辅助工具不改变层级
    t0 = time.time()
    first_round_tools: list[str] = []

    def _emit_routing(level: str, reply: str) -> None:
        """routing 日志：消息级一条，供误升监控抽检（DbLogHandler 落 sys_app_logs）"""
        _routing_logger.info(
            "routing level=%s first_tools=%s conv=%s project=%s reply_len=%s latency=%.1fs",
            level,
            first_round_tools,
            getattr(conv, "uuid", ""),
            getattr(conv, "project_id", None),
            len(reply),
            time.time() - t0,
        )

    for _ in range(MAX_AGENT_ROUNDS):
        content, tool_calls = llm.chat_with_tools(
            loop_messages, tools=TOOLS, system=SYSTEM_PROMPT, temperature=0.3)
        if not tool_calls:
            reply = (content or "").strip()
            # B：启动话术强校验——声称"已启动"但本轮无异步任务（task_id 空）→ 如实告知失败
            if task_id is None and _looks_like_launched(reply):
                reply = "检索未成功启动，请重试，或再说一次「重新检索」。"
            _emit_routing(_infer_level(first_round_tools), reply)
            return {
                "reply": reply,
                "task_id": task_id,
                "tool_name": tool_name,
                "tool_summary": tool_summary,
                "l1_sources": l1_sources,
                "tool_logs": tool_logs,
            }
        if not first_round_tools:
            first_round_tools = [tc.get("name", "") for tc in tool_calls]
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
            # C：工具调用痕迹收集（落库 + 历史回传，排查可查）
            tool_logs.append(_summarize_tool(tc, result))
            # 异步工具（full_search / deep_research）记录 task_id + 工具类型（前端据此选轮询路径）
            if tc["name"] in ("full_search", "deep_research"):
                tid = result.get("task_id") or result.get("thread_id")
                if tid:
                    task_id = tid
                    tool_name = tc["name"]
            if tc["name"] != "full_search":
                tool_summary = result.get("message", "")
            # L1 来源卡：answer_with_sources 的 hits 随回复持久化（前端渲染来源列表）
            if tc["name"] == "answer_with_sources" and result.get("hits"):
                l1_sources = result["hits"]
            loop_messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id") or "",
                "content": json.dumps(result, ensure_ascii=False),
            })

    # 超出轮数兜底
    reply = "好的，已处理。有什么想继续深入的吗？"
    if task_id is None and _looks_like_launched(reply):
        reply = "检索未成功启动，请重试，或再说一次「重新检索」。"
    _emit_routing(_infer_level(first_round_tools), reply)
    return {
        "reply": reply,
        "task_id": task_id, "tool_name": tool_name, "tool_summary": tool_summary,
        "l1_sources": l1_sources,
        "tool_logs": tool_logs,
    }


def run_agent_stream(conv: Conversation, user: User, messages: list[dict]):
    """
    流式版主 Agent 循环 —— 语义等价 run_agent，差异只在产出方式：

    - 模型生成过程中的文本增量逐段 yield {"type": "text", "text": str}（SSE 转发用）
    - 结束 yield {"type": "done", ...}（reply / task_id / l1_sources 等同 run_agent 返回值）

    说明：
    - 工具轮（模型决定调用工具）通常无文本 → 本轮不产生 text 事件，界面保持等待占位；
      模型在工具轮内夹带少量文字时同样实时转发（下一轮若为终答，最终 reply 只含终轮文字，
      与 run_agent 落库语义一致）。
    - 生成中途失败抛 LLMError，由路由层转成 SSE error 事件（已流出的文字由前端保留展示）。
    """
    from llm import client as llm

    loop_messages = list(messages)
    task_id = None
    tool_name = None
    tool_summary = None
    l1_sources: list[dict] | None = None
    tool_logs: list[dict] = []
    t0 = time.time()
    first_round_tools: list[str] = []

    def _emit_routing(level: str, reply: str) -> None:
        """routing 日志：消息级一条，供误升监控抽检（DbLogHandler 落 sys_app_logs）"""
        _routing_logger.info(
            "routing level=%s first_tools=%s conv=%s project=%s reply_len=%s latency=%.1fs",
            level,
            first_round_tools,
            getattr(conv, "uuid", ""),
            getattr(conv, "project_id", None),
            len(reply),
            time.time() - t0,
        )

    def _done(reply: str):
        yield {
            "type": "done",
            "reply": reply,
            "task_id": task_id,
            "tool_name": tool_name,
            "tool_summary": tool_summary,
            "l1_sources": l1_sources,
            "tool_logs": tool_logs,
        }

    for _ in range(MAX_AGENT_ROUNDS):
        round_parts: list[str] = []
        tool_calls: list[dict] | None = None
        for ev in llm.chat_with_tools_stream(
            loop_messages, tools=TOOLS, system=SYSTEM_PROMPT, temperature=0.3,
        ):
            if ev["type"] == "text":
                round_parts.append(ev["text"])
                yield {"type": "text", "text": ev["text"]}
            else:  # {"type": "done", "content", "tool_calls"}
                tool_calls = ev["tool_calls"]
        content = "".join(round_parts)

        # 无工具调用 → 本轮即最终回复
        if not tool_calls:
            reply = (content or "").strip()
            # B：启动话术强校验——声称"已启动"但本轮无异步任务（task_id 空）→ 如实告知失败
            if task_id is None and _looks_like_launched(reply):
                reply = "检索未成功启动，请重试，或再说一次「重新检索」。"
            _emit_routing(_infer_level(first_round_tools), reply)
            yield from _done(reply)
            return

        if not first_round_tools:
            first_round_tools = [tc.get("name", "") for tc in tool_calls]
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
            # C：工具调用痕迹收集（落库 + 历史回传，排查可查）
            tool_logs.append(_summarize_tool(tc, result))
            # 异步工具（full_search / deep_research）记录 task_id + 工具类型（前端据此选轮询路径）
            if tc["name"] in ("full_search", "deep_research"):
                tid = result.get("task_id") or result.get("thread_id")
                if tid:
                    task_id = tid
                    tool_name = tc["name"]
            if tc["name"] != "full_search":
                tool_summary = result.get("message", "")
            # L1 来源卡：answer_with_sources 的 hits 随回复持久化（前端渲染来源列表）
            if tc["name"] == "answer_with_sources" and result.get("hits"):
                l1_sources = result["hits"]
            loop_messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id") or "",
                "content": json.dumps(result, ensure_ascii=False),
            })

    # 超出轮数兜底
    reply = "好的，已处理。有什么想继续深入的吗？"
    if task_id is None and _looks_like_launched(reply):
        reply = "检索未成功启动，请重试，或再说一次「重新检索」。"
    _emit_routing(_infer_level(first_round_tools), reply)
    yield from _done(reply)


# ── 工具痕迹摘要 + 启动话术识别（B/C 方案） ──

def _summarize_tool(tc: dict, result: dict) -> dict:
    """工具调用摘要（args/result 截断，供落库与历史回传）"""
    args = tc.get("arguments") or {}
    return {
        "name": tc.get("name", ""),
        "args": json.dumps(args, ensure_ascii=False)[:300],
        "result": (result.get("message") or "")[:200],
        "status": result.get("status", "ok"),
        "task_id": result.get("task_id") or result.get("thread_id") or "",
        "project_id": result.get("project_id"),
    }


def _looks_like_launched(reply: str) -> bool:
    """回复是否声称检索/调研已启动（B 方案拦截用）；排除失败/未启动语境"""
    if not reply:
        return False
    lowered = reply.lower()
    # 排除明确的失败/未启动表述
    for neg in ("未成功", "失败", "无法启动", "未能启动", "没有启动", "未启动"):
        if neg in reply:
            return False
    for kw in ("已启动", "已经启动", "启动", "已开始", "检索中", "开始检索", "启动检索", "深度调研已启动", "调研已启动"):
        if kw in lowered or kw in reply:
            return True
    return False
