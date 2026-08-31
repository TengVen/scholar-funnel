"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Category } from "@/types/domain";

/** 语义补充模式的固定阈值（与关键词模式的滑块默认值一致） */
const SEMANTIC_THRESHOLD = 0.35;

/**
 * 单类别的候选补充入口：关键词补充 / 语义补充 / 标题直达
 *
 * 三个输入态（模式、约束词、相关度阈值）只服务于本面板，随展开/收起或切换类别自动重置。
 */
export function GapFillPanel({
  category, searching, onGapSearch, onTitleLookup,
}: {
  category: Category;
  searching: boolean;
  onGapSearch: (category: Category, constraint?: string, threshold?: number, mode?: string) => void;
  onTitleLookup: (category: Category, title: string) => void;
}) {
  const [mode, setMode] = useState<"search" | "title" | "semantic">("search");
  const [constraint, setConstraint] = useState("");
  const [threshold, setThreshold] = useState(0.35);

  return (
    <div className="mb-2 bg-paper-warm rounded-lg p-2.5">
      {/* 模式切换 */}
      <div className="flex items-center gap-1 mb-2">
        <button
          onClick={() => { setMode("search"); setConstraint(""); }}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            mode === "search"
              ? "bg-accent-light text-accent font-medium"
              : "text-ink-faint hover:text-ink-muted"
          }`}
        >
          关键词补充
        </button>
        <button
          onClick={() => { setMode("title"); setConstraint(""); }}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            mode === "title"
              ? "bg-accent-light text-accent font-medium"
              : "text-ink-faint hover:text-ink-muted"
          }`}
        >
          标题直达
        </button>
        <button
          onClick={() => { setMode("semantic"); }}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            mode === "semantic"
              ? "bg-accent-light text-accent font-medium"
              : "text-ink-faint hover:text-ink-muted"
          }`}
          title="基于该类骨架论文的向量质心，在已入库论文中找语义最相近的候选"
        >
          语义补充
        </button>
      </div>

      {mode === "search" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={constraint}
              onChange={(e) => setConstraint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !searching) {
                  onGapSearch(category, constraint.trim(), threshold);
                }
              }}
              placeholder={`可选：补充约束，如"重点关注变分方法"`}
              className="input flex-1 !py-1.5 !text-sm"
              autoFocus
            />
            <button
              onClick={() => onGapSearch(category, constraint.trim(), threshold)}
              disabled={searching}
              className="btn-secondary text-sm whitespace-nowrap"
            >
              {searching ? "检索中..." : "开始补充"}
            </button>
          </div>
          {/* 相关度阈值滑块 */}
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="whitespace-nowrap">相关度阈值</span>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="flex-1 accent-gold"
            />
            <span className="text-gold-light tabular-nums w-9 text-right">
              {threshold.toFixed(2)}
            </span>
            <span className="whitespace-nowrap text-ink-faint">
              越高越精准，越低越多候选
            </span>
          </div>
        </div>
      ) : mode === "semantic" ? (
        /* 语义补充：基于骨架质心，一键执行（无需输入） */
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted flex-1">
            基于该类骨架论文的向量质心，从已入库论文中找语义最相近的候选（无 LLM 调用，秒级）
          </span>
          <button
            onClick={() => onGapSearch(category, "", SEMANTIC_THRESHOLD, "semantic")}
            disabled={searching}
            className="btn-secondary text-sm whitespace-nowrap"
          >
            {searching ? "分析中..." : "语义补充"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={constraint}
            onChange={(e) => setConstraint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !searching) {
                onTitleLookup(category, constraint.trim());
              }
            }}
            placeholder={`输入论文标题，如"Mask-Aware Transformer"`}
            className="input flex-1 !py-1.5 !text-sm"
            autoFocus
          />
          <button
            onClick={() => onTitleLookup(category, constraint.trim())}
            disabled={searching || !constraint.trim()}
            className="btn-secondary text-sm whitespace-nowrap"
          >
            {searching ? "查找中..." : "直达"}
          </button>
        </div>
      )}
    </div>
  );
}
