"""
API 层共享依赖 —— 路由间的公共前置校验

此前 search / branch / network 三个 router 各有一份逐字符相同的 _check，
统一收敛到这里。⚠️ 不能下沉到 utils/：check_project_access 依赖
sources.openalex.set_mailto，而 sources 已反向依赖 utils（utils → sources → utils 会成环）。
"""
from storage.mysql_db import get_session
from utils.auth import get_owned_project


def check_project_access(project_id: int, user) -> None:
    """校验项目归属（用户隔离）+ 设置 OpenAlex 礼貌邮箱（用户邮箱优先，否则默认）"""
    from sources import openalex as oa
    oa.set_mailto(user.email)
    with get_session() as session:
        get_owned_project(session, project_id, user)
