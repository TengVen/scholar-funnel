"use client";

import { useRunMap } from "@/hooks/useRunMap";
import { MapView } from "./MapView";

/**
 * 工作台 run 区块的领域地图节（T10）：
 * 数据经 useRunMap（拉取/轮询/按需生成）；展示统一走 MapView。
 * defaultCollapsed=false：工作台「领域地图」区块点开即看全图（2026-09-04）。
 */
interface RunMapSectionProps {
  runId: number;
  onOpenPaper: (paperId: number) => void;
  /** 展开态默认折叠（消息卡等场景） */
  defaultCollapsed?: boolean;
}

export function RunMapSection({ runId, onOpenPaper, defaultCollapsed = false }: RunMapSectionProps) {
  const { state, generate } = useRunMap(runId);
  return (
    <MapView
      state={state}
      onOpenPaper={onOpenPaper}
      onGenerate={generate}
      onRetry={generate}
      defaultCollapsed={defaultCollapsed}
    />
  );
}
