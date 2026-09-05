"use client";

import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, ExternalLink, RefreshCw, PenLine } from "lucide-react";
import type { DeepResearchAttachments, DeepResearchCandidate } from "@/types/dto";
import type { Category } from "@/types/domain";
import { CATEGORY_SECTION, CATEGORY_META } from "@/config/categories";
import { PaperAbstractRow } from "./PaperAbstractRow";

/**
 * L3 深度调研结果卡（L3Renderer）：论文 = 研究资产。
 * 候选按"建议归类"分组展示；成果指标 + "查看检索过程"折叠；
 * 每组默认折叠为前 3 篇，底部「展开全部核心推荐」与 L2 卡同语言；
 * 「查看所有检索结果」直达该 run 的检索页（2026-09-05 与 L2 认知卡入口一致）。
 * 0 召回（attachments.empty）：渲染"未召回"卡——原因人话 + 「去限定重跑 / 修改方向」两个动作
 * （2026-09-05，替换原来全 0 的"完成卡"）。
 * 操作收敛：论文点击进入详情页（问答/研究脉络在详情页）。
 */
interface ResearchResultCardProps {
  att: DeepResearchAttachments;
  projectId?: number | null;
  onOpenSearchResults?: (projectId: number, runId?: number | null) => void;
  /** 0 召回：「去掉时间/类型限定重试」（query=后端清洗过年份的方向） */
  onEmptyRetry?: (query: string) => void;
  /** 0 召回：「修改方向再试」→ 回填输入框 */
  onEmptyEdit?: (query: string) => void;
}

const GROUP_ORDER: Category[] = ["foundation", "mainstream", "frontier"];
const PER_GROUP_COLLAPSED = 3;   // 折叠态每组展示条数（与 L2 认知卡一致）

export function ResearchResultCard({ att, projectId, onOpenSearchResults, onEmptyRetry, onEmptyEdit }: ResearchResultCardProps) {
  const [showAll, setShowAll] = useState(false);
  const [showProcess, setShowProcess] = useState(false);
  const metrics = att.metrics;

  // 0 召回：不再渲染"完成 0 篇"成功卡，改出未召回卡（原因 + 两个动作）
  if (att.empty?.reason) {
    return <EmptyResultCard empty={att.empty} onRetry={onEmptyRetry} onEdit={onEmptyEdit} />;
  }

  const groups = GROUP_ORDER.map((cat) => ({
    cat,
    papers: (att.candidates ?? []).filter((c) => c.suggested_category === cat),
  })).filter((g) => g.papers.length > 0);
  const shownTotal = (att.candidates ?? []).length;

  return (
    <div className="max-w-[85%] w-full rounded-2xl card bg-paper-chrome overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-status-running" />
        <p className="text-base font-medium text-ink">深度调研完成</p>
      </div>

      {metrics && (
        <div className="px-4 grid grid-cols-3 gap-2 mb-2">
          <Stat label="核心论文" value={metrics.core_papers} />
          <Stat label="新增文献" value={metrics.new_papers} />
          <Stat label="研究探针" value={metrics.research_probes} />
        </div>
      )}

      {groups.length > 0 && (
        <div className="px-4 pb-2 space-y-3">
          {groups.map(({ cat, papers }) => {
            const meta = CATEGORY_SECTION[cat];
            const visible = showAll ? papers : papers.slice(0, PER_GROUP_COLLAPSED);
            return (
              <div key={cat}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: meta.dot }} />
                  <span className={`text-sm ${meta.color}`}>{CATEGORY_META[cat].label} · {papers.length} 篇</span>
                </div>
                <div className="space-y-1.5">
                  {visible.map((c) => (
                    <CandidateRow key={c.paper_id} candidate={c} projectId={projectId} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {att.probes && att.probes.length > 0 && (
        <div className="px-4 pb-2">
          <p className="text-xs text-ink-muted mb-1">研究探针</p>
          <div className="flex flex-wrap gap-1.5">
            {att.probes.map((p) => (
              <span key={p.probe} className="text-2xs px-2 py-0.5 rounded-full border border-status-running/30 text-status-running">
                {p.probe}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 底部操作行：展开/收起核心推荐 + 查看所有检索结果 + 检索过程（与 L2 认知卡同语言） */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1 text-xs !py-1.5 px-3 rounded-md bg-gold/10 border border-gold/40 text-gold-deep hover:bg-gold/20 hover:border-gold/60 transition-colors backdrop-blur-sm"
          >
            {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showAll ? "收起" : `展开全部核心推荐（${shownTotal} 篇）`}
          </button>
          {onOpenSearchResults && projectId && (
            <button
              type="button"
              onClick={() => onOpenSearchResults(projectId, att.run_id)}
              className="inline-flex items-center gap-1 btn-secondary text-xs !py-1.5"
            >
              <ExternalLink className="w-3 h-3" />
              查看所有检索结果
            </button>
          )}
          {att.process && (
            <button
              type="button"
              onClick={() => setShowProcess((v) => !v)}
              className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors ml-auto"
            >
              {showProcess ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              查看检索过程
            </button>
          )}
        </div>
      )}

      {showProcess && att.process && (
        <div className="mx-4 mb-3 rounded-lg border border-line bg-paper-warm/50 px-3 py-2 text-xs text-ink-faint leading-relaxed">
          主干召回 {att.process.total_found} 篇 → 入库 {att.process.new_saved} 篇
          {att.process.survey_count > 0 ? `（其中综述 ${att.process.survey_count} 篇）` : ""}
          → 形成核心候选 {metrics?.core_papers ?? 0} 篇
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-paper-warm/50 px-2 py-1.5 text-center">
      <p className="text-base font-medium text-ink tabular-nums">{value}</p>
      <p className="text-2xs text-ink-faint">{label}</p>
    </div>
  );
}

/** 0 召回卡：原因人话 + 两个动作（去限定重跑 / 修改方向再试），不复用成功卡结构 */
function EmptyResultCard({ empty, onRetry, onEdit }: {
  empty: NonNullable<DeepResearchAttachments["empty"]>;
  onRetry?: (query: string) => void;
  onEdit?: (query: string) => void;
}) {
  const q = (empty.query ?? "").trim();
  const retryable = !!q && !!onRetry;
  const title = empty.reason === "filtered"
    ? `检索到 ${empty.found} 篇候选，但都被过滤了`
    : "未召回到文献";
  const body = empty.reason === "filtered"
    ? `按「${q || "该方向"}」找到了 ${empty.found} 篇候选，但相关度过滤后一篇也没剩——方向可能与已有认知偏离，或限定过窄。`
    : `没有检索到「${q || "该方向"}」相关的文献。最常见是方向描述太具体、混入了具体方法名、或年份窗口过窄。`;

  return (
    <div className="max-w-[85%] w-full rounded-2xl card bg-paper-chrome overflow-hidden">
      <div className="px-4 pt-3 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full bg-status-partial shrink-0" />
          <p className="text-base font-medium text-ink">{title}</p>
        </div>
        <p className="text-sm text-ink-secondary leading-relaxed mt-1">
          {body}
        </p>
        <p className="text-xs text-ink-muted mt-1">建议先去限定跑一次全貌，或精简方向描述后重试。</p>

        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => retryable && onRetry?.(q)}
            disabled={!retryable}
            title={retryable ? "自动去掉时间与类型限定，按同一方向重新深度调研（预计 1-2 分钟）" : undefined}
            className="inline-flex items-center gap-1 text-xs !py-1.5 px-3 rounded-md bg-gold/10 border border-gold/40 text-gold-deep hover:bg-gold/20 hover:border-gold/60 transition-colors backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-3 h-3" />
            去掉时间/类型限定重试
          </button>
          <button
            type="button"
            onClick={() => q && onEdit?.(q)}
            disabled={!q || !onEdit}
            className="inline-flex items-center gap-1 btn-secondary text-xs !py-1.5 disabled:opacity-50"
          >
            <PenLine className="w-3 h-3" />
            修改方向再试
          </button>
        </div>
        <p className="text-xs text-ink-faint mt-2 leading-relaxed">
          不影响已入库论文；也可以直接改上方输入框里的方向后重新发送。
        </p>
      </div>
    </div>
  );
}

function CandidateRow({ candidate, projectId }: { candidate: DeepResearchCandidate; projectId?: number | null }) {
  const href = `/paper/${candidate.paper_id}${projectId ? `?project_id=${projectId}&auto=1&persist=1` : ""}`;
  return (
    <PaperAbstractRow
      title={candidate.title}
      meta={[
        candidate.year ? String(candidate.year) : "",
        candidate.authors_note ?? "",
        candidate.cited_by_count ? `被引 ${candidate.cited_by_count}` : "",
      ]}
      reason={candidate.reason}
      href={href}
      paperId={candidate.paper_id}
      projectId={projectId}
    />
  );
}
