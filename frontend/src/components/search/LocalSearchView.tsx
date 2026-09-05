"use client";

import { Database } from "lucide-react";
import type { Paper } from "@/types/dto";
import { SearchPanel } from "./SearchPanel";
import { PaperCard } from "./PaperCard";

/**
 * 检索页·本地库二次检索视图（2026-09-05 从 page.tsx 拆分）：
 * 对已入库论文做领域/技术语义召回的结果展示（teal 调区分广域检索）。
 * 仅负责呈现与事件绑定，检索编排（状态/请求）仍在 page.tsx。
 */
export function LocalSearchView({
  project,
  scope,
  searching,
  localSearching,
  query,
  papers,
  onScopeChange,
  onSearch,
  onNewProject,
  onLocalSearch,
  onExit,
  onOpenPaper,
}: {
  project: NonNullable<Parameters<typeof SearchPanel>[0]["activeProject"]>;
  scope: "openalex" | "local";
  searching: boolean;
  localSearching: boolean;
  query: string;
  papers: Paper[];
  onScopeChange: (s: "openalex" | "local") => void;
  onSearch: (query: string, techProbe: string) => void;
  onNewProject: (query: string, techProbe: string) => void;
  onLocalSearch: (query: string) => void;
  onExit: () => void;
  onOpenPaper: (paperId: number) => void;
}) {
  return (
    <>
      <SearchPanel
        activeProject={project}
        searching={scope === "local" ? localSearching : searching}
        scope={scope}
        onScopeChange={onScopeChange}
        onSearch={onSearch}
        onNewProject={onNewProject}
        onLocalSearch={onLocalSearch}
      />
      <div className="flex items-center justify-between px-6 py-2 border-b border-aux-teal/25 bg-aux-teal/[0.06] shrink-0">
        <span className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-aux-teal/15 text-aux-teal border border-aux-teal/30">
            <Database className="w-3 h-3" />
            本地库召回
          </span>
          <span className="text-ink-secondary font-medium">{query}</span>
          <span className="ml-1 text-ink-faint">{papers.length} 篇</span>
        </span>
        <button onClick={onExit} className="btn-ghost text-sm">
          退出本地检索
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 bg-aux-teal/[0.02]">
        {localSearching && papers.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-line border-t-aux-teal rounded-full animate-spin" />
          </div>
        ) : papers.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-faint">
            <Database className="w-6 h-6 opacity-40" />
            <p className="text-base">未找到匹配的已入库论文</p>
          </div>
        ) : (
          papers.map((p) => (
            <PaperCard key={p.id} paper={p} onOpenPaper={() => onOpenPaper(p.id)} />
          ))
        )}
      </div>
    </>
  );
}
