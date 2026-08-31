"""
并发提交守卫（duplicate-submit guard）。

问题背景：branch / network / trunk 等分析接口是「前端点击 → 后端起一个内存态后台 task →
前端轮询」。若用户快速重复点击（或前端竞态连发），会同时起多个 task 同写同一 project，
造成数据竞争、资源浪费（重复跑 OpenAlex + DeepSeek）。

解决：同一 (项目, 操作) 正在运行时，复用已有 task 的 task_id，而不是新起一个。

用法（每个使用内存 task 存储的路由各自持有独立 namespace 的锁）：

    from utils.task_guard import acquire_or_reuse

    task_id, created = acquire_or_reuse(
        namespace="trunk",
        store=_trunk_tasks,
        key_match=lambda t: t.get("project_id") == body.project_id,
        create=lambda: _start_trunk(body, user),
    )
    return {"task_id": task_id, "status": "started", "duplicate": not created}

要点：
- namespace 维度锁保证「检查-创建」原子，避免并发请求同时越过检查各起一个 task。
- create() 内部须写入 store 并启动线程，返回新建的 task_id。
- key_match 仅对 status=="running" 的任务生效，已完成/失败的任务不阻挡新提交。
"""
import threading
from typing import Callable, Tuple

from fastapi import HTTPException

_locks: dict[str, threading.Lock] = {}


def assert_task_owner(task: dict, user) -> None:
    """校验 task 归属：仅创建者本人可查询/取结果（branch/network/chat 三处合并于此）"""
    if task.get("user_id") is not None and task["user_id"] != user.id:
        raise HTTPException(403, "无权访问该任务")


def _lock_for(namespace: str) -> threading.Lock:
    lk = _locks.get(namespace)
    if lk is None:
        lk = threading.Lock()
        _locks[namespace] = lk
    return lk


def acquire_or_reuse(
    namespace: str,
    store: dict,
    key_match: Callable[[dict], bool],
    create: Callable[[], str],
) -> Tuple[str, bool]:
    """原子检查 store 中是否存在 status=='running' 且 key_match 命中的任务。

    - 命中 → 返回 (已有 task_id, False)，复用之；
    - 未命中 → 调用 create() 新建任务（create 内部须写入 store 并启动线程），
      返回 (新 task_id, True)。
    """
    with _lock_for(namespace):
        for tid, task in store.items():
            if task.get("status") == "running" and key_match(task):
                return tid, False
        return create(), True
