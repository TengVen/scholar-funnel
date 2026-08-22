"use client";

import { useState } from "react";
import { Search, Loader2, SlidersHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/api";

interface SearchPanelProps {
  activeProject: Project | null;
  searching: boolean;
  onSearch: (query: string, techProbe: string) => void;
  onNewProject: (query: string, techProbe: string) => void;
}

export function SearchPanel({
  activeProject,
  searching,
  onSearch,
  onNewProject,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [techProbe, setTechProbe] = useState("");
  const [showProbe, setShowProbe] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
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
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="描述研究方向，如：图像修复中的偏微分方程方法"
              className="input pl-9"
              disabled={searching}
            />
          </div>

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

        {showProbe && (
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
          快速检索：直接输入方向一键出结果。
          <button
            type="button"
            onClick={() => {
              /* 切换到对话页由 page.tsx 处理，这里通过事件冒泡不可行，
                 故通过 window 事件通知 page.tsx */
              window.dispatchEvent(new CustomEvent("navigate-to-chat"));
            }}
            className="ml-0.5 text-gold-light hover:text-gold transition-colors underline underline-offset-2"
          >
            需要 AI 引导精确检索？
          </button>
          去对话页
        </span>
      </div>
    </div>
  );
}
