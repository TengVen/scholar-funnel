"use client";

import { useEffect, useState } from "react";
import {
  Search, FileText, PanelLeftClose, PanelLeft, User, LogOut, LogIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/api";
import { getCurrentUser, subscribeAuth, apiLogout } from "@/lib/auth";
import { AuthModal } from "@/components/auth/AuthModal";

interface SidebarProps {
  projects: Project[];
  activeProject: Project | null;
  onSelect: (p: Project) => void;
  onNewProject: (query: string, techProbe: string) => void;
}

export function Sidebar({ projects, activeProject, onSelect }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState(getCurrentUser());
  const [authOpen, setAuthOpen] = useState(false);

  // 订阅用户状态变化（登录/登出/游客升级后刷新）
  useEffect(() => subscribeAuth(setUser), []);

  const handleLogout = async () => {
    await apiLogout();
  };

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

      {/* 用户区 */}
      <div className="border-t border-line shrink-0">
        {collapsed ? (
          <button
            onClick={() => (user ? handleLogout() : setAuthOpen(true))}
            title={user ? "退出登录" : "登录/注册"}
            className="w-full flex justify-center py-2.5 text-ink-muted hover:text-accent"
          >
            {user ? <LogOut className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
          </button>
        ) : user ? (
          <div className="px-3 py-2.5 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-accent-light flex items-center justify-center shrink-0">
              <User className="w-3 h-3 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-ink truncate">{user.username}</p>
              <p className="text-[10px] text-ink-faint">
                {user.is_guest ? "游客模式" : user.role === "admin" ? "管理员" : "已登录"}
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="退出登录"
              className="p-1 rounded hover:bg-paper-warm text-ink-faint hover:text-red-400"
            >
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAuthOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-ink-muted hover:text-accent"
          >
            <LogIn className="w-3.5 h-3.5 shrink-0" />
            登录 / 注册
          </button>
        )}
      </div>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={() => {
          // 登录/升级后刷新项目列表（游客数据归入等场景）
          window.dispatchEvent(new CustomEvent("auth:changed"));
        }}
      />
    </aside>
  );
}
