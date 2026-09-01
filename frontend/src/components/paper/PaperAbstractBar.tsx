"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";

/**
 * 中栏 PDF 视图顶部的可折叠摘要条。
 * 默认收起（只留标题 + 两行预览），点开显示完整摘要——PDF 阅读不被遮挡，摘要入口常在。
 * 摘要为空时不渲染。
 */
export function PaperAbstractBar({ abstract, abstractSource = "" }: { abstract?: string | null; abstractSource?: string }) {
  const [open, setOpen] = useState(false);
  const text = abstract?.trim();
  if (!text) return null;

  const isAiTldr = abstractSource === "ai_tldr";

  return (
    <div className="shrink-0 border-b border-line bg-paper-warm/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-paper-warm transition-colors"
        title={open ? "收起摘要" : "展开摘要"}
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-ink-faint shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-ink-faint shrink-0" />
        )}
        <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-xs font-medium text-ink-secondary shrink-0">摘要</span>
        {isAiTldr && (
          <span className="text-[10px] px-1.5 py-px rounded-full border border-[#C27BA0]/30 text-[#C27BA0] bg-[#C27BA0]/10 whitespace-nowrap shrink-0">
            AI 概要
          </span>
        )}
        {!open && (
          <span className="flex-1 min-w-0 text-xs text-ink-faint truncate">{text}</span>
        )}
      </button>
      {open && (
        <p className="px-4 pb-3 pt-1 text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap border-t border-line/60">
          {text}
          {isAiTldr && <span className="block text-xs text-ink-faint mt-1.5">以上为 AI 生成概要（非原文摘要）</span>}
        </p>
      )}
    </div>
  );
}
