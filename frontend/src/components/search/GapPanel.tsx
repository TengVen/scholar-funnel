"use client";

import {
  Sparkles, Check, Plus, Loader2, ExternalLink, Github, ArrowLeft, Inbox,
} from "lucide-react";
import type { GapCandidate, GapSearchResult } from "@/types/dto";
import { CATEGORY_META, CONFIDENCE_LABEL } from "@/config/categories";

interface GapPanelProps {
  result: GapSearchResult | null;
  searching: boolean;
  cartPaperIds: Set<number>;
  onAddToCart: (paperId: number, category?: string) => void;
  onExit: () => void;
}

export function GapPanel({
  result,
  searching,
  cartPaperIds,
  onAddToCart,
  onExit,
}: GapPanelProps) {
  if (searching) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-gold-light animate-spin" />
          <p className="text-[13px] text-ink-muted">补充检索中，分析候选论文...</p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部返回栏 */}
        <div className="px-6 py-3 border-b border-line bg-paper-white shrink-0 flex items-center gap-3">
          <button
            onClick={onExit}
            className="btn-ghost text-[12px] flex items-center gap-1"
            title="返回主检索列表"
          >
            <ArrowLeft className="w-3 h-3" />
            返回
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold-light" />
            <span className="font-serif text-[14px] font-semibold text-ink">
              缺口补充检索
            </span>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Inbox className="w-10 h-10 text-ink-faint mx-auto" />
            <p className="text-[13px] text-ink-muted">
              还没有补充检索结果
            </p>
            <p className="text-[12px] text-ink-faint">
              前往「骨架」页，在 奠基理论 / 主流方法 / 最新前沿 旁点击「补充」发起定向检索
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { candidates, status, target_category, total_found } = result;

  // 按推荐类别分组（保持 奠基/主流/前沿 顺序）
  const groups = (["foundation", "mainstream", "frontier"] as const)
    .map((cat) => ({
      cat,
      meta: CATEGORY_META[cat],
      items: candidates.filter((c) => c.recommended_category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-3 border-b border-line bg-paper-white shrink-0 flex items-center gap-3">
        <button
          onClick={onExit}
          className="btn-ghost text-[12px] flex items-center gap-1"
          title="返回主检索列表"
        >
          <ArrowLeft className="w-3 h-3" />
          返回
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gold-light" />
          <span className="font-serif text-[14px] font-semibold text-ink">
            缺口补充检索
          </span>
          <span className="text-[12px] text-ink-muted tabular-nums">
            {candidates.length} 篇候选 · 召回 {total_found} 篇
          </span>
        </div>
        {target_category && (
          <span className="badge bg-violet-500/15 text-violet-300">
            定向：{CATEGORY_META[target_category]?.label ?? target_category}
          </span>
        )}
        {status === "empty" && (
          <span className="badge bg-red-500/15 text-red-400">无结果</span>
        )}
        {status === "low_results" && (
          <span className="badge-amber">候选偏少</span>
        )}
      </div>

      {/* Candidates grouped */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {status === "empty" && (
          <div className="text-center py-10">
            <p className="text-[13px] text-ink-muted">
              未找到满足条件的论文，可尝试在骨架页补充更具体的约束后重试
            </p>
          </div>
        )}

        {groups.map(({ cat, meta, items }) => (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[13px] font-medium text-ink">{meta.label}</span>
              <span className="text-[11px] text-ink-faint">{meta.desc}</span>
              <span className="text-[11px] text-ink-faint tabular-nums">({items.length})</span>
            </div>
            <div className="space-y-2">
              {items.map((c) => (
                <GapCandidateRow
                  key={c.openalex_id}
                  candidate={c}
                  inCart={c.paper_id != null && cartPaperIds.has(c.paper_id)}
                  onAddToCart={onAddToCart}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GapCandidateRow({
  candidate: c,
  inCart,
  onAddToCart,
}: {
  candidate: GapCandidate;
  inCart: boolean;
  onAddToCart: (paperId: number, category?: string) => void;
}) {
  const authors = (c.authors || []).slice(0, 3).join(", ");
  const conf = CONFIDENCE_LABEL[c.confidence as "high" | "medium" | "low"] ?? CONFIDENCE_LABEL.medium;

  return (
    <div className="card px-5 py-4">
      {/* Title + badges */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-serif text-[14px] font-semibold leading-snug flex-1 text-ink">
          {c.title}
        </h4>
        <div className="flex items-center gap-2 shrink-0">
          {c.is_survey && <span className="badge-blue">综述</span>}
          {c.already_in_db && (
            <span className="badge bg-teal-500/15 text-teal-300">已入库</span>
          )}
          {inCart && <span className="badge-amber">已在骨架</span>}
          <span className={conf.cls}>{conf.text}</span>
          {c.similarity != null ? (
            <span className="text-[11px] text-violet-300 tabular-nums font-mono">
              语义 {c.similarity.toFixed(2)}
            </span>
          ) : (
            <span className="text-[11px] text-gold-light tabular-nums font-mono">
              {c.relevance_score.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-muted">
        <span>
          {[c.year, c.cited_by_count > 0 ? `被引 ${c.cited_by_count}` : null, c.venue]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {authors && (
          <>
            <span className="text-line">|</span>
            <span className="truncate">{authors}</span>
          </>
        )}
      </div>

      {/* Reason */}
      {c.reason && (
        <p className="text-[11px] text-gold-light/70 mt-1 flex items-center gap-1">
          <span className="w-1 h-1 rounded-full bg-gold shrink-0" />
          {c.reason}
        </p>
      )}

      {/* Abstract */}
      {c.abstract && (
        <p className="mt-2 text-[12.5px] text-ink-secondary leading-relaxed line-clamp-3">
          {c.abstract.slice(0, 400)}
          {c.abstract.length > 400 ? "..." : ""}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-light">
        <button
          onClick={() => onAddToCart(c.paper_id ?? -1, c.recommended_category)}
          disabled={inCart || c.paper_id == null}
          className={
            inCart || c.paper_id == null
              ? "btn-ghost text-success text-[12px] cursor-default"
              : "btn-secondary text-[12px]"
          }
        >
          {inCart ? (
            <>
              <Check className="w-3 h-3 inline mr-1" />
              已在骨架
            </>
          ) : c.paper_id == null ? (
            <>
              <Plus className="w-3 h-3 inline mr-1" />
              未入库
            </>
          ) : (
            <>
              <Plus className="w-3 h-3 inline mr-1" />
              加入骨架
            </>
          )}
        </button>

        <span className="text-[10.5px] text-ink-faint">
          将加入「{CATEGORY_META[c.recommended_category]?.label ?? c.recommended_category}」
        </span>

        <div className="flex-1" />

        {c.github_url && (
          <a
            href={c.github_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[12px]"
          >
            <Github className="w-3 h-3 inline mr-0.5" />
            GitHub
          </a>
        )}
        <a
          href={`https://openalex.org/${c.openalex_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost text-[12px]"
        >
          <ExternalLink className="w-3 h-3 inline mr-0.5" />
          OpenAlex
        </a>
      </div>
    </div>
  );
}
