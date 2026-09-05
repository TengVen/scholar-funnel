"use client";

import type { KeyboardEvent, RefObject } from "react";
import { LayoutGrid, Send, Loader2 } from "lucide-react";
import type { ChatConfig } from "@/types/domain";
import { ChatConfigBar } from "./ChatConfigBar";

/**
 * 对话态底部输入栏（输入框 + 配置栏 + 确认中的参数回显）
 */
export function ChatComposer({
  input, setInput, onSend, onKeyDown, placeholder, inputDisabled, sending,
  config, setConfig, inputRef,
  stage, userQuery, yearFrom, yearTo, workspaceOpen, onToggleWorkspace,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  placeholder: string;
  inputDisabled: boolean;
  sending: boolean;
  config: ChatConfig;
  setConfig: (c: ChatConfig) => void;
  inputRef: RefObject<HTMLInputElement>;
  stage: string;
  userQuery?: string;
  yearFrom?: number;
  yearTo?: number;
  workspaceOpen?: boolean;
  onToggleWorkspace?: () => void;
}) {
  return (
    <div className="shrink-0 px-6 pb-5 pt-2">
      <div className="max-w-4xl mx-auto">
        {/* 输入框上方一行：工作台入口（图标 + 文字，语义自明；左侧放置） */}
        <div className="flex items-center mb-1">
          {onToggleWorkspace && (
            <button
              type="button"
              onClick={onToggleWorkspace}
              title="工作台概览：当前子研究的检索记录 / 领域地图 / 论文推荐 / 深入研究"
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
                workspaceOpen
                  ? "border border-gold/40 bg-gold/10 text-gold-light"
                  : "text-ink-muted hover:text-ink hover:bg-paper-warm"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              工作台
            </button>
          )}
        </div>
        <div className="glow-shell">
          <div className="glow-inner">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className="flex-1 min-w-0 bg-transparent border-0 outline-none focus:ring-0 focus:ring-transparent h-9 text-base leading-normal text-ink placeholder:text-ink-faint"
                disabled={inputDisabled}
              />
              <button
                onClick={() => onSend()}
                disabled={inputDisabled || !input.trim()}
                className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-gold-light to-gold-hover flex items-center justify-center text-[#171614] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 配置工具栏 */}
        <div className="mt-2 flex justify-center">
          <ChatConfigBar config={config} onChange={setConfig} />
        </div>

        {stage === "confirming" && userQuery && (
          <div className="mt-2 flex items-center gap-3 text-xs text-ink-faint">
            <span>方向：<span className="text-ink-secondary">{userQuery.slice(0, 40)}</span></span>
            {yearFrom && <span>年份：{yearFrom}-{yearTo}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
