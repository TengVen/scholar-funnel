"use client";

import { useState } from "react";
import {
  Search, PanelLeftClose, PanelLeft, User, LogOut, LogIn,
  MessageSquare, Plus, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/types/dto";
import { useAuth } from "@/hooks/useAuth";
import { AuthModal } from "@/components/common/AuthModal";

/**
 * 左栏：对话历史（2-page IA，GPT 式；无项目索引——子研究收敛到工作台概览）
 */
interface SidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onSelectConversation: (cid: string) => void;
  onNewConversation: () => void;
}

export function Sidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [convsOpen, setConvsOpen] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);

  // 认证状态由 authStore + useAuth 管理（登录/登出/游客升级自动刷新）
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  const fmtTime = (iso: string) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toTimeString().slice(0, 5);
      }
      return `${d.getMonth() + 1}/${d.getDate()}`;
    } catch {
      return "";
    }
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
            <span className="font-serif text-base font-semibold text-gold-light truncate">
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

      {/* 新对话按钮 */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1 shrink-0">
          <button
            onClick={onNewConversation}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-gold/30 bg-accent-light/20 text-sm text-gold-light hover:bg-accent-light/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            新对话
          </button>
        </div>
      )}

      {/* 主体：会话历史 */}
      <div className="flex-1 overflow-y-auto py-2">
        {!collapsed && (
          <div className="mb-1">
            <button
              onClick={() => setConvsOpen(!convsOpen)}
              className="w-full flex items-center gap-1 px-3 py-1 text-2xs font-medium text-ink-faint uppercase tracking-widest hover:text-ink-muted"
            >
              {convsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              对话历史
            </button>
            {convsOpen && (
              <div className="space-y-0.5">
                {conversations.length === 0 ? (
                  <p className="px-3 py-1.5 text-xs text-ink-faint">暂无对话</p>
                ) : (
                  conversations.map((c) => (
                    <button
                      key={c.conversation_id}
                      onClick={() => onSelectConversation(c.conversation_id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-base transition-colors",
                        activeConversationId === c.conversation_id
                          ? "bg-accent-light text-accent font-medium"
                          : "text-ink-secondary hover:bg-paper-warm",
                      )}
                    >
                      <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate flex-1">
                        {c.title && c.title !== "new" ? c.title : "未命名对话"}
                      </span>
                      <span className="text-2xs text-ink-faint shrink-0">
                        {fmtTime(c.last_message_at || c.created_at)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {conversations.length === 0 && !collapsed && (
          <p className="px-3 py-4 text-sm text-ink-faint">
            发起一段对话，开始你的研究
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
              <p className="text-sm font-medium text-ink truncate">{user.username}</p>
              <p className="text-2xs text-ink-faint">
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
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-ink-muted hover:text-accent"
          >
            <LogIn className="w-3.5 h-3.5 shrink-0" />
            登录 / 注册
          </button>
        )}
      </div>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        // 登录成功后 authStore.user 变化 → 页面自动刷新项目/会话，无需手动派发事件
      />
    </aside>
  );
}
