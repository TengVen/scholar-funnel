"use client";

/**
 * 探针模式结果卡（probe_match / ai_suggest 共用）
 *
 * probe_match 增强（跨领域重构后）：
 *  - 双徽章：置信度 + 方法角色（usage_role，六色冷调，金色不进徽章）
 *  - 「与探针关系 / 应用方式 / 发现」三条带色标行（应用=implementation_or_application，兼容回填 optimization_method）
 *  - 「证据 · N」折叠引用块（EvidenceList）
 * ai_suggest 保持旧布局（发现=suggested_probe，方法=probe_reason）
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { BranchPaperResult, EvidenceItem } from "@/types/dto";
import type { UsageRole } from "@/types/domain";
import { CONFIDENCE_MAP, LEVEL_LABELS, ROLE_MAP } from "@/config/categories";
import { EvidenceList } from "./EvidenceList";

export function BranchSquareCard({ paper, mode }: { paper: BranchPaperResult; mode: string }) {
  const [expanded, setExpanded] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const confidence = CONFIDENCE_MAP[paper.probe_confidence] || CONFIDENCE_MAP.none;
  const levelLabel = LEVEL_LABELS[paper.content_level] || "未知";
  const isProbe = mode === "probe_match";

  const role =
    paper.usage_role && paper.usage_role in ROLE_MAP
      ? ROLE_MAP[paper.usage_role as UsageRole]
      : null;
  const evidence = (paper.evidence as EvidenceItem[] | undefined) || [];
  // 兼容：新后端返回 implementation_or_application，旧数据只有 optimization_method
  const application = paper.implementation_or_application || paper.optimization_method;

  return (
    <div className="card px-4 py-3.5 flex flex-col min-h-[150px]">
      {/* Top row: title + badges */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-serif text-[13px] font-semibold text-ink leading-snug flex-1 line-clamp-2">
          {paper.title}
        </h4>
        <div className="flex items-center gap-1.5 shrink-0">
          {isProbe && <span className={`badge ${confidence.cls}`}>{confidence.label}</span>}
          {isProbe && role && (
            <span
              className="badge whitespace-nowrap"
              style={{ background: role.bg, border: `1px solid ${role.border}`, color: role.text }}
            >
              {role.label}
            </span>
          )}
        </div>
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

      {/* Method summary */}
      {paper.method_summary && (
        <p className="mt-2 text-[12px] text-ink-secondary leading-relaxed line-clamp-3 flex-1">
          {paper.method_summary}
        </p>
      )}

      {/* Probe 增强行：与探针 / 应用 / 发现 */}
      {isProbe ? (
        (paper.probe_relation || application || paper.key_findings) && (
          <div className="mt-1.5 space-y-0.5">
            {paper.probe_relation && (
              <p className="text-[11px] text-ink-muted line-clamp-2 flex items-start gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded shrink-0 mt-px flex items-center justify-center text-[10px]"
                  style={{ background: "rgba(120,170,255,0.16)", color: "#9FC4FF" }}
                >
                  ⇢
                </span>
                <span>
                  <span className="text-ink-secondary font-medium">与探针：</span>
                  {paper.probe_relation}
                </span>
              </p>
            )}
            {application && (
              <p className="text-[11px] text-ink-muted line-clamp-2 flex items-start gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded shrink-0 mt-px flex items-center justify-center text-[10px]"
                  style={{ background: "rgba(95,207,190,0.16)", color: "#8FE3DA" }}
                >
                  ✦
                </span>
                <span>
                  <span className="text-ink-secondary font-medium">应用：</span>
                  {application}
                </span>
              </p>
            )}
            {paper.key_findings && (
              <p className="text-[11px] text-ink-muted line-clamp-2">
                <span className="text-gold-light font-medium">发现：</span>
                {paper.key_findings}
              </p>
            )}
          </div>
        )
      ) : (paper.key_findings || paper.optimization_method) ? (
        <div className="mt-1.5 space-y-0.5">
          {paper.key_findings && (
            <p className="text-[11px] text-ink-muted line-clamp-2">
              <span className="text-ink-secondary font-medium">发现：</span>
              {paper.key_findings}
            </p>
          )}
          {paper.optimization_method && (
            <p className="text-[11px] text-ink-muted line-clamp-2">
              <span className="text-ink-secondary font-medium">方法：</span>
              {paper.optimization_method}
            </p>
          )}
        </div>
      ) : null}

      {/* Evidence 折叠区（默认收起，计数角标） */}
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
