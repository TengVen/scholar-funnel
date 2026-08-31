"use client";

import {
  Loader2, ArrowRight, CheckCircle2,
  FlaskConical, GitBranch, BookOpen,
} from "lucide-react";
import type { PaperDetail, PaperRef } from "@/types/dto";

/**
 * 右栏内容：AI 研究助手（差异化核心，三态渲染；标题行与外壳由 ResizablePanel 提供）
 * - 无分析（L1 浏览）：摘要 + 深入探究引导
 * - 分析中：进度提示
 * - 有分析（L2 预热 / L3 落库，信息一致）：六区块 + 研究脉络
 * 问答交互已迁至左栏 PaperQaBox。
 */
interface AiResearchPanelProps {
  detail: PaperDetail;
  projectId?: number | null;
  exploring: boolean;
  onExplore: () => void;
}

export function AiResearchPanel({ detail, projectId, exploring, onExplore }: AiResearchPanelProps) {
  const st = detail.analysis.status;

  return (
    <div className="flex flex-col gap-4 px-4 py-4 h-full overflow-y-auto">
      {st === "none" && (
        <L1State detail={detail} projectId={projectId} exploring={exploring} onExplore={onExplore} />
      )}
      {st === "running" && <RunningState />}
      {st === "done" && detail.analysis.content && (
        <AnalysisState detail={detail} />
      )}
    </div>
  );
}

/* ── L1 浏览态：摘要 + 深入探究 ── */

function L1State({ detail, projectId, exploring, onExplore }: Pick<AiResearchPanelProps, "detail" | "projectId" | "exploring" | "onExplore">) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-line bg-paper-warm/50 px-3 py-2.5">
        <p className="text-xs text-ink-faint mb-1">摘要</p>
        <p className="text-sm text-ink-secondary leading-relaxed line-clamp-6">
          {detail.abstract || "暂无摘要"}
        </p>
      </div>
      <button
        type="button"
        onClick={onExplore}
        disabled={exploring || !projectId}
        className="btn-secondary text-sm !py-2 w-full disabled:opacity-50"
      >
        {exploring ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        深入探究
      </button>
      {!projectId && (
        <p className="text-xs text-ink-faint">需要先选择一个研究项目才能深入探究</p>
      )}
      <p className="text-xs text-ink-faint leading-relaxed">
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

function AnalysisState({ detail }: { detail: PaperDetail }) {
  const a = detail.analysis.content!;

  const datasets = asList(a.experiments?.datasets);
  const contributions = asList(a.core_contributions);
  const directions = asList(a.relation_to_research?.related_directions);
  const pipeline = asList(a.method_framework?.pipeline);

  return (
    <div className="flex flex-col gap-4">
      {a.summary && (
        <Block title="摘要学术化总结">
          <p className="text-sm text-ink-secondary leading-relaxed">{a.summary}</p>
        </Block>
      )}
      {a.quick_understand && (
        <Block title="一句话理解">
          <p className="text-sm text-ink leading-relaxed">{a.quick_understand}</p>
        </Block>
      )}
      {contributions.length > 0 && (
        <Block title="核心贡献">
          <ul className="space-y-1">
            {contributions.map((c, i) => (
              <li key={i} className="text-sm text-ink-secondary leading-relaxed">{c}</li>
            ))}
          </ul>
        </Block>
      )}
      {a.method_framework && a.method_framework.text && (
        <Block title="方法框架">
          {pipeline.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {pipeline.map((s, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-xs px-2 py-0.5 rounded-md border border-line bg-paper-warm text-ink-secondary">{s}</span>
                  {i < pipeline.length - 1 && <span className="text-ink-faint">→</span>}
                </span>
              ))}
            </div>
          )}
          <p className="text-sm text-ink-secondary leading-relaxed">{a.method_framework.text}</p>
        </Block>
      )}
      {a.experiments && (datasets.length > 0 || a.experiments.ours) && (
        <Block title="实验结论" icon={<FlaskConical className="w-3.5 h-3.5" />}>
          <div className="space-y-1.5">
            {datasets.length > 0 && <MetaRow label="数据集" value={datasets.join(" / ")} />}
            {a.experiments.baseline && <MetaRow label="Baseline" value={a.experiments.baseline} />}
            {a.experiments.ours && <MetaRow label="Ours" value={a.experiments.ours} />}
            {a.experiments.gains && <MetaRow label="提升" value={a.experiments.gains} highlight />}
            {a.experiments.notes && <p className="text-xs text-ink-faint">{a.experiments.notes}</p>}
          </div>
        </Block>
      )}
      {a.relation_to_research && a.relation_to_research.topic && (
        <Block title="与当前研究的关系" icon={<BookOpen className="w-3.5 h-3.5" />}>
          <p className="text-xs text-ink-faint mb-1.5">当前研究：{a.relation_to_research.topic}</p>
          {directions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {directions.map((d, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full border border-line bg-paper-warm text-ink-secondary">✓ {d}</span>
              ))}
            </div>
          )}
          {a.relation_to_research.potential_contribution && (
            <p className="text-sm text-ink-secondary leading-relaxed">{a.relation_to_research.potential_contribution}</p>
          )}
        </Block>
      )}
      {a.research_context && (
        <ResearchContext ctx={a.research_context} />
      )}
    </div>
  );
}

function Block({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon ?? <CheckCircle2 className="w-3.5 h-3.5 text-accent/70" />}
        <h3 className="text-sm font-medium text-ink">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MetaRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-16 shrink-0 text-ink-faint">{label}</span>
      <span className={highlight ? "text-gold-light" : "text-ink-secondary"}>{value}</span>
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
