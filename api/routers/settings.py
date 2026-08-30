"""
Settings API —— 运行时 LLM 配置（api key / base_url / model）

前端可在对话页配置自定义模型与密钥，无需重启服务、不改 .env。
注意：仅存内存，重启后失效；持久化由前端 localStorage 负责。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from llm import client as llm
from storage.models import User
from utils.auth import get_current_user

router = APIRouter()


class LLMConfigRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None


@router.post("/llm")
def set_llm_config(body: LLMConfigRequest, user: User = Depends(get_current_user)):
    """运行时替换 LLM 配置。至少传一个字段，全部为空则报错。"""
    if body.api_key is None and body.base_url is None and body.model is None:
        raise HTTPException(400, "至少需要提供 api_key / base_url / model 中的一项")

    try:
        llm.configure(
            api_key=body.api_key,
            base_url=body.base_url,
            model=body.model,
        )
    except Exception as e:
        raise HTTPException(500, f"配置 LLM 失败: {str(e)}")

    return {"ok": True, "message": "LLM 配置已更新（仅本次运行有效）"}


@router.get("/llm")
def get_llm_config(user: User = Depends(get_current_user)):
    """返回当前生效的模型名（不含密钥）。"""
    try:
        model = llm._resolve_model(None)  # 当前生效模型
        return {"ok": True, "model": model}
    except Exception as e:
        raise HTTPException(500, f"读取配置失败: {str(e)}")
