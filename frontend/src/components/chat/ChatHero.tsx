"use client";

import type { KeyboardEvent, RefObject } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import type { ChatConfig } from "@/types/domain";
import { SUGGESTIONS } from "@/config/chat";
import { ChatConfigBar } from "./ChatConfigBar";

/**
 * 初始空态：居中大对话框（品牌区 + 输入框 + 配置栏 + 示例问题）
 *
 * 与对话态底部的 ChatComposer 是两种语境（首屏 vs 对话中），
 * 输入框宽度、按钮图标、是否自动聚焦均不同，故各自独立实现。
 */
export function ChatHero({
  input, setInput, onSend, onKeyDown, placeholder, inputDisabled, sending,
  config, setConfig, inputRef,
}: {
  input: string;
  setInput: (v: string) => void;
  /** 传入文本则以该文本发送（示例问题），否则发送输入框内容 */
  onSend: (text?: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  placeholder: string;
  inputDisabled: boolean;
  sending: boolean;
  config: ChatConfig;
  setConfig: (c: ChatConfig) => void;
  inputRef: RefObject<HTMLInputElement>;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-10">
        {/* 品牌区 */}
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gold-light to-gold-hover flex items-center justify-center mb-5 shadow-lg shadow-gold/10">
          <Sparkles className="w-6 h-6 text-[#171614]" />
        </div>
        <h1 className="font-serif text-[26px] font-semibold bg-gradient-to-br from-gold-bright via-gold-light to-gold bg-clip-text text-transparent">
          Scholar Funnel
        </h1>
        <p className="text-base text-ink-muted mt-2 mb-8 text-center">
          用对话的方式描述研究方向，自动拆解意图、召回并构建文献骨架
        </p>

        {/* 居中输入框（炫彩流光环绕）—— 加宽 */}
        <div className="w-full max-w-3xl glow-shell">
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
                autoFocus
              />
              <button
                onClick={() => onSend()}
                disabled={inputDisabled || !input.trim()}
                className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-gold-light to-gold-hover flex items-center justify-center text-[#171614] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 配置工具栏（输入框下方一排） */}
        <div className="mt-3 w-full max-w-3xl flex justify-center">
          <ChatConfigBar config={config} onChange={setConfig} />
        </div>

        {/* 示例问题 */}
        <div className="mt-6 w-full max-w-3xl">
          <p className="text-xs text-ink-faint mb-3 text-center tracking-wide">
            试试这些研究方向
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                disabled={inputDisabled}
                className="px-3 py-1.5 rounded-full border border-line text-sm text-ink-secondary
                           hover:border-gold/50 hover:text-gold-light hover:bg-accent-light/20
                           transition-colors disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
