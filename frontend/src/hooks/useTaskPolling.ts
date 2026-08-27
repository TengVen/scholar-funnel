/**
 * 统一任务轮询 Hook
 *
 * 收敛了此前 Branch/Network/Chat 三处复制粘贴的
 * 「sleep → 查状态 → done/error 判断 → 取结果」循环。
 *
 * 用法：
 *   const { running, run, cancel } = useTaskPolling({
 *     onRun: () => startBranchAnalyze(...),            // 返回 { task_id }
 *     getStatus: getBranchStatus,                       // task_id → TaskStatus
 *     getResult: getBranchResult,                       // task_id → 结果
 *     onResult: (res) => { /* 成功：合并/入库/副作用 *\/ },
 *     onProgress: (status) => { /* 每轮进度 *\/ },
 *     onError: (e) => { /* 失败处理 *\/ },
 *     intervalMs: 2000,
 *     timeoutMs: 600000,        // 可选：前端超时（默认无）
 *     onTimeout: () => {},      // 可选：超时回调（与 onError 区分）
 *   });
 *
 * 取消：组件卸载或用户主动取消时调用 cancel()——
 *   会置 abort 标志并中断在途请求（AbortError 视为正常取消，不触发 onError）。
 */
import { useCallback, useRef, useState } from "react";
import type { TaskStatus } from "@/types/dto";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 前端超时专用错误（与 onError 区分） */
class TaskTimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TaskTimeoutError";
  }
}

export interface UseTaskPollingOptions<T> {
  /** 启动任务，返回 task_id（可选：外部已持有 task_id 时可省略，改由 run(taskId) 传入） */
  onRun?: () => Promise<{ task_id: string }>;
  /** 查询任务状态（可选接收 AbortSignal，用于取消在途请求） */
  getStatus: (taskId: string, signal?: AbortSignal) => Promise<TaskStatus>;
  /** 任务完成后获取结果（可选接收 AbortSignal） */
  getResult: (taskId: string, signal?: AbortSignal) => Promise<T>;
  /** 成功回调（含合并/副作用，由调用方决定） */
  onResult: (result: T) => void;
  /** 每轮轮询进度回调（可选） */
  onProgress?: (status: TaskStatus) => void;
  /** 失败回调（可选，如 toast） */
  onError?: (e: unknown) => void;
  /** 轮询间隔，默认 2500ms */
  intervalMs?: number;
  /** 前端超时（ms），超过则走 onTimeout（默认无） */
  timeoutMs?: number;
  /** 超时回调（可选，与 onError 区分） */
  onTimeout?: () => void;
}

export function useTaskPolling<T>(options: UseTaskPollingOptions<T>) {
  const [running, setRunning] = useState(false);
  // 用 ref 持有最新 options，避免闭包捕获过期值、也避免 run 因 options 变化重建
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // 在途请求的 AbortController + 取消标志（cancel 时同时置位，循环检测后干净退出）
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);

  /** 启动并轮询；taskId 缺省时走 options.onRun 获取 */
  const run = useCallback(async (taskId?: string) => {
    const opts = optionsRef.current;
    setRunning(true);
    cancelRef.current = false;
    abortRef.current = new AbortController();
    const startedAt = Date.now();
    try {
      let id = taskId;
      if (!id) {
        if (!opts.onRun) throw new Error("缺少 task_id，且未提供 onRun");
        const t = await opts.onRun();
        id = t.task_id;
      }
      for (;;) {
        if (cancelRef.current) return;
        if (opts.timeoutMs && Date.now() - startedAt > opts.timeoutMs) {
          throw new TaskTimeoutError();
        }
        await sleep(opts.intervalMs ?? 2500);
        if (cancelRef.current) return;
        const status = await opts.getStatus(id, abortRef.current.signal);
        if (cancelRef.current) return;
        if (status.status === "done") break;
        if (status.status === "error") throw new Error(status.error || "任务失败");
        opts.onProgress?.(status);
      }
      const result = await opts.getResult(id, abortRef.current.signal);
      if (cancelRef.current) return;
      opts.onResult(result);
    } catch (e) {
      // 取消 / 卸载（AbortError）→ 视为正常中断，不报错
      if (cancelRef.current) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof TaskTimeoutError) {
        optionsRef.current.onTimeout?.();
      } else {
        optionsRef.current.onError?.(e);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, []);

  /** 取消轮询：置标志 + 中断在途请求（AbortError 由 run 捕获，不触发 onError） */
  const cancel = useCallback(() => {
    cancelRef.current = true;
    abortRef.current?.abort();
  }, []);

  return { running, run, cancel };
}
