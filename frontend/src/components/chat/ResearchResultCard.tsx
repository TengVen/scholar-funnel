"use client";

import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import type { DeepResearchAttachments, DeepResearchCandidate } from "@/types/dto";
import type { Category } from "@/types/domain";
import { CATEGORY_SECTION, CATEGORY_META } from "@/config/categories";
import { PaperNavRow } from "./PaperNavRow";

/**
 * L3 深度调研结果卡（L3Renderer）：论文 = 研究资产。
 * 候选按"建议归类"分组展示；成果指标 + "查看检索过程"折叠；
 * 操作收敛：论文点击进入详情页（问答/研究脉络在详情页）。
 */
interface ResearchResultCardProps {
  att: DeepResearchAttachments;
  projectId?: number | null;
}

const GROUP_ORDER: Category[] = ["foundation", "mainstream", "frontier"];

export function ResearchResultCard({ att, projectId }: ResearchResultCardProps) {
  const [showProcess, setShowProcess] = useState(false);
  const metrics = att.metrics;

  const groups = GROUP_ORDER.map((cat) => ({
    cat,
    papers: (att.candidates ?? []).filter((c) => c.suggested_category === cat),
  })).filter((g) => g.papers.length > 0);

  return (
    <div className="max-w-[85%] w-full rounded-2xl card overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-[#C27BA0]" />
        <p className="text-base font-medium text-ink">深度调研完成</p>
      </div>

      {metrics && (
        <div className="px-4 grid grid-cols-4 gap-2 mb-2">
          <Stat label="核心论文" value={metrics.core_papers} />
          <Stat label="新增文献" value={metrics.new_papers} />
          <Stat label="骨架候选" value={metrics.skeleton_candidates} />
          <Stat label="研究探针" value={metrics.research_probes} />
        </div>
      )}

      {groups.length > 0 && (
        <div className="px-4 pb-2 space-y-3">
          {groups.map(({ cat, papers }) => {
            const meta = CATEGORY_SECTION[cat];
            return (
              <div key={cat}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: meta.dot }} />
                  <span className={`text-sm ${meta.color}`}>{CATEGORY_META[cat].label} · {papers.length} 篇</span>
                </div>
                <div className="space-y-1.5">
                  {papers.map((c) => (
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
            {att.probes.slice(0, 3).map((p) => (
              <span key={p.probe} className="text-2xs px-2 py-0.5 rounded-full border border-[#C27BA0]/30 text-[#C27BA0]">
                {p.probe}
              </span>
            ))}
            {att.probes.length > 3 && (
              <span className="text-2xs text-ink-faint">+{att.probes.length - 3}</span>
            )}
          </div>
        </div>
      )}

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => setShowProcess((v) => !v)}
          className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors"
        >
          {showProcess ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          查看检索过程
        </button>
      </div>

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

function CandidateRow({ candidate, projectId }: { candidate: DeepResearchCandidate; projectId?: number | null }) {
  return (
    <PaperNavRow
      title={candidate.title}
      meta={[
        candidate.year ? String(candidate.year) : "",
        candidate.authors_note ?? "",
        candidate.cited_by_count ? `被引 ${candidate.cited_by_count}` : "",
      ]}
      reason={candidate.reason}
      href={`/paper/${candidate.paper_id}${projectId ? `?project_id=${projectId}&auto=1&persist=1` : ""}`}
    />
  );
}
