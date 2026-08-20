"""
漏斗编排 Agent 的状态定义

FunnelState 贯穿整个 LangGraph 工作流，每个 Agent 节点读取并更新它。
状态分为五组：输入、主干检索、骨架收敛、探针推导、流程控制。
"""
from __future__ import annotations
from typing import TypedDict, Literal, Optional


# ── 骨架推荐结果 ──

class SkeletonRecommendation(TypedDict):
    """单篇论文的骨架推荐信息"""
    paper_id: int
    title: str
    year: int
    cited_by_count: int
    venue: str
    abstract: str
    # 推荐信息
    suggested_category: Literal["foundation", "mainstream", "frontier"]
    confidence: Literal["high", "medium", "low"]
    reason: str
    # 用户决策（初始为 None，用户确认后填入）
    user_decision: Optional[Literal["accept", "skip", "reassign"]]
    user_category: Optional[str]  # 用户修改的分类


# ── 探针推导结果 ──

class ProbeDerivation(TypedDict):
    """一个推荐的技术探针"""
    probe: str
    description: str
    coverage: int          # 能覆盖骨架中多少篇论文
    coverage_ratio: float  # 覆盖比例 0-1
    sample_papers: list[str]  # 代表论文标题（最多3篇）


# ── 阶段状态枚举 ──

StageStatus = Literal[
    "pending",           # 未开始
    "running",           # 执行中
    "waiting_confirm",   # 等待用户确认（step模式）
    "done",              # 已完成
    "error",             # 出错
]


class FunnelState(TypedDict, total=False):
    """
    漏斗编排的全局状态，贯穿整个 LangGraph 工作流。

    设计原则：
    - 每个阶段的输出是下一阶段的输入
    - step 模式下，关键节点会暂停等待用户确认
    - auto 模式下，所有节点连续执行不中断
    - progress 字段实时反映当前进度，供前端轮询
    """

    # ═══════════════════════════════════════════
    #  输入（由用户或前端传入，运行期间不变）
    # ═══════════════════════════════════════════
    project_id: int
    user_query: str
    tech_probe: str
    mode: Literal["auto", "step"]

    # ═══════════════════════════════════════════
    #  意图解析提取的检索参数
    #  （由 intent_node 从自然语言中提取，供后续节点使用）
    # ═══════════════════════════════════════════
    methodology: str            # 方法论偏好: general / traditional / deep_learning
    paper_type: str             # 论文类型: all / survey / original
    year_from: Optional[int]    # 起始年份
    year_to: Optional[int]      # 结束年份

    # ═══════════════════════════════════════════
    #  阶段一：主干检索
    # ═══════════════════════════════════════════
    trunk_intent: dict          # ResearchIntent 序列化后的结构
    trunk_results: list[dict]   # 检索到的论文列表（Paper dict）
    trunk_trace: dict           # 检索过程的 trace（耗时、召回量等）
    trunk_survey_count: int     # 综述论文数量

    # ═══════════════════════════════════════════
    #  阶段二：骨架收敛
    # ═══════════════════════════════════════════
    skeleton_recommendations: list[SkeletonRecommendation]
    skeleton_confirmed: list[int]   # 用户确认加入骨架的 paper_id 列表
    skeleton_skipped: list[int]     # 用户跳过的 paper_id 列表

    # ═══════════════════════════════════════════
    #  阶段三：探针推导
    # ═══════════════════════════════════════════
    derived_probes: list[ProbeDerivation]
    selected_probe: str             # 用户最终选择的探针

    # ═══════════════════════════════════════════
    #  流程控制（全程维护，供前端轮询）
    # ═══════════════════════════════════════════
    current_stage: str                              # 当前执行到哪个阶段
    stage_status: StageStatus                       # 当前阶段的状态
    error: Optional[str]                            # 错误信息
    progress: dict                                  # 实时进度详情


# ── 阶段名称常量 ──

STAGE_TRUNK = "trunk"
STAGE_SKELETON = "skeleton"
STAGE_PROBE = "probe"
STAGE_DONE = "done"


def create_initial_state(
    project_id: int,
    user_query: str,
    tech_probe: str = "",
    mode: Literal["auto", "step"] = "auto",
    methodology: str = "general",
    paper_type: str = "all",
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
) -> FunnelState:
    """创建初始状态，所有输出字段为空，流程控制字段初始化"""
    return FunnelState(
        # 输入
        project_id=project_id,
        user_query=user_query,
        tech_probe=tech_probe,
        mode=mode,
        # 检索参数（初始为默认值，intent_node 会更新）
        methodology=methodology,
        paper_type=paper_type,
        year_from=year_from,
        year_to=year_to,
        # 主干检索（初始为空）
        trunk_intent={},
        trunk_results=[],
        trunk_trace={},
        trunk_survey_count=0,
        # 骨架收敛（初始为空）
        skeleton_recommendations=[],
        skeleton_confirmed=[],
        skeleton_skipped=[],
        # 探针推导（初始为空）
        derived_probes=[],
        selected_probe="",
        # 流程控制
        current_stage=STAGE_TRUNK,
        stage_status="pending",
        error=None,
        progress={},
    )
