"use client";

import {
  ChevronLeft,
  ChevronRight,
  Inbox,
} from "lucide-react";
import { PaperCard } from "./PaperCard";
import type { Paper } from "@/types/dto";
import type { SortSpec } from "@/types/domain";
import { PAGE_SIZE, SORT_OPTIONS, FILTER_OPTIONS, DEFAULT_SORT } from "@/config/search";

interface PaperListProps {
  papers: Paper[];
  total: number;
  page: number;
  loading: boolean;
  sortBy: SortSpec[];
  filterSurvey: string;
  gapActive: boolean;
  onToggleGap: () => void;
  onSortChange: (by: SortSpec[]) => void;
  onFilterChange: (filter: string) => void;
  onPageChange: (page: number) => void;
  onAddToCart: (paperId: number) => void;
}

export function PaperList({
  papers,
  total,
  page,
  loading,
  sortBy,
  filterSurvey,
  gapActive,
  onToggleGap,
  onSortChange,
  onFilterChange,
  onPageChange,
  onAddToCart,
}: PaperListProps) {
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  // 三态循环：未选 → 选中↓ → 换向↑ → 取消；全部取消则回退默认"相关度↓"
  // 优先级 = 点击顺序：后点的字段排最前成为主排序（立即生效）
  const handleSortClick = (field: string) => {
    const idx = sortBy.findIndex((s) => s.field === field);
    let next: SortSpec[];
    if (idx === -1) {
      // 未选中 → 加入（降序 ↓），放在最前成为主排序
      next = [{ field, order: "desc" }, ...sortBy];
    } else if (sortBy[idx].order === "desc") {
      // 当前 ↓ → 换向 ↑
      next = sortBy.map((s, i) => (i === idx ? { ...s, order: "asc" } : s));
    } else {
      // 当前 ↑ → 取消
      next = sortBy.filter((s) => s.field !== field);
      if (next.length === 0) next = [...DEFAULT_SORT];
    }
    onSortChange(next);
  };

  if (papers.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Inbox className="w-10 h-10 text-ink-faint mx-auto" />
          <p className="text-ink-muted text-[13px]">
            输入研究方向，开始检索文献
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-line-light bg-paper-white shrink-0">
        <div className="flex items-center gap-3">
          {/* 联合排序（多选，每个字段独立上下箭头） */}
          <div className="flex items-center gap-1">
            {SORT_OPTIONS.map((opt) => {
              const spec = sortBy.find((s) => s.field === opt.value);
              const selected = !!spec;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleSortClick(opt.value)}
                  title={`${selected ? "点击切换方向/取消" : "点击加入排序"}`}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[12px] transition-colors ${
                    selected
                      ? "bg-accent-light text-gold-light font-medium border border-gold/30"
                      : "text-ink-muted hover:text-ink-secondary border border-transparent"
                  }`}
                >
                  {opt.label}
                  {selected && (
                    <span className="text-[11px] text-gold leading-none">
                      {spec.order === "desc" ? "↓" : "↑"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <span className="w-px h-3 bg-line" />

          {/* Filter */}
          <div className="flex items-center gap-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onFilterChange(opt.value)}
                className={`px-2 py-1 rounded text-[12px] transition-colors ${
                  filterSurvey === opt.value
                    ? "bg-accent-light text-accent font-medium"
                    : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}

            <span className="w-px h-3 bg-line mx-0.5" />

            {/* 重检索（缺口补充结果）切换 */}
            <button
              onClick={onToggleGap}
              className={`px-2 py-1 rounded text-[12px] transition-colors ${
                gapActive
                  ? "bg-violet-500/15 text-violet-300 font-medium"
                  : "text-ink-muted hover:text-violet-300/70"
              }`}
              title="查看缺口补充检索的候选论文"
            >
              ⚡ 重检索
            </button>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-muted">
            {total} 篇 · {page + 1}/{maxPage + 1}
          </span>
          <button
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
            className="btn-ghost p-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            disabled={page >= maxPage}
            onClick={() => onPageChange(page + 1)}
            className="btn-ghost p-1"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Paper list：有数据时重拉不清空旧列表（避免闪烁），仅空态才显示 spinner */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loading && papers.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-line border-t-gold rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {loading && <div className="h-0.5 rounded-full bg-line overflow-hidden"><div className="h-full w-1/3 bg-gold/60 rounded-full animate-pulse" /></div>}
            {papers.map((paper) => (
              <PaperCard key={paper.id} paper={paper} onAddToCart={onAddToCart} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
