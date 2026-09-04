"use client";

import { Inbox } from "lucide-react";
import { PaperCard } from "./PaperCard";
import { ResultsToolbar, type SearchView } from "./ResultsToolbar";
import type { Paper } from "@/types/dto";
import type { SortSpec } from "@/types/domain";
import { PAGE_SIZE } from "@/config/search";

/** 检索结果列表（「全部结果」视图：排序 / 筛选 / 分页 + 论文卡） */
interface PaperListProps {
  papers: Paper[];
  total: number;
  page: number;
  loading: boolean;
  sortBy: SortSpec[];
  filterSurvey: string;
  // 视图切换：仅 run 上下文进入时提供（无 run 时工具栏不显示「已推荐」chip）
  view?: SearchView;
  recCount?: number;
  onViewChange?: (v: SearchView) => void;
  onSortChange: (by: SortSpec[]) => void;
  onFilterChange: (filter: string) => void;
  onPageChange: (page: number) => void;
  onOpenPaper: (paperId: number) => void;
}

export function PaperList({
  papers,
  total,
  page,
  loading,
  sortBy,
  filterSurvey,
  view,
  recCount,
  onViewChange,
  onSortChange,
  onFilterChange,
  onPageChange,
  onOpenPaper,
}: PaperListProps) {
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ResultsToolbar
        total={total}
        page={page}
        maxPage={maxPage}
        sortBy={sortBy}
        filterSurvey={filterSurvey}
        view={view}
        recCount={recCount}
        onViewChange={onViewChange}
        onSortChange={onSortChange}
        onFilterChange={onFilterChange}
        onPageChange={onPageChange}
      />

      {/* Paper list：有数据时重拉不清空旧列表（避免闪烁），仅空态才显示 spinner */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loading && papers.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-line border-t-gold rounded-full animate-spin" />
          </div>
        ) : papers.length === 0 && !loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Inbox className="w-10 h-10 text-ink-faint mx-auto" />
              <p className="text-ink-muted text-base">
                {recCount ? "暂无其它论文，可查看已推荐" : "输入研究方向，开始检索文献"}
              </p>
            </div>
          </div>
        ) : (
          <>
            {loading && <div className="h-0.5 rounded-full bg-line overflow-hidden"><div className="h-full w-1/3 bg-gold/60 rounded-full animate-pulse" /></div>}
            {papers.map((paper) => (
              <PaperCard key={paper.id} paper={paper} onOpenPaper={onOpenPaper} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
