"use client";

import {
  ChevronLeft,
  ChevronRight,
  Inbox,
} from "lucide-react";
import { PaperCard } from "./PaperCard";
import type { Paper } from "@/lib/api";

interface PaperListProps {
  papers: Paper[];
  total: number;
  page: number;
  loading: boolean;
  sortBy: string;
  sortOrder: string;
  filterSurvey: string;
  onSortChange: (by: string, order: string) => void;
  onFilterChange: (filter: string) => void;
  onPageChange: (page: number) => void;
  onAddToCart: (paperId: number) => void;
}

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { value: "trunk_score", label: "相关度" },
  { value: "cited_by_count", label: "被引量" },
  { value: "year", label: "年份" },
];

const FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "survey", label: "综述" },
  { value: "non_survey", label: "非综述" },
];

export function PaperList({
  papers,
  total,
  page,
  loading,
  sortBy,
  sortOrder,
  filterSurvey,
  onSortChange,
  onFilterChange,
  onPageChange,
  onAddToCart,
}: PaperListProps) {
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const handleSortClick = (field: string) => {
    if (sortBy === field) {
      onSortChange(field, sortOrder === "desc" ? "asc" : "desc");
    } else {
      onSortChange(field, "desc");
    }
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
          {/* Sort */}
          <div className="flex items-center gap-1">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSortClick(opt.value)}
                className={`px-2 py-1 rounded text-[12px] transition-colors ${
                  sortBy === opt.value
                    ? "bg-accent-light text-accent font-medium"
                    : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {opt.label}
                {sortBy === opt.value && (
                  <span className="ml-0.5">{sortOrder === "desc" ? "↓" : "↑"}</span>
                )}
              </button>
            ))}
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

      {/* Paper list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-line border-t-gold rounded-full animate-spin" />
          </div>
        ) : (
          papers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} onAddToCart={onAddToCart} />
          ))
        )}
      </div>
    </div>
  );
}
