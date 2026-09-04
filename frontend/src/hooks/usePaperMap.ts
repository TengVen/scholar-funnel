"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PaperMapState } from "@/types/map";
import { getPaperMap } from "@/lib/api/papers";

/**
 * 论文详情页地图数据 hook（T10）：反查该论文所属 run 的领域地图。
 * 无 paper_id（transient）/ 无 run → status=none；generating → 轮询直至 done/failed。
 */
export function usePaperMap(paperId: number | null | undefined, projectId: number | null | undefined, pollMs = 3000) {
  const [state, setState] = useState<PaperMapState>({ status: "none" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const fetchState = useCallback(async () => {
    if (!paperId || !projectId) {
      setState({ status: "none" });
      return;
    }
    try {
      const data = await getPaperMap(paperId, projectId);
      if (!aliveRef.current) return;
      setState(data);
      if (data.status === "generating") {
        clearTimer();
        timerRef.current = setTimeout(() => { void fetchState(); }, pollMs);
      }
    } catch {
      /* 拉取失败静默：保留当前状态 */
    }
  }, [paperId, projectId, pollMs]);

  useEffect(() => {
    aliveRef.current = true;
    clearTimer();
    void fetchState();
    return () => {
      aliveRef.current = false;
      clearTimer();
    };
  }, [fetchState]);

  return { state };
}
