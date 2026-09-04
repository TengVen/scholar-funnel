"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import type { RunDetail, Paper, PaperRecommendation } from "@/types/dto";
import { listPapers } from "@/lib/api/search";
import { PaperCard } from "./PaperCard";
import { ResultsToolbar, type SearchView } from "./ResultsToolbar";

/**
 * 检索页「已推荐」视图（2026-09-03 产品拍板）：
 * - 对话端推荐的论文单独成视图，主列表剔除（不杂糅）
 * - 卡片样式与主列表完全一致（同一 PaperCard：关键词 / 年份 / 被引 / 摘要 / 外链 / 深入研究）
 * - 仅多一行推荐信息（分类徽章 + 一句话理由 + 召回依据）
 * - 视图切换在工具栏同栏（与排序、筛选并排）；无搜索框
 */
interface RecommendedPanelProps {
  run: RunDetail;
  projectId: number;
  view: SearchView;
  recCount: number;
  onViewChange: (v: SearchView) => void;
  onOpenPaper: (paperId: number) => void;
}

export function RecommendedPanel({
  run, projectId, view, recCount, onViewChange, onOpenPaper,
}: RecommendedPanelProps) {
  // 推荐条目（保持认知结构三分类顺序：奠基 → 主流 → 前沿）
  const recs = useMemo<(PaperRecommendation & { paper_id: number })[]>(() => {
    const cs = run.cognitive;
    if (!cs) return [];
    return (["foundation", "mainstream", "frontier"] as const).flatMap((cat) =>
      (cs[cat] ?? []).map((p) => ({
        category: cat,
        one_liner: p.one_liner ?? p.reason,
        recall_basis: p.recall_basis,
        paper_id: p.paper_id,
      })),
    );
  }, [run]);

  const ids = useMemo(
    () => recs.map((r) => r.paper_id).filter((id): id is number => id != null),
    [recs],
  );
  const idKey = ids.join(",");

  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);

  // 推荐论文完整数据（复用列表接口 include_paper_ids → 与主列表同一数据结构与卡片样式）
  useEffect(() => {
    if (!projectId || ids.length === 0) {
      setPapers([]);
      return;
    }
    let alive = true;
    setLoading(true);
    listPapers({ project_id: projectId, include_paper_ids: ids, page_size: 100 })
      .then((res) => { if (alive) setPapers(res.papers); })
      .catch(() => { /* 静默：推荐数据失败不打断检索页 */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, idKey]);

  // 按认知结构顺序排列（接口返回顺序不稳定）
  const recById = new Map(recs.map((r) => [r.paper_id, r] as const));
  const ordered = recs
    .map((r) => papers.find((p) => p.id === r.paper_id))
    .filter((p): p is Paper => p != null);

  if (recs.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ResultsToolbar total={0} view={view} recCount={recCount} onViewChange={onViewChange} />
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-faint">
          <BookOpen className="w-6 h-6 opacity-40" />
          <p className="text-base">该次检索暂无核心推荐</p>
          <p className="text-sm">对话端生成认知结构后，推荐论文会出现在这里</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ResultsToolbar total={ordered.length} view={view} recCount={recCount} onViewChange={onViewChange} />
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loading && ordered.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-line border-t-gold rounded-full animate-spin" />
          </div>
        ) : (
          ordered.map((p) => (
            <PaperCard
              key={p.id}
              paper={p}
              onOpenPaper={onOpenPaper}
              recommendation={recById.get(p.id) ?? null}
            />
          ))
        )}
      </div>
    </div>
  );
}
