"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type { RunMapPayload, RunMapState } from "@/types/map";
import { mapStats } from "@/lib/map/format";
import { cn } from "@/lib/utils";

/**
 * 领域地图展示（T10）——三端复用（对话 MapCard / 工作台 run 区块 / 详情页左栏导航）。
 *
 * 外层职责：标题行 + 状态分支（generating 占位 / failed 重试 / none 生成提示 / done 内容）；
 * 内容展示统一走内部 MapBody（锚点 / 主线 / 热点 / 演进，节点可点进论文详情）。
 *
 * 视觉（2026-09-04 晚 v3）：内容区为「无描边浅色组块」制式（bg-paper-warm 圆角块，
 * 内部行 hover 反馈），去掉小卡片描边，避免窄栏"框内框"；正文层级文字提亮一档。
 * 折叠态由本组件自持（defaultCollapsed：对话/工作台默认折叠，详情页地图导航默认展开）。
 */
interface MapViewProps {
  state: RunMapState;
  onOpenPaper: (paperId: number) => void;
  /** 工作台/对话默认折叠；详情页地图导航传 false（默认展开便于浏览） */
  defaultCollapsed?: boolean;
  /** none 态提供生成入口时注入（工作台按钮）；无则显示空态文案 */
  onGenerate?: () => void;
  onRetry?: () => void;   // failed 态重试（后端 failed 允许重生成）
  generatingHint?: string; // 轮询提示语（默认"生成中…"）
  /** bare：无外框/无折叠标题，状态与内容直出（详情页左栏「领域地图」条目展开区，避免二次展开） */
  bare?: boolean;
  /** 内容区自带横向 padding（非 bare 面板内默认 true）；裸排场景（bare 条目展开）传 false 由组块自持 */
  contentPadding?: boolean;
}

export function MapView({
  state, onOpenPaper, defaultCollapsed = true, onGenerate, onRetry,
  bare = false, contentPadding = true,
}: MapViewProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const { status, map, error } = state;
  const stats = mapStats(map);

  // 折叠头：状态无关，始终可见（点击展开/收起内容区）
  const toggle = () => setCollapsed((v) => !v);

  // 状态/内容区：bare 时直出（无标题层）；否则挂在折叠头下方
  const renderBody = () => (
    <>
      {status === "generating" && (
        <p className={cn("text-xs text-ink-muted leading-relaxed", contentPadding ? "px-3 py-3" : "px-2 py-2")}>
          正在归纳领域结构（综述锚点 / 方法主线 / 活跃问题），约 10-30 秒，请稍候…
        </p>
      )}
      {status === "failed" && (
        <div className={cn("flex items-center justify-between gap-2", contentPadding ? "px-3 py-3" : "px-2 py-2")}>
          <p className="text-xs text-ink-muted leading-relaxed">归纳失败：{error ?? "未知原因"}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn-secondary text-2xs !py-1 shrink-0">
              <RefreshCw className="w-3 h-3 mr-1 inline" /> 重新生成
            </button>
          )}
        </div>
      )}
      {status === "none" && (
        <div className={cn("flex items-center justify-between gap-2", contentPadding ? "px-3 py-3" : "px-2 py-2")}>
          <p className="text-xs text-ink-muted leading-relaxed">该检索尚未生成领域地图</p>
          {onGenerate && (
            <button type="button" onClick={onGenerate} className="btn-secondary text-2xs !py-1 shrink-0">
              生成领域地图
            </button>
          )}
        </div>
      )}
      {status === "done" && map && (
        <MapBody
          payload={map}
          titles={state.titles}
          padded={contentPadding}
          onOpenPaper={onOpenPaper}
        />
      )}
    </>
  );

  if (bare) {
    return <div>{renderBody()}</div>;
  }

  return (
    <div className="rounded-lg border border-line/70 overflow-hidden bg-paper-white/40">
      {/* 头部行 */}
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-paper-warm/50 transition-colors"
      >
        {status === "generating" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
        ) : (
          <BookOpen className="w-3.5 h-3.5 text-accent shrink-0" />
        )}
        <span className="text-xs font-medium text-ink">领域地图</span>
        {status === "done" && (
          <span className="text-2xs text-ink-muted">
            {stats.mainlines} 主线 · {stats.hotspots} 热点 · {stats.anchors} 锚点
          </span>
        )}
        {status === "generating" && <span className="text-2xs text-ink-muted">归纳生成中…</span>}
        {status === "failed" && <span className="text-2xs text-status-partial/90">生成失败</span>}
        <span className="ml-auto shrink-0">
          {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-ink-faint" /> : <ChevronDown className="w-3.5 h-3.5 text-ink-faint" />}
        </span>
      </button>

      {!collapsed && <div className="border-t border-line/60">{renderBody()}</div>}
    </div>
  );
}

/* ── 内容区（浅色组块制式：无描边圆角块，行 hover 反馈；节点可点进论文详情）── */

function MapBody({ payload, titles, onOpenPaper, padded = true }: {
  payload: RunMapPayload;
  /** 引用 id → 标题（主线/热点支撑论文显示标题；缺失兜底 #id） */
  titles?: Record<string, string>;
  onOpenPaper: (pid: number) => void;
  /** 外层已提供横向 padding 时传 false（详情页左栏裸排条目展开区） */
  padded?: boolean;
}) {
  const { anchors = [], mainlines = [], hotspots = [], evolution = [] } = payload;
  const empty = anchors.length === 0 && mainlines.length === 0 && hotspots.length === 0;
  if (empty) {
    return (
      <p className={cn("text-xs text-ink-muted", padded ? "px-3 py-3" : "px-2 py-2")}>
        该结果集暂无可归纳的有效结构
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", padded ? "px-3 py-3" : "py-1.5")}>
      {payload.topic && (
        <p className="px-1 text-xs text-ink-secondary leading-snug">主题：{payload.topic}</p>
      )}
      {payload.fallback && (
        <p className="px-1 text-2xs text-status-running/80 leading-snug">
          （规则版：AI 归纳暂不可用，由关键词与综述属性自动归并）
        </p>
      )}

      {/* 综述锚点 */}
      {anchors.length > 0 && (
        <div className="rounded-lg bg-paper-warm/40 px-2 py-1.5">
          <SectionLabel text={`综述锚点 · 入门先读 (${anchors.length})`} />
          <div className="flex flex-col gap-0.5">
            {anchors.map((a) => (
              <button
                key={a.paper_id}
                type="button"
                onClick={() => onOpenPaper(a.paper_id)}
                className="flex items-center gap-1.5 text-left rounded-md px-1.5 py-1 hover:bg-paper-warm transition-colors"
                title="进入论文详情"
              >
                <span className="text-2xs text-ink-muted shrink-0">{a.year ?? "—"}</span>
                <span className="flex-1 min-w-0 text-xs text-ink truncate">{a.title}</span>
                {a.is_survey && (
                  <span className="text-2xs px-1 py-px rounded bg-gold/15 text-gold-deep border border-gold/25 shrink-0">综述</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 方法主线 */}
      {mainlines.length > 0 && (
        <div className="rounded-lg bg-paper-warm/40 px-2 py-1.5">
          <SectionLabel text={`方法主线 (${mainlines.length})`} />
          <div className="flex flex-col gap-1">
            {mainlines.map((m, i) => (
              <div key={i} className="rounded-md px-1.5 py-1 hover:bg-paper/50 transition-colors">
                <p className="text-xs font-medium text-ink">{i + 1}. {m.name}</p>
                {m.description && (
                  <p className="text-2xs text-ink-secondary mt-0.5 leading-snug">{m.description}</p>
                )}
                {m.paper_ids.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.paper_ids.map((pid) => {
                      const t = titles?.[String(pid)];
                      return (
                        <button
                          key={pid}
                          type="button"
                          onClick={() => onOpenPaper(pid)}
                          className="max-w-[220px] inline-flex items-center text-2xs px-1.5 py-0.5 rounded border border-line/60 text-ink-secondary hover:text-accent hover:border-accent/40 transition-colors"
                          title={t ? `进入论文详情：${t}` : "进入论文详情"}
                        >
                          <span className="truncate">{t || `#${pid}`}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 活跃问题 */}
      {hotspots.length > 0 && (
        <div className="rounded-lg bg-paper-warm/40 px-2 py-1.5">
          <SectionLabel text={`活跃问题 (${hotspots.length})`} />
          <div className="flex flex-wrap gap-1">
            {hotspots.map((h, i) => (
              <span key={i} className="text-2xs px-2 py-0.5 rounded-full bg-paper-warm text-ink-secondary">
                {h.question}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 时间演进 */}
      {evolution.length > 0 && (
        <div className="rounded-lg bg-paper-warm/40 px-2 py-1.5">
          <SectionLabel text="时间演进" />
          <div className="flex flex-col gap-1">
            {evolution.map((e, i) => (
              <div key={i} className="flex gap-2 text-xs rounded-md px-1.5 py-0.5">
                <span className="text-2xs text-ink-muted shrink-0 mt-px">
                  {[e.year_from, e.year_to].filter((y): y is number => y != null).join("-") || "—"}
                </span>
                <div className="min-w-0">
                  <span className="font-medium text-ink">{e.stage}</span>
                  {e.description && <span className="text-ink-secondary"> · {e.description}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <p className="text-2xs font-medium text-ink-muted mb-1">{text}</p>;
}
