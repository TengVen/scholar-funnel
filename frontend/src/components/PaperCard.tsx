"use client";

import { useState } from "react";
import { ExternalLink, Plus, Check, ChevronDown, ChevronUp } from "lucide-react";
import type { Paper } from "@/lib/api";

interface PaperCardProps {
  paper: Paper;
  onAddToCart: (paperId: number) => void;
}

export function PaperCard({ paper, onAddToCart }: PaperCardProps) {
  const [expanded, setExpanded] = useState(false);

  const authors = paper.authors || [];
  const authorDisplay =
    authors.length > 3
      ? `${authors.slice(0, 3).join(", ")} 等 ${authors.length} 人`
      : authors.join(", ");

  const meta: string[] = [];
  if (paper.venue) meta.push(paper.venue);
  if (paper.year) meta.push(String(paper.year));
  if (paper.cited_by_count) meta.push(`被引 ${paper.cited_by_count}`);

  return (
    <div className="card px-5 py-4 transition-colors group">
      {/* Title + badges */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-serif text-[15px] font-semibold leading-snug flex-1
                     bg-gradient-to-br from-gold-bright via-gold-light to-gold
                     bg-clip-text text-transparent">
          {paper.title}
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {paper.is_survey && <span className="badge-blue">综述</span>}
          {paper.arxiv_id && (
            <span className="badge bg-violet-500/15 text-violet-300">arXiv</span>
          )}
          {paper.cited_by_count > 100 && <span className="badge-amber">高被引</span>}
          {paper.trunk_score !== null && (
            <span className="text-[11px] text-gold-light tabular-nums font-mono">
              {paper.trunk_score?.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* Meta line */}
      <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-muted">
        {meta.length > 0 && <span>{meta.join(" · ")}</span>}
        {authorDisplay && (
          <>
            <span className="text-line">|</span>
            <span className="truncate">{authorDisplay}</span>
          </>
        )}
      </div>

      {/* Abstract toggle */}
      {paper.abstract && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink-muted transition-colors"
          >
            {expanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {expanded ? "收起" : "摘要"}
          </button>
          {expanded && (
            <p className="mt-2 text-[13px] text-ink-secondary leading-relaxed">
              {paper.abstract}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-light">
        <button
          onClick={() => onAddToCart(paper.id)}
          disabled={paper.in_cart}
          className={
            paper.in_cart
              ? "btn-ghost text-success text-[12px] cursor-default"
              : "btn-secondary text-[12px]"
          }
        >
          {paper.in_cart ? (
            <>
              <Check className="w-3 h-3 inline mr-1" />
              已加入
            </>
          ) : (
            <>
              <Plus className="w-3 h-3 inline mr-1" />
              加入骨架
            </>
          )}
        </button>

        <div className="flex-1" />

        {paper.doi && (
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[12px]"
          >
            <ExternalLink className="w-3 h-3 inline mr-0.5" />
            DOI
          </a>
        )}
        {paper.arxiv_id && (
          <a
            href={`https://arxiv.org/abs/${paper.arxiv_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[12px]"
          >
            arXiv
          </a>
        )}
        {paper.title && (
          <a
            href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title.slice(0, 120))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[12px]"
          >
            Scholar
          </a>
        )}
      </div>
    </div>
  );
}
