"use client";

import type { SearchResult } from "@/lib/api";

interface StatsBarProps {
  result: SearchResult;
}

export function StatsBar({ result }: StatsBarProps) {
  const trace = result.trace as Record<string, Record<string, number>>;
  const timing = trace?.timing || {};

  const steps = [
    { label: "意图拆解", key: "step1_decomposition" },
    { label: "文献召回", key: "step2_recall" },
    { label: "BGE 重排", key: "step3_rerank" },
    { label: "入库", key: "step5_storage" },
  ];

  return (
    <div className="flex items-center gap-5 px-6 py-2 bg-paper-warm border-b border-line text-[12px] shrink-0">
      {/* Summary */}
      <span className="badge-green">完成</span>
      <span className="text-ink-muted">
        召回 <span className="text-ink font-medium">{result.total_found}</span> ·
        重排 <span className="text-ink font-medium">{result.after_rerank}</span> ·
        新增 <span className="text-ink font-medium">{result.new_saved}</span>
      </span>
      {result.survey_count > 0 && (
        <span className="text-ink-muted">
          综述 <span className="text-accent font-medium">{result.survey_count}</span>
        </span>
      )}

      <span className="w-px h-3 bg-line" />

      {/* Timing */}
      <div className="flex items-center gap-3">
        {steps.map((s) => {
          const sec = timing[s.key];
          if (sec === undefined) return null;
          return (
            <span key={s.key} className="text-ink-muted">
              {s.label}{" "}
              <span className={sec > 10 ? "text-warn font-medium" : "text-ink-secondary"}>
                {sec}s
              </span>
            </span>
          );
        })}
        {timing.total !== undefined && (
          <span className="text-ink font-medium pl-1 border-l border-line">
            总计 {timing.total}s
          </span>
        )}
      </div>

      {/* Expanded queries */}
      {result.expanded_queries?.length > 0 && (
        <>
          <span className="w-px h-3 bg-line" />
          <div className="flex items-center gap-1.5 overflow-x-auto min-w-0">
            {result.expanded_queries.slice(0, 4).map((q, i) => (
              <span key={i} className="badge-blue whitespace-nowrap">
                {q}
              </span>
            ))}
            {result.expanded_queries.length > 4 && (
              <span className="text-ink-faint">
                +{result.expanded_queries.length - 4}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
