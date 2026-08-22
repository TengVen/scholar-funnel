"""
漏斗编排 API —— 启动/恢复/查询漏斗工作流

端点：
    POST /api/funnel/start    - 启动漏斗（auto 或 step 模式）
    POST /api/funnel/resume   - 恢复被中断的漏斗
    GET  /api/funnel/state    - 查询漏斗当前状态（轮询进度用）

输入方式：
    user_input 支持自然语言，系统会自动经过意图解析提取结构化参数。
    例如："我想研究图像修复中用了最小二乘法的论文"
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from agents.funnel.graph import run_funnel, resume_funnel, get_funnel_state

from storage.models import User
from utils.auth import get_current_user, get_owned_project
from storage.mysql_db import get_session

router = APIRouter()


# ── 请求模型 ──

class FunnelStartRequest(BaseModel):
    """启动漏斗的请求"""
    project_id: int
    user_input: str = Field(
        ...,
        description="用户输入：支持自然语言（如'图像修复中用了最小二乘法的论文'）或研究方向描述",
    )
    tech_probe: str = Field(
        "",
        description="技术探针（可选，如果 user_input 中已包含则不需要）",
    )
    mode: str = Field(
        "auto",
        description="运行模式: auto（全自动）或 step（逐步确认）",
    )
    # 检索参数（可选，如已知可直接传入，否则由意图解析自动提取）
    methodology: str = Field(
        "general",
        description="方法论偏好: general / traditional / deep_learning",
    )
    paper_type: str = Field(
        "all",
        description="论文类型: all / survey / original",
    )
    year_from: Optional[int] = Field(None, description="起始年份")
    year_to: Optional[int] = Field(None, description="结束年份")


class FunnelResumeRequest(BaseModel):
    """恢复漏斗的请求"""
    thread_id: str

    # 意图解析中断：用户补充信息
    user_input: Optional[str] = Field(
        None,
        description="意图解析信息不足时，用户补充的自然语言信息",
    )

    # 骨架确认中断
    skeleton_confirmed: Optional[list[int]] = Field(
        None, description="用户确认加入骨架的 paper_id 列表"
    )
    skeleton_skipped: Optional[list[int]] = Field(
        None, description="用户跳过的 paper_id 列表"
    )

    # 探针选择中断
    selected_probe: Optional[str] = Field(
        None, description="用户选择的探针关键词"
    )


# ── 端点 ──

@router.post("/start")
def start_funnel(body: FunnelStartRequest, user: User = Depends(get_current_user)):
    with get_session() as session:
        get_owned_project(session, body.project_id, user)
    """
    启动漏斗编排。

    user_input 支持自然语言输入，系统会自动经过意图解析 Agent：
    - 提取研究方向（user_query）
    - 提取技术探针（tech_probe）
    - 判断信息是否完整

    如果信息不足（step 模式），会中断并返回追问内容。
    前端展示追问，用户补充后调用 /resume 继续。
    """
    try:
        result = run_funnel(
            project_id=body.project_id,
            user_input=body.user_input,
            tech_probe=body.tech_probe,
            mode=body.mode,
            methodology=body.methodology,
            paper_type=body.paper_type,
            year_from=body.year_from,
            year_to=body.year_to,
        )
        return {
            "thread_id": result["thread_id"],
            "current_stage": result["current_stage"],
            "interrupted": result["interrupted"],
            "state": result["state"],
        }
    except Exception as e:
        raise HTTPException(500, f"漏斗启动失败: {str(e)}")


@router.post("/resume")
def resume(body: FunnelResumeRequest):
    """
    恢复被中断的漏斗。

    根据中断阶段，传入不同的用户输入：
    1. 意图解析中断：传 user_input（自然语言补充信息）
    2. 骨架确认中断：传 skeleton_confirmed + skeleton_skipped
    3. 探针选择中断：传 selected_probe
    """
    try:
        user_input = {}

        # 意图解析中断
        if body.user_input:
            user_input["user_input"] = body.user_input

        # 骨架确认中断
        if body.skeleton_confirmed is not None:
            user_input["skeleton_confirmed"] = body.skeleton_confirmed
        if body.skeleton_skipped is not None:
            user_input["skeleton_skipped"] = body.skeleton_skipped

        # 探针选择中断
        if body.selected_probe is not None:
            user_input["selected_probe"] = body.selected_probe

        result = resume_funnel(
            thread_id=body.thread_id,
            user_input=user_input or None,
        )

        if "error" in result:
            raise HTTPException(404, result["error"])

        return {
            "thread_id": result["thread_id"],
            "current_stage": result["current_stage"],
            "interrupted": result["interrupted"],
            "state": result["state"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"漏斗恢复失败: {str(e)}")


@router.get("/state")
def get_state(thread_id: str):
    """
    查询漏斗当前状态。

    前端轮询用：每 2-3 秒调一次，获取最新进度。
    返回的 progress 字段中包含每个阶段的详细信息。
    """
    result = get_funnel_state(thread_id)

    if "error" in result:
        raise HTTPException(404, result["error"])

    return {
        "thread_id": result["thread_id"],
        "current_stage": result["current_stage"],
        "stage_status": result["stage_status"],
        "interrupted": result["interrupted"],
        "progress": result["progress"],
        "state": result["state"],
    }
