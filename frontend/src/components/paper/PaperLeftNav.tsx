"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Compass, Map as MapIcon } from "lucide-react";
import type { PaperMapState, RunMapPayload } from "@/types/map";
import { usePaperMap } from "@/hooks/usePaperMap";
import { locatePaper, mapStats } from "@/lib/map/format";
import { MapView } from "@/components/map/MapView";
import { TocSidebar } from "./TocSidebar";
import { cn } from "@/lib/utils";

/**
 * 论文详情页左栏（T10 v2，2026-09-04 晚拍板）：
 * 去掉「地图 | 目录」页签二选一，改在「论文导航」下纵向组织——
 * - 领域地图：顶部条目（默认收起），点击就地展开：本文定位条 + 全图导航（MapView bare，直达内容、无二次折叠）
 * - 目录：其下常驻显示（TocSidebar：PDF / 证据引用的手动章节导航）
 * transient（无项目论文/无 run）→ 无地图条目，仅目录。
 * 底部 PaperQaBox 在页面层保持不变。
 */
interface PaperLeftNavProps {
  /** 项目论文 id（transient 为 null → 无 run 上下文，仅目录可用） */
  paperId: number | null | undefined;
  projectId: number | null | undefined;
  headings: string[];
  hasSections: boolean;
  /** 目录跳转（父级裁决 PDF 页码 / 正文锚点） */
  onJump: (label: string) => void;
}

export function PaperLeftNav({ paperId, projectId, headings, hasSections, onJump }: PaperLeftNavProps) {
  const router = useRouter();
  const search = useSearchParams();
  const { state } = usePaperMap(paperId, projectId);

  const mapUsable = paperId != null && projectId != null;
  const [mapOpen, setMapOpen] = useState(false);

  // 地图内论文节点 → 详情页内切换（保持 project/run 上下文，不做自动预热）
  const openMapPaper = (targetId: number) => {
    if (!projectId) return;
    const runId = search.get("run_id");
    const convId = search.get("conv_id");
    const qs = new URLSearchParams({ project_id: String(projectId) });
    if (runId) qs.set("run_id", runId);
    if (convId) qs.set("conv_id", convId);
    router.push(`/paper/${targetId}?${qs.toString()}`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {mapUsable && (
          <MapEntry
            open={mapOpen}
            onToggle={() => setMapOpen((v) => !v)}
            state={state}
            currentPaperId={paperId!}
            onOpenPaper={openMapPaper}
          />
        )}
        <TocSidebar hasSections={hasSections} headings={headings} onJump={onJump} />
      </div>
    </div>
  );
}

/** 领域地图条目：标题行点击 → 下方就地展开内容（无二次折叠层）。
 *  v3（2026-09-04）：去外层卡片框，标题行与目录同语言（无框导航项）；展开内容为无描边浅色组块。 */
function MapEntry({ open, onToggle, state, currentPaperId, onOpenPaper }: {
  open: boolean;
  onToggle: () => void;
  state: PaperMapState;
  currentPaperId: number;
  onOpenPaper: (paperId: number) => void;
}) {
  const { status } = state;
  const stats = mapStats(state.map);

  return (
    <div className="flex flex-col">
      {/* 条目标题行 = 展开器（与目录一致：无框，hover 显底） */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left hover:bg-paper-warm/60 transition-colors"
      >
        <MapIcon className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-xs font-medium text-ink">领域地图</span>
        {status === "done" && (
          <span className="text-2xs text-ink-muted">
            {stats.mainlines} 主线 · {stats.hotspots} 热点 · {stats.anchors} 锚点
          </span>
        )}
        {status === "generating" && <span className="text-2xs text-ink-muted">归纳生成中…</span>}
        {status === "failed" && <span className="text-2xs text-status-partial/90">生成失败</span>}
        <span className="ml-auto shrink-0">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-ink-faint" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-faint" />}
        </span>
      </button>

      {open && (
        <div className="ml-0.5 flex flex-col gap-1.5">
          {status === "done" && state.map ? (
            <>
              <MapLocator map={state.map} currentPaperId={currentPaperId} />
              <MapView bare state={state} onOpenPaper={onOpenPaper} contentPadding={false} />
            </>
          ) : (
            <>
              <MapView bare state={state} onOpenPaper={onOpenPaper} contentPadding={false} />
              <p className="px-2 pb-1 text-2xs text-ink-muted leading-snug">
                地图生成/重试入口在对话页工作台的对应检索记录中
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 本文在领域中的定位（done 且在地图内时显示；未收录给引导）——与地图内容同为浅色组块制式 */
function MapLocator({ map, currentPaperId }: { map: RunMapPayload; currentPaperId: number }) {
  const pos = locatePaper(map, currentPaperId);
  const hasPosition = pos.anchors.length > 0 || pos.mainlines.length > 0 || pos.hotspots.length > 0;

  if (!hasPosition) {
    return (
      <p className="px-2 text-2xs text-ink-muted leading-snug">
        本文暂未被领域地图收录（可能是后续补充的论文），可在下方地图中浏览相关论文。
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-paper-warm/40 px-2 py-1.5">
      <p className="flex items-center gap-1 text-2xs font-medium text-ink-secondary mb-1">
        <Compass className="w-3 h-3 text-accent" /> 本文在领域中的位置
      </p>
      {pos.anchors.map((t) => <PosChip key={`a-${t}`} tone="anchor" text={`综述锚点：${t}`} />)}
      {pos.mainlines.map((t) => <PosChip key={`m-${t}`} tone="line" text={`主线：${t}`} />)}
      {pos.hotspots.map((t) => <PosChip key={`h-${t}`} tone="hot" text={`热点：${t}`} />)}
    </div>
  );
}

function PosChip({ tone, text }: { tone: "anchor" | "line" | "hot"; text: string }) {
  const cls =
    tone === "anchor"
      ? "border-gold/25 bg-gold/10 text-gold-deep"
      : tone === "line"
        ? "border-accent/25 bg-accent/10 text-accent"
        : "border-aux-teal/25 bg-aux-teal/10 text-aux-teal";
  return <span className={cn("inline-block text-2xs px-1.5 py-0.5 rounded border mr-1 mb-1", cls)}>{text}</span>;
}
