"use client";

import { useState } from "react";
import { Search, FileText, PanelLeftClose, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/api";

interface SidebarProps {
  projects: Project[];
  activeProject: Project | null;
  onSelect: (p: Project) => void;
  onNewProject: (query: string, techProbe: string) => void;
}

export function Sidebar({ projects, activeProject, onSelect }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-line bg-paper-white transition-[width] duration-200",
        collapsed ? "w-12" : "w-56",
      )}
    >
      {/* Header */}
      <div className="flex items-center h-12 px-3 border-b border-line shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-gold-light to-gold-hover flex items-center justify-center shrink-0">
              <Search className="w-3 h-3 text-[#171614]" />
            </div>
            <span className="font-serif text-[13px] font-semibold text-gold-light truncate">
              Scholar Funnel
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-paper-warm text-ink-muted shrink-0 ml-auto"
        >
          {collapsed ? (
            <PanelLeft className="w-3.5 h-3.5" />
          ) : (
            <PanelLeftClose className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-2">
        {!collapsed && (
          <p className="px-3 mb-1 text-[10px] font-medium text-ink-faint uppercase tracking-widest">
            Projects
          </p>
        )}
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors",
              activeProject?.id === p.id
                ? "bg-accent-light text-accent font-medium"
                : "text-ink-secondary hover:bg-paper-warm",
            )}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span className="truncate">{p.name}</span>}
          </button>
        ))}

        {projects.length === 0 && !collapsed && (
          <p className="px-3 py-4 text-[12px] text-ink-faint">
            输入研究方向开始
          </p>
        )}
      </div>
    </aside>
  );
}
