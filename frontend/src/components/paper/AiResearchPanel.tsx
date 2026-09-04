"use client";

import {
  Loader2, ArrowRight, CheckCircle2, ExternalLink,
  FlaskConical, GitBranch, BookOpen,
} from "lucide-react";
import type { PaperDetail, PaperRef, EvidenceItem, PaperSection } from "@/types/dto";
import { EvidenceBadge } from "./EvidenceBadge";
import { matchSection, type SectionTarget } from "@/lib/paper/sectionLocate";

/**
 * 右栏内容：AI 研究助手（差异化核心；标题行与外壳由 ResizablePanel 提供）
 * - 无分析（L1 浏览）：摘要 + 深入探究引导
 * - 分析中：进度提示
 * - 有分析（L2/L3 信息一致）：六区块（带证据强度标注）+ 原文依据 + 研究脉络
 * 证据标注（产品原则 §十一）：六区块=E3 归纳；原文依据=E1 锚定（可跳章节/PDF）；
 * 研究脉络=E2 元数据。问答交互已迁至左栏 PaperQaBox。
 */
interface AiResearchPanelProps {
  detail: PaperDetail;
  projectId?: number | null;
  exploring: boolean;
  onExplore: () => void;
  onLocate?: (target: SectionTarget) => void;   // 证据锚点跳转（PDF 优先，正文降级）
}

export function AiResearchPanel({ detail, projectId, exploring, onExplore, onLocate }: AiResearchPanelProps) {
  const st = detail.analysis.status;

  return (
    <div className="flex flex-col gap-4 px-4 py-4 flex-1 min-h-0 overflow-y-auto">
      {st === "none" && (
        <L1State detail={detail} projectId={projectId} exploring={exploring} onExplore={onExplore} />
      )}
      {st === "running" && <RunningState />}
      {st === "done" && detail.analysis.content && (
        <AnalysisState detail={detail} onLocate={onLocate} />
      )}
    </div>
  );
}

/* ── L1 浏览态：摘要 + 深入探究 ── */

function L1State({ detail, projectId, exploring, onExplore }: Pick<AiResearchPanelProps, "detail" | "projectId" | "exploring" | "onExplore">) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-line bg-paper-warm/50 px-3 py-2.5">
        <p className="text-xs font-medium text-ink-muted mb-1">摘要</p>
        <p className="text-sm text-ink leading-relaxed line-clamp-6">
          {detail.abstract || "暂无摘要"}
        </p>
      </div>
      <button
        type="button"
        onClick={onExplore}
        disabled={exploring || !projectId}
        className="btn-primary text-sm !py-2 w-full flex items-center justify-center gap-1.5 disabled:opacity-50"
      >
        {exploring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
        深入探究
      </button>
      {!projectId && (
        <p className="text-xs text-ink-faint">需要先选择一个研究项目才能深入探究</p>
      )}
      <p className="text-xs text-ink-muted leading-relaxed">
        深入探究后：自动获取全文 → 生成一句话理解 / 核心贡献 / 方法框架 / 实验结论 / 与当前研究的关系 / 研究脉络
      </p>
    </div>
  );
}

/* ── 分析中 ── */

function RunningState() {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Loader2 className="w-5 h-5 animate-spin text-accent" />
      <p className="text-sm text-ink-muted">AI 研究助手分析中…</p>
      <p className="text-xs text-ink-faint">全文获取 → 分节解析 → 深度分析（约 30-60 秒）</p>
    </div>
  );
}

/* ── 有分析（L2/L3 信息一致）── */

/** LLM 输出归一化：数组字段可能被返回成字符串/缺失，统一转数组 */
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

/** evidence 归一化：LLM 可能返回畸形结构，只保留 {section, description} 有效项 */
function asEvidence(v: unknown): EvidenceItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is EvidenceItem =>
    !!x && typeof x === "object" && typeof (x as EvidenceItem).description === "string");
}

function AnalysisState({ detail, onLocate }: { detail: PaperDetail; onLocate?: (t: SectionTarget) => void }) {
  const a = detail.analysis.content!;
  const materialType = detail.analysis.material_type;
  const sections: PaperSection[] = detail.sections ?? detail.analysis.sections ?? [];

  const datasets = asList(a.experiments?.datasets);
  const contributions = asList(a.core_contributions);
  const directions = asList(a.relation_to_research?.related_directions);
  const pipeline = asList(a.method_framework?.pipeline);
  // per-block 证据（A 正解）：方法框架 / 实验结论各自内嵌原文锚点
  const mfEvidence = asEvidence(a.method_framework?.evidence);
  const expEvidence = asEvidence(a.experiments?.evidence);
  // 归纳徽章文案：全文级 / 摘要级 / AI 概要 / 无材料（2026-09-01：无材料不再标"仅摘要"误导；AI 概要区分标注）
  const e3Label =
    materialType === "全文分节" ? "AI 归纳 · 全文"
      : materialType === "摘要" ? "AI 归纳 · 仅摘要"
        : materialType === "AI 概要" ? "AI 归纳 · AI 概要"
          : "AI 归纳 · 无材料";

  return (
    <div className="flex flex-col gap-4">
      {materialType === "无材料" && (
        <div className="text-xs text-status-running border border-status-running/25 bg-status-running/10 rounded-md px-3 py-2 leading-relaxed">
          未获取到论文材料（无摘要无全文），以下分析仅供参考；上传 PDF 后可自动升级为全文级分析。
        </div>
      )}
      {a.summary && (
        <Block title="摘要学术化总结" badge={<EvidenceBadge level="E3" label={e3Label} />}>
          <p className="text-sm text-ink leading-relaxed">{a.summary}</p>
        </Block>
      )}
      {a.quick_understand && (
        <Block title="一句话理解" badge={<EvidenceBadge level="E3" label={e3Label} />}>
          <p className="text-sm text-ink leading-relaxed">{a.quick_understand}</p>
        </Block>
      )}
      {contributions.length > 0 && (
        <Block title="核心贡献" badge={<EvidenceBadge level="E3" label={e3Label} />}>
          <ul className="space-y-1">
            {contributions.map((c, i) => (
              <li key={i} className="text-sm text-ink leading-relaxed">{c}</li>
            ))}
          </ul>
        </Block>
      )}
      {a.method_framework && a.method_framework.text && (
        <Block title="方法框架"
          badge={<EvidenceBadge level={mfEvidence.length > 0 ? "E1" : "E3"} label={mfEvidence.length > 0 ? "锚定原文" : e3Label} />}>
          {pipeline.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {pipeline.map((s, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-xs px-2 py-0.5 rounded-md border border-line bg-paper-warm text-ink">{s}</span>
                  {i < pipeline.length - 1 && <span className="text-ink-faint">→</span>}
                </span>
              ))}
            </div>
          )}
          <p className="text-sm text-ink leading-relaxed">{a.method_framework.text}</p>
          {mfEvidence.length > 0 && (
            <EvidenceItems evidence={mfEvidence} onLocate={onLocate} sections={sections} />
          )}
        </Block>
      )}
      {a.experiments && (datasets.length > 0 || a.experiments.ours) && (
        <Block title="实验结论" icon={<FlaskConical className="w-3.5 h-3.5" />}
          badge={<EvidenceBadge level={expEvidence.length > 0 ? "E1" : "E3"} label={expEvidence.length > 0 ? "锚定原文" : e3Label} />}>
          <div className="space-y-1.5">
            {datasets.length > 0 && <MetaRow label="数据集" value={datasets.join(" / ")} />}
            {a.experiments.baseline && <MetaRow label="Baseline" value={a.experiments.baseline} />}
            {a.experiments.ours && <MetaRow label="Ours" value={a.experiments.ours} />}
            {a.experiments.gains && <MetaRow label="提升" value={a.experiments.gains} highlight />}
            {a.experiments.notes && <p className="text-xs text-ink-faint">{a.experiments.notes}</p>}
          </div>
          {expEvidence.length > 0 && (
            <EvidenceItems evidence={expEvidence} onLocate={onLocate} sections={sections} />
          )}
        </Block>
      )}
      {a.relation_to_research && a.relation_to_research.topic && (
        <Block title="与当前研究的关系" icon={<BookOpen className="w-3.5 h-3.5" />}
          badge={<EvidenceBadge level="E3" label="AI 推断" />}>
          <p className="text-xs text-ink-faint mb-1.5">当前研究：{a.relation_to_research.topic}</p>
          {directions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {directions.map((d, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full border border-line bg-paper-warm text-ink-secondary">✓ {d}</span>
              ))}
            </div>
          )}
          {a.relation_to_research.potential_contribution && (
            <p className="text-sm text-ink leading-relaxed">{a.relation_to_research.potential_contribution}</p>
          )}
        </Block>
      )}
      {a.research_context && (
        <ResearchContext ctx={a.research_context} />
      )}
    </div>
  );
}

function Block({ title, icon, badge, children }: { title: string; icon?: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon ?? <CheckCircle2 className="w-3.5 h-3.5 text-accent/70" />}
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <span className="ml-auto shrink-0">{badge}</span>
      </div>
      {children}
    </div>
  );
}

function MetaRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-16 shrink-0 text-ink-faint">{label}</span>
      <span className={highlight ? "text-gold-light" : "text-ink"}>{value}</span>
    </div>
  );
}

/** 区块证据条目（per-block 锚定原文）：章节 chip（鎏光）+ 一句概括 + 点击跳转 */
function EvidenceItems({ evidence, onLocate, sections }: {
  evidence: EvidenceItem[];
  onLocate?: (t: SectionTarget) => void;
  sections: PaperSection[];
}) {
  if (evidence.length === 0) return null;
  const go = (ev: EvidenceItem) => {
    if (!onLocate) return;
    const t = matchSection(ev.section ?? "", sections);
    if (t) onLocate(t);
  };
  return (
    <div className="flex flex-col gap-1 mt-2">
      {evidence.map((ev, i) => (
        <button
          key={i}
          type="button"
          onClick={onLocate ? () => go(ev) : undefined}
          disabled={!onLocate}
          title={onLocate ? `定位到原文：${ev.section ?? "对应章节"}` : undefined}
          className={`flex items-start gap-1.5 text-left rounded-md px-2 py-1.5 border border-line bg-paper-warm/40 transition-colors ${
            onLocate ? "hover:bg-paper-warm cursor-pointer" : "disabled:cursor-default disabled:opacity-80"
          }`}
        >
          {ev.section ? (
            <span
              className="text-xs px-1.5 py-0.5 rounded-md whitespace-nowrap shrink-0 mt-px"
              style={{
                background: "rgba(95,207,190,0.16)",
                color: "#5DCAA5",
                border: "1px solid rgba(212,175,55,0.45)",
                boxShadow: "0 0 8px rgba(212,175,55,0.15)",
              }}
            >
              {ev.section}
            </span>
          ) : null}
          <span className="flex-1 min-w-0 text-xs text-ink-secondary leading-relaxed line-clamp-2">{ev.description}</span>
          {onLocate && <ExternalLink className="w-3 h-3 shrink-0 text-ink-faint mt-0.5" />}
        </button>
      ))}
    </div>
  );
}

function ResearchContext({ ctx }: { ctx: NonNullable<PaperDetail["analysis"]["content"]>["research_context"] }) {
  if (!ctx) return null;
  const groups: { key: "base" | "horizontal" | "vertical"; label: string }[] = [
    { key: "base", label: "基础 · 前置工作" },
    { key: "horizontal", label: "横向 · 同方向/相似" },
    { key: "vertical", label: "纵向 · 后续发展" },
  ];
  const active = groups.filter((g) => (ctx[g.key] ?? []).length > 0);
  if (active.length === 0) return null;

  return (
    <div className="border-t border-line pt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <GitBranch className="w-3.5 h-3.5 text-accent/70" />
        <h3 className="text-sm font-medium text-ink">研究脉络</h3>
        <span className="ml-auto"><EvidenceBadge level="E2" /></span>
      </div>
      <div className="space-y-2.5">
        {active.map(({ key, label }) => (
          <div key={key}>
            <p className="text-xs text-ink-faint mb-1">{label}</p>
            <div className="space-y-0.5">
              {(ctx[key] ?? []).map((p: PaperRef, i) => (
                <p key={i} className="text-xs text-ink-secondary leading-snug">
                  {p.title}
                  {p.year ? <span className="text-ink-faint"> · {p.year}</span> : null}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
