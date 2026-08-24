/**
 * 统一任务轮询 Hook
 *
 * 收敛了此前 Branch/Network/Chat 三处复制粘贴的
 * 「sleep → 查状态 → done/error 判断 → 取结果」循环。
 *
 * 用法：
 *   const { running, run } = useTaskPolling({
 *     onRun: () => startBranchAnalyze(...),            // 返回 { task_id }
 *     getStatus: getBranchStatus,                       // task_id → TaskStatus
 *     getResult: getBranchResult,                       // task_id → 结果
 *     onResult: (res) => { /* 成功：合并/入库/副作用 *\/ },
 *     onProgress: (status) => { /* 每轮进度 *\/ },
 *     onError: (e) => { /* 失败处理 *\/ },
 *     intervalMs: 2000,
 *   });
 */
import { useCallback, useRef, useState } from "react";
import type { TaskStatus } from "@/types/dto";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface UseTaskPollingOptions<T> {
  /** 启动任务，返回 task_id（可选：外部已持有 task_id 时可省略，改由 run(taskId) 传入） */
  onRun?: () => Promise<{ task_id: string }>;
  /** 查询任务状态 */
  getStatus: (taskId: string) => Promise<TaskStatus>;
  /** 任务完成后获取结果 */
  getResult: (taskId: string) => Promise<T>;
  /** 成功回调（含合并/副作用，由调用方决定） */
  onResult: (result: T) => void;
  /** 每轮轮询进度回调（可选） */
  onProgress?: (status: TaskStatus) => void;
  /** 失败回调（可选，如 alert） */
  onError?: (e: unknown) => void;
  /** 轮询间隔，默认 2500ms */
  intervalMs?: number;
}

export function useTaskPolling<T>(options: UseTaskPollingOptions<T>) {
  const [running, setRunning] = useState(false);
  // 用 ref 持有最新 options，避免闭包捕获过期值、也避免 run 因 options 变化重建
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** 启动并轮询；taskId 缺省时走 options.onRun 获取 */
  const run = useCallback(async (taskId?: string) => {
    const { onRun, getStatus, getResult, onResult, onProgress, onError, intervalMs } =
      optionsRef.current;
    setRunning(true);
    try {
      let id = taskId;
      if (!id) {
        if (!onRun) throw new Error("缺少 task_id，且未提供 onRun");
        const t = await onRun();
        id = t.task_id;
      }
      for (;;) {
        await sleep(intervalMs ?? 2500);
        const status = await getStatus(id);
        if (status.status === "done") break;
        if (status.status === "error") throw new Error(status.error || "任务失败");
        onProgress?.(status);
      }
      const result = await getResult(id);
      onResult(result);
    } catch (e) {
      onError?.(e);
    } finally {
      setRunning(false);
    }
  }, []);

  return { running, run };
}
