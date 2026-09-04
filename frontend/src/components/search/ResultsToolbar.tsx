"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SortSpec } from "@/types/domain";
import { SORT_OPTIONS, FILTER_OPTIONS, DEFAULT_SORT } from "@/config/search";

/**
 * 检索结果工具栏（主列表与「已推荐」视图共用，视图切换与排序/筛选同栏）：
 * - 视图 chip：已推荐(n) / 全部结果（同一栏，与排序、筛选并排）
 * - 排序（三态循环，后点优先）/ 筛选（全部·综述·非综述）/ 分页：可选，
 *   不传即不渲染（推荐论文为固定集合，无需排序筛选分页）
 */
export type SearchView = "list" | "recommended";

interface ResultsToolbarProps {
  total: number;
  // 视图切换：仅 run 上下文进入时提供（无 run 时不渲染 chip）
  view?: SearchView;
  recCount?: number;
  onViewChange?: (v: SearchView) => void;
  page?: number;
  maxPage?: number;
  sortBy?: SortSpec[];
  filterSurvey?: string;
  onSortChange?: (by: SortSpec[]) => void;
  onFilterChange?: (filter: string) => void;
  onPageChange?: (page: number) => void;
}

export function ResultsToolbar({
  total,
  view,
  recCount,
  onViewChange,
  page,
  maxPage,
  sortBy,
  filterSurvey,
  onSortChange,
  onFilterChange,
  onPageChange,
}: ResultsToolbarProps) {
  // 三态循环：未选 → 选中↓ → 换向↑ → 取消；全部取消则回退默认"相关度↓"
  // 优先级 = 点击顺序：后点的字段排最前成为主排序（立即生效）
  const handleSortClick = (field: string) => {
    if (!sortBy || !onSortChange) return;
    const idx = sortBy.findIndex((s) => s.field === field);
    let next: SortSpec[];
    if (idx === -1) {
      next = [{ field, order: "desc" }, ...sortBy];
    } else if (sortBy[idx].order === "desc") {
      next = sortBy.map((s, i) => (i === idx ? { ...s, order: "asc" } : s));
    } else {
      next = sortBy.filter((s) => s.field !== field);
      if (next.length === 0) next = [...DEFAULT_SORT];
    }
    onSortChange(next);
  };

  const viewChip = (active: boolean) =>
    active
      ? "px-2 py-1 rounded text-sm transition-colors bg-accent-light text-gold-light font-medium border border-gold/30"
      : "px-2 py-1 rounded text-sm transition-colors text-ink-muted hover:text-ink-secondary border border-transparent";

  return (
    <div className="flex items-center justify-between px-6 py-2 border-b border-line-light bg-paper-white shrink-0">
      <div className="flex items-center gap-3">
        {/* 视图切换：已推荐（对话推荐论文） / 全部结果（与排序、筛选同栏） */}
        {view && recCount !== undefined && onViewChange ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onViewChange("recommended")} className={viewChip(view === "recommended")}>
              已推荐 {recCount}
            </button>
            <button type="button" onClick={() => onViewChange("list")} className={viewChip(view === "list")}>
              全部结果
            </button>
          </div>
        ) : null}

        {/* 联合排序（多选，每个字段独立上下箭头）——推荐视图不渲染 */}
        {sortBy && onSortChange && (
          <>
            <span className="w-px h-3 bg-line" />
            <div className="flex items-center gap-1">
              {SORT_OPTIONS.map((opt) => {
                const spec = sortBy.find((s) => s.field === opt.value);
                const selected = !!spec;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleSortClick(opt.value)}
                    title={selected ? "点击切换方向/取消" : "点击加入排序"}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-sm transition-colors ${
                      selected
                        ? "bg-accent-light text-gold-light font-medium border border-gold/30"
                        : "text-ink-muted hover:text-ink-secondary border border-transparent"
                    }`}
                  >
                    {opt.label}
                    {selected && (
                      <span className="text-xs text-gold leading-none">
                        {spec.order === "desc" ? "↓" : "↑"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* 筛选（全部 / 综述 / 非综述）——推荐视图不渲染 */}
        {filterSurvey && onFilterChange && (
          <>
            <span className="w-px h-3 bg-line" />
            <div className="flex items-center gap-1">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onFilterChange(opt.value)}
                  className={`px-2 py-1 rounded text-sm transition-colors ${
                    filterSurvey === opt.value
                      ? "bg-accent-light text-accent font-medium"
                      : "text-ink-muted hover:text-ink-secondary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 分页 / 计数 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-muted">
          {total} 篇{page !== undefined && maxPage !== undefined ? ` · ${page + 1}/${maxPage + 1}` : ""}
        </span>
        {onPageChange && page !== undefined && maxPage !== undefined && (
          <>
            <button disabled={page === 0} onClick={() => onPageChange(page - 1)} className="btn-ghost p-1">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button disabled={page >= maxPage} onClick={() => onPageChange(page + 1)} className="btn-ghost p-1">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
