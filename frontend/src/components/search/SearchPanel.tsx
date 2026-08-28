"use client";

import { useState } from "react";
import { Search, Loader2, SlidersHorizontal, Sparkles, Globe, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/dto";

interface SearchPanelProps {
  activeProject: Project | null;
  searching: boolean;
  scope: "openalex" | "local";
  onScopeChange: (s: "openalex" | "local") => void;
  onSearch: (query: string, techProbe: string) => void;
  onNewProject: (query: string, techProbe: string) => void;
  onLocalSearch: (query: string) => void;
}

export function SearchPanel({
  activeProject,
  searching,
  scope,
  onScopeChange,
  onSearch,
  onNewProject,
  onLocalSearch,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [techProbe, setTechProbe] = useState("");
  const [showProbe, setShowProbe] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (scope === "local") {
      onLocalSearch(q);
      return;
    }
    if (activeProject) {
      onSearch(q, techProbe.trim());
    } else {
      onNewProject(q, techProbe.trim());
    }
  };

  return (
    <div className="border-b border-line bg-paper-white px-6 py-4 shrink-0">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          {/* 范围开关：仅项目激活时显示"本地库"（需已入库论文） */}
          {activeProject && (
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-paper-white/60 backdrop-blur-sm border border-line shrink-0">
              <button
                type="button"
                onClick={() => onScopeChange("openalex")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors",
                  scope === "openalex"
                    ? "bg-gradient-to-br from-gold-light via-gold to-gold-hover text-[#171614] shadow-sm"
                    : "text-ink-muted hover:text-ink-secondary",
                )}
              >
                <Globe className="w-3.5 h-3.5" />
                广域 OpenAlex
              </button>
              <button
                type="button"
                onClick={() => onScopeChange("local")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors",
                  scope === "local"
                    ? "bg-[#4FAF9F] text-white shadow-sm"
                    : "text-ink-muted hover:text-ink-secondary",
                )}
              >
                <Database className="w-3.5 h-3.5" />
                本地库 已入库
              </button>
            </div>
          )}

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                scope === "local"
                  ? "输入领域或技术探针，检索已入库论文"
                  : "描述研究方向"
              }
              className="input pl-9"
              disabled={searching}
            />
          </div>

          {/* 探针：仅广域模式有意义（本地模式主输入框即聚焦查询） */}
          {scope !== "local" && (
            <button
              type="button"
              onClick={() => setShowProbe(!showProbe)}
              className={cn(
                "btn-secondary flex items-center gap-1.5",
                techProbe && "border-accent text-accent",
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              探针
            </button>
          )}

          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="btn-primary min-w-[80px] flex items-center justify-center gap-1.5"
          >
            {searching ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                检索中
              </>
            ) : activeProject ? (
              "检索"
            ) : (
              "开始"
            )}
          </button>
        </div>

        {/* 广域模式：技术探针输入（LLM 提示） */}
        {showProbe && scope !== "local" && (
          <div className="flex items-center gap-3">
            <label className="text-[12px] text-ink-muted whitespace-nowrap">
              技术探针
            </label>
            <input
              type="text"
              value={techProbe}
              onChange={(e) => setTechProbe(e.target.value)}
              placeholder="可选，如：Transformer、GAN、PDE 约束"
              className="input flex-1"
            />
          </div>
        )}

        {activeProject && (
          <div className="flex items-center gap-4 text-[12px] text-ink-muted">
            <span>
              项目{" "}
              <span className="text-ink-secondary font-medium">
                {activeProject.name}
              </span>
            </span>
            {activeProject.tech_probe && (
              <span>
                探针 <span className="text-accent">{activeProject.tech_probe}</span>
              </span>
            )}
          </div>
        )}
      </form>

      {/* 模式引导：检索页 = 快速模式，对话页 = 精细模式 */}
      <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-faint">
        <Sparkles className="w-3 h-3 text-gold-light shrink-0" />
        <span>
          {scope === "local" ? (
            <span>
              本地库模式：对已在项目中的论文做语义召回（不重新联网、不重复入库）
            </span>
          ) : (
            <>
              快速检索：直接输入方向一键出结果。
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("navigate-to-chat"));
                }}
                className="ml-0.5 text-gold-light hover:text-gold transition-colors underline underline-offset-2"
              >
                需要 AI 引导精确检索？
              </button>
              去对话页
            </>
          )}
        </span>
      </div>
    </div>
  );
}
