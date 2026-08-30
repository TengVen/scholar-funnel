"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { PaperWhy } from "@/types/dto";
import { ROUTE_LABELS, CONFIDENCE_LABELS } from "@/config/search";

/**
 * "为什么是它" 召回溯源行（P0-A）—— 默认一行可见，点击展开召回路径详情。
 * 数据来源 ai_papers.recall_meta（E2 级结构化事实），仅呈现，无业务逻辑。
 */
interface WhyLineProps {
  why: PaperWhy;
}

export function WhyLine({ why }: WhyLineProps) {
  const [open, setOpen] = useState(false);

  const isSemantic = why.source === "semantic";
  const terms = why.matched_terms ?? [];
  const routes = why.routes ?? [];
  const rerank = why.rerank_score;

  // 一行摘要：语义召回 → "语义相邻 · 相似度 X"；词法召回 → 命中路径 + 命中词 + 相关度
  const summary = isSemantic
    ? `语义相邻 · 相似度 ${(why.similarity ?? 0).toFixed(2)}`
    : `命中${ROUTE_LABELS[routes[0]] ?? routes[0] ?? "召回"}${terms.length > 0 ? `「${terms.slice(0, 3).join("」「")}」` : ""}${rerank != null ? ` · 相关度 ${rerank.toFixed(2)}` : ""}`;
  const conf = why.confidence ? ` · ${CONFIDENCE_LABELS[why.confidence]}` : "";

  return (
    <div className="border-t border-line mt-2 pt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink-secondary transition-colors max-w-full"
        title="展开召回路径"
      >
        <Sparkles className="w-3 h-3 shrink-0 text-accent/80" />
        <span className="truncate">
          为什么是它：{summary}
          {conf}
        </span>
        {open ? (
          <ChevronUp className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0" />
        )}
      </button>

      {open && (
        <div className="mt-1.5 pl-5 flex flex-wrap items-center gap-1.5">
          {routes.map((r) => (
            <span key={r} className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-secondary">
              {ROUTE_LABELS[r] ?? r}
            </span>
          ))}
          {isSemantic && why.similarity != null && (
            <span className="text-xs text-ink-faint">相似度 {why.similarity.toFixed(3)}</span>
          )}
          {rerank != null && (
            <span className="text-xs text-ink-faint">BGE 相关度 {rerank.toFixed(4)}</span>
          )}
          {why.confidence && (
            <span className="text-xs text-ink-faint">{CONFIDENCE_LABELS[why.confidence]}</span>
          )}
        </div>
      )}
    </div>
  );
}
