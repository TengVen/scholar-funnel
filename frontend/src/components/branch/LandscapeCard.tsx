"use client";

/**
 * 全景扫描结果卡（landscape）—— 9 维方法体系展示
 *
 * 布局（按阅读优先级，2026-08-26 设计稿）：
 *  - method_category 芯片 + method_summary 并排
 *  - research_question 衬线引言块（金色左线，呼应 serif 标题风格）
 *  - methodology_type / research_design 双徽章
 *  - method_components 玻璃徽章组（复用 KEYWORD_COLORS）
 *  - key_innovation / limitations 双栏小卡
 *  - 「证据 · N」折叠引用块（EvidenceList）
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { BranchPaperResult, EvidenceItem } from "@/types/dto";
import { LEVEL_LABELS } from "@/config/categories";
import { KEYWORD_COLORS } from "@/config/keywords";
import { EvidenceList } from "./EvidenceList";

export function LandscapeCard({ paper }: { paper: BranchPaperResult }) {
  const [expanded, setExpanded] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const levelLabel = LEVEL_LABELS[paper.content_level] || "未知";
  const evidence = (paper.evidence as EvidenceItem[] | undefined) || [];
  const components = paper.method_components || [];

  return (
    <div className="card px-4 py-3.5 flex flex-col min-h-[150px]">
      {/* Top row: title + 全景徽章 */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-serif text-[13px] font-semibold text-ink leading-snug flex-1 line-clamp-2">
          {paper.title}
        </h4>
        <span
          className="badge whitespace-nowrap shrink-0"
          style={{
            background: "rgba(95,207,190,0.14)",
            border: "1px solid rgba(95,207,190,0.34)",
            color: "#8FE3DA",
          }}
        >
          全景分析
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 mt-1 text-[11px] text-ink-faint">
        {paper.year && <span>{paper.year}</span>}
        {paper.cited_by_count > 0 && (
          <>
            <span className="text-line">|</span>
            <span>被引 {paper.cited_by_count}</span>
          </>
        )}
        <span className="ml-auto badge bg-paper-warm text-ink-muted px-1.5">
          L{paper.content_level} {levelLabel}
        </span>
      </div>

      {/* 类别芯片 + 方法概览 */}
      {paper.method_summary && (
        <div className="flex gap-2 mt-2 items-start">
          {paper.method_category && (
            <span
              className="px-1.5 py-0.5 rounded text-[10.5px] whitespace-nowrap shrink-0 mt-0.5"
              style={{ background: "rgba(120,170,255,0.14)", color: "#9FC4FF" }}
            >
              {paper.method_category}
            </span>
          )}
          <p className="text-[12px] text-ink-secondary leading-relaxed line-clamp-3 flex-1">
            {paper.method_summary}
          </p>
        </div>
      )}

      {/* 研究问题引言块 */}
      {paper.research_question && (
        <div
          className="mt-2 rounded-md px-3 py-2 bg-paper-warm/60"
          style={{ borderLeft: "2px solid rgba(240,206,110,0.45)" }}
        >
          <p className="font-serif text-[12.5px] text-ink leading-relaxed">
            “{paper.research_question}”
          </p>
        </div>
      )}

      {/* 方法论范式 / 研究设计 双徽章 */}
      {(paper.methodology_type || paper.research_design) && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {paper.methodology_type && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[11px]"
              style={{
                background: "rgba(180,160,240,0.14)",
                border: "1px solid rgba(180,160,240,0.32)",
                color: "#C4B4F5",
              }}
            >
              {paper.methodology_type}
            </span>
          )}
          {paper.research_design && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[11px]"
              style={{
                background: "rgba(110,200,230,0.14)",
                border: "1px solid rgba(110,200,230,0.32)",
                color: "#8FD8EC",
              }}
            >
              {paper.research_design}
            </span>
          )}
        </div>
      )}

      {/* 方法组件玻璃徽章组 */}
      {components.length > 0 && (
        <>
          <p className="text-[11px] text-ink-faint mt-2 mb-1">方法组件</p>
          <div className="flex flex-wrap gap-1">
            {components.slice(0, 8).map((c, i) => (
              <span
                key={c}
                className="px-1.5 py-0.5 rounded-md text-[10.5px] backdrop-blur-sm"
                style={{
                  background: KEYWORD_COLORS[i % KEYWORD_COLORS.length].bg,
                  border: `1px solid ${KEYWORD_COLORS[i % KEYWORD_COLORS.length].border}`,
                  color: KEYWORD_COLORS[i % KEYWORD_COLORS.length].text,
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </>
      )}

      {/* 创新 / 局限 双栏 */}
      {(paper.key_innovation || paper.limitations) && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {paper.key_innovation && (
            <div className="rounded-md px-2.5 py-1.5 bg-paper-warm/60">
              <p className="text-[10.5px] text-gold-light font-medium mb-0.5">创新</p>
              <p className="text-[11.5px] text-ink-secondary leading-relaxed line-clamp-3">
                {paper.key_innovation}
              </p>
            </div>
          )}
          {paper.limitations && (
            <div className="rounded-md px-2.5 py-1.5 bg-paper-warm/60">
              <p className="text-[10.5px] text-ink-faint font-medium mb-0.5">局限</p>
              <p className="text-[11.5px] text-ink-secondary leading-relaxed line-clamp-3">
                {paper.limitations}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Evidence 折叠区 */}
      {evidence.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-line-light">
          <button
            onClick={() => setEvidenceOpen(!evidenceOpen)}
            className="flex items-center gap-1 text-[11px] font-medium transition-colors hover:opacity-80"
            style={{ color: "#8FE3DA" }}
          >
            {evidenceOpen ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            证据 · {evidence.length}
          </button>
          {evidenceOpen && <EvidenceList evidence={evidence} />}
        </div>
      )}

      {paper.error && <p className="mt-2 text-[11px] text-red-400">{paper.error}</p>}

      {/* Footer */}
      <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-line-light">
        {paper.doi && (
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[11px]"
          >
            <ExternalLink className="w-2.5 h-2.5 inline mr-0.5" />
            DOI
          </a>
        )}
        {paper.abstract && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-0.5 text-[11px] text-ink-faint hover:text-ink-muted transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "收起" : "摘要"}
          </button>
        )}
        <div className="flex-1" />
        <span className="text-[10.5px] text-ink-faint">{paper.content_source}</span>
      </div>

      {expanded && paper.abstract && (
        <p className="mt-2 text-[12px] text-ink-secondary leading-relaxed">{paper.abstract}</p>
      )}
    </div>
  );
}
