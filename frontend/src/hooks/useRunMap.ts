"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunMapState } from "@/types/map";
import { getRunMap, ensureRunMap } from "@/lib/api/search";

/**
 * 领域地图数据 hook（T10）：拉取 run 地图状态 + 后台生成 + 生成中轮询。
 *
 * 消费端：工作台 run 区块 / 对话 MapCard（同一 run 快照）。
 * 行为：mount 或 runId 变化 → 拉一次；status=generating → 3s 轮询直至 done/failed；
 * generate() 触发 POST（幂等），随后进入轮询。
 */
export function useRunMap(runId: number | null | undefined, pollMs = 3000) {
  const [state, setState] = useState<RunMapState>({ status: "none" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // 拉一次；若仍在生成则安排下一轮（组件存活期间持续，卸载即停）
  const fetchState = useCallback(async () => {
    if (!runId) {
      setState({ status: "none" });
      return;
    }
    try {
      const data = await getRunMap(runId);
      if (!aliveRef.current) return;
      setState(data);
      if (data.status === "generating") {
        clearTimer();
        timerRef.current = setTimeout(() => { void fetchState(); }, pollMs);
      }
    } catch {
      /* 拉取失败静默：保留当前状态（下次操作或重进会再拉） */
    }
  }, [runId, pollMs]);

  useEffect(() => {
    aliveRef.current = true;
    clearTimer();
    void fetchState();
    return () => {
      aliveRef.current = false;
      clearTimer();
    };
  }, [fetchState]);

  /** 确保已生成（none/failed → 触发后台生成，随后轮询直到完成） */
  const generate = useCallback(async () => {
    if (!runId) return;
    try {
      await ensureRunMap(runId);
    } catch {
      /* 已在生成（202）等：直接进入拉取轮询即可 */
    }
    void fetchState();
  }, [runId, fetchState]);

  return { state, generate };
}
