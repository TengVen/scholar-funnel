"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, ExternalLink, Loader2,
} from "lucide-react";
import type {
  ConversationWorkspace, PaperBrief, SearchRunRecord, SubResearchWorkspace,
} from "@/types/dto";
import { getWorkspace } from "@/lib/api/chat";
import { cn } from "@/lib/utils";
import { CATEGORY_META, CATEGORY_SECTION } from "@/config/categories";
import { RunMapSection } from "@/components/map/RunMapSection";

/**
 * 工作台概览（对话页伸缩右栏，2-page IA）——方案 B：指标面板式 + 区块就地展开。
 * 对话 → 子研究（容器）→ Search Run（研究任务，指标面板）：
 * - 任务标题行：动作语义（首次全量检索 / 重检索·模式）+ mode 徽章 + 年份
 * - 指标格：召回 / 入库 / 覆盖 / 论文（"做得好不好"一眼可见）
 * - 关键词行：高频关键词胶囊
 * - 区块目录行：认知结构 / 论文推荐 / 深入研究（计数胶囊，点击就地展开，可多开）
 * 纯展示 + 回调注入：跳转行为由调用方（page）裁决。整栏纵向滚动。
 */
interface WorkspacePanelProps {
  conversationId: string | null;
  onOpenSearch: (projectId: number, runId?: number) => void;
  onOpenPaper: (paperId: number, projectId: number) => void;
}

export function WorkspacePanel({ conversationId, onOpenSearch, onOpenPaper }: WorkspacePanelProps) {
  const [ws, setWs] = useState<ConversationWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [runOpen, setRunOpen] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // 区块级折叠："{runId}:{section}"

  useEffect(() => {
    if (!conversationId) {
      setWs(null);
      return;
    }
    let alive = true;
    setLoading(true);
    getWorkspace(conversationId)
      .then((data) => {
        if (!alive) return;
        setWs(data);
        // 默认展开所有子研究 + 所有 Run；区块默认收起（点计数展开）
        setOpenIds(new Set(data.sub_researches.map((s) => s.project_id)));
        const runIds = data.sub_researches.flatMap((s) => s.search_runs.map((r) => r.id));
        setRunOpen(new Set(runIds));
        setCollapsed(new Set());
      })
      .catch(() => { /* 静默：概览加载失败不打扰对话 */ })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [conversationId]);

  const toggle = useCallback((id: number) => {
    setOpenIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  const toggleRun = useCallback((id: number) => {
    setRunOpen((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
      </div>
    );
  }
  if (!ws || ws.sub_researches.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-ink-faint leading-relaxed">
        暂无子研究——发起一次检索后，研究资产会在这里按子研究组织。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3 flex-1 min-h-0 overflow-y-auto">
      {ws.sub_researches.map((s) => (
        <SubResearchCard
          key={s.project_id}
          sub={s}
          open={openIds.has(s.project_id)}
          runOpen={runOpen}
          collapsed={collapsed}
          onToggle={() => toggle(s.project_id)}
          onToggleRun={toggleRun}
          onToggleSection={toggleSection}
          onOpenSearch={onOpenSearch}
          onOpenPaper={onOpenPaper}
        />
      ))}
    </div>
  );
}

/* ── 子研究（容器层级） ── */

function SubResearchCard({ sub, open, runOpen, collapsed, onToggle, onToggleRun, onToggleSection, onOpenSearch, onOpenPaper }: {
  sub: SubResearchWorkspace;
  open: boolean;
  runOpen: Set<number>;
  collapsed: Set<string>;
  onToggle: () => void;
  onToggleRun: (runId: number) => void;
  onToggleSection: (key: string) => void;
  onOpenSearch: (pid: number, runId?: number) => void;
  onOpenPaper: (pid: number, projId: number) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper-warm/60 overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-paper-warm transition-colors">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-ink-faint shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-faint shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-ink truncate">{sub.name}</span>
          <span className="block text-2xs text-ink-faint">
            {sub.search_runs.length} 次检索 · {sub.papers.length} 篇论文 · {sub.explored_papers.length} 篇已探究
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line/70 px-2 pb-2 pt-2 space-y-2">
          {sub.search_runs.length === 0 ? (
            <p className="text-xs text-ink-faint px-1">暂无检索记录</p>
          ) : (
            sub.search_runs.slice(0, 5).map((r, i) => (
              <RunCard key={r.id} run={r}
                isFirst={i === sub.search_runs.length - 1}   // runs 时间倒序：末位 = 首次检索
                open={runOpen.has(r.id)}
                collapsed={collapsed}
                onToggle={() => onToggleRun(r.id)}
                onToggleSection={onToggleSection}
                onOpenSearch={() => onOpenSearch(sub.project_id, r.id)}
                onOpenPaper={(pid) => onOpenPaper(pid, sub.project_id)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Run（研究任务 · 指标面板式） ── */

const MODE_LABEL: Record<string, string> = {
  full: "全量", incremental: "增量", local_filter: "本地", hybrid: "混合",
};
const STATUS_TEXT: Record<string, string> = {
  done: "", partial: "部分", failed: "失败", rate_limited: "限流",
};
const STATUS_STYLE: Record<string, string> = {
  done: "border-line text-ink-muted",
  partial: "border-status-partial/40 text-status-partial",
  failed: "border-status-failed/40 text-status-failed",
  rate_limited: "border-status-partial/50 text-status-partial",
};

/** 任务动作语义标题（非首次时按 Planner 模式区分动作） */
function runActionTitle(run: SearchRunRecord): string {
  switch (run.mode) {
    case "incremental": return "重检索 · 增量补召回";
    case "local_filter": return "重检索 · 本地过滤";
    case "hybrid": return "重检索 · 方法补充召回";
    case "full": return "重检索 · 全量";
    default: return "检索";
  }
}
/** 年份范围展示：2020-2024 / 2020+ / ≤2024 / "" */
function yearRangeText(run: SearchRunRecord): string {
  const { year_from, year_to } = run;
  if (year_from && year_to) return `${year_from}-${year_to}`;
  if (year_from) return `${year_from}+`;
  if (year_to) return `≤${year_to}`;
  return "";
}

function RunCard({ run, isFirst, open, collapsed, onToggle, onToggleSection, onOpenSearch, onOpenPaper }: {
  run: SearchRunRecord;
  isFirst: boolean;
  open: boolean;
  collapsed: Set<string>;
  onToggle: () => void;
  onToggleSection: (key: string) => void;
  onOpenSearch: () => void;
  onOpenPaper: (paperId: number) => void;
}) {
  const papers = run.papers ?? [];
  const exploredPapers = papers.filter((p) => p.explored);
  const cognitive = run.cognitive;
  const modeLabel = run.mode ? MODE_LABEL[run.mode] ?? run.mode : "";
  const statusText = run.status ? STATUS_TEXT[run.status] ?? "" : "";
  const actionTitle = isFirst ? "首次全量检索" : runActionTitle(run);
  const yearText = yearRangeText(run);
  const keywords = run.keywords ?? [];
  const coveragePct = run.covered_ratio != null ? `${Math.round(run.covered_ratio * 100)}%` : "—";
  // 三分类核心推荐（认知结构 / 论文推荐同源）
  const recGroups = (["foundation", "mainstream", "frontier"] as const)
    .map((cat) => ({ cat, items: cognitive?.[cat] ?? [] }))
    .filter((g) => g.items.length > 0);
  const recCount = recGroups.reduce((n, g) => n + g.items.length, 0);
  const secKey = (name: string) => `${run.id}:${name}`;
  const isSecOpen = (name: string) => !collapsed.has(secKey(name));

  return (
    <div className="rounded-lg border border-line/70 bg-paper-white/50 overflow-hidden">
      {/* 任务标题行：动作语义 + mode 徽章 + 年份 */}
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-paper-warm transition-colors">
        {open ? <ChevronDown className="w-3 h-3 text-ink-faint shrink-0" /> : <ChevronRight className="w-3 h-3 text-ink-faint shrink-0" />}
        <span className="text-xs font-semibold text-ink truncate">{actionTitle}</span>
        {modeLabel && (
          <span className="text-xs px-1.5 py-0.5 rounded border border-accent/30 text-accent whitespace-nowrap shrink-0">
            {modeLabel}
          </span>
        )}
        {statusText && (
          <span className={`text-xs px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 ${STATUS_STYLE[run.status ?? ""] ?? ""}`}>
            {statusText}
          </span>
        )}
        {yearText && <span className="ml-auto text-2xs text-ink-faint shrink-0">{yearText}</span>}
      </button>

      {open && (
        <div className="border-t border-line/60 px-2.5 py-2">
          {/* 指标格：做得好不好一眼可见 */}
          <div className="grid grid-cols-4 gap-1.5 mb-2">
            <Metric label="召回" value={run.total_found} />
            <Metric label="入库" value={run.saved_count} />
            <Metric label="覆盖" value={coveragePct} />
            <Metric label="论文" value={papers.length} />
          </div>

          {/* 关键词行 */}
          {keywords.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mb-2">
              <span className="text-2xs text-ink-faint shrink-0">关键词</span>
              {keywords.map((k) => (
                <span key={k} className="text-2xs px-1.5 py-0.5 rounded-full border border-line/70 bg-paper-warm/40 text-ink-muted">
                  {k}
                </span>
              ))}
            </div>
          )}

          {/* 细节（检索词 / 计划） */}
          {run.query?.trim() && <p className="text-2xs text-ink-faint leading-relaxed mb-0.5">检索词：{run.query}</p>}
          {run.plan_reason && <p className="text-2xs text-ink-faint leading-relaxed mb-1.5">计划：{run.plan_reason}</p>}
          {run.error && <p className="text-2xs text-red-400/80 leading-relaxed mb-1.5">错误：{run.error}</p>}

          {/* 区块目录行：计数胶囊，点击就地展开，可多开 */}
          <div className="flex items-center gap-1.5 flex-wrap border-t border-line/60 pt-2">
            <SectionChip active={isSecOpen("map")} onClick={() => onToggleSection(secKey("map"))}>
              领域地图
            </SectionChip>
            <SectionChip active={isSecOpen("rec")} onClick={() => onToggleSection(secKey("rec"))}>
              论文推荐 {recCount}
            </SectionChip>
            <SectionChip active={isSecOpen("explored")} onClick={() => onToggleSection(secKey("explored"))}>
              深入研究 {exploredPapers.length}
            </SectionChip>
            <button type="button" onClick={onOpenSearch}
              className="ml-auto text-2xs text-accent hover:underline shrink-0">
              查看检索页 →
            </button>
          </div>

          {/* 就地展开区块：领域地图（2026-09-04：替代原"认知结构"计数块——三分类已由「论文推荐」列表承载，地图是 run 级结构产物，点开即看） */}
          {isSecOpen("map") && (
            <div className="mt-2 pt-2 border-t border-line/60">
              <RunMapSection runId={run.id} onOpenPaper={onOpenPaper} defaultCollapsed={false} />
            </div>
          )}

          {isSecOpen("rec") && (
            <div className="mt-2 pt-2 border-t border-line/60 max-h-64 overflow-y-auto space-y-2 pr-0.5">
              {recGroups.length === 0 ? (
                <p className="text-2xs text-ink-faint">暂无核心推荐（检索完成后生成）</p>
              ) : (
                recGroups.map(({ cat, items }) => {
                  const sec = CATEGORY_SECTION[cat];
                  const meta = CATEGORY_META[cat];
                  return (
                    <div key={cat}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: sec.dot }} />
                        <span className={`text-2xs font-medium ${sec.color}`}>{meta.label} · {items.length}</span>
                      </div>
                      <div className="space-y-0.5">
                        {items.map((p) => (
                          <StructureRow key={p.paper_id ?? p.title} item={p}
                            onClick={p.paper_id ? () => onOpenPaper(p.paper_id) : undefined} />
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {isSecOpen("explored") && (
            <div className="mt-2 pt-2 border-t border-line/60 max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
              {exploredPapers.length === 0 ? (
                <p className="text-2xs text-ink-faint">暂无深入探究记录</p>
              ) : (
                exploredPapers.map((p) => (
                  <PaperRow key={p.paper_id} paper={p} explored onClick={() => onOpenPaper(p.paper_id)} />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 指标格 / 区块计数胶囊 ── */

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-paper-warm/50 rounded-md px-1.5 py-1 text-center min-w-0">
      <p className="text-2xs text-ink-faint leading-none">{label}</p>
      <p className="text-sm font-semibold text-ink tabular-nums leading-tight mt-0.5 truncate">{value}</p>
    </div>
  );
}

function SectionChip({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded-md border transition-colors",
        active
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-line/70 bg-paper-warm/40 text-ink-muted hover:text-ink hover:bg-paper-warm",
      )}>
      {children}
      {active ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
    </button>
  );
}

/* ── 核心推荐行（StructurePaper：标题 + 年份 + 理由） ── */

function StructureRow({ item, onClick }: {
  item: { paper_id?: number | null; title?: string; year?: number | null; reason?: string; one_liner?: string; recall_basis?: string };
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      disabled={!onClick}
      className={cn(
        "w-full flex items-start gap-2 rounded-md px-2 py-1 text-left transition-colors",
        onClick ? "hover:bg-paper-warm cursor-pointer" : "cursor-default",
      )}>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-ink-secondary leading-snug">{item.title || "未命名论文"}</span>
        <span className="block text-2xs text-ink-faint mt-0.5">
          {item.year ? String(item.year) : ""}
          {item.one_liner || item.reason ? ` · ${item.one_liner || item.reason}` : ""}
          {item.recall_basis ? ` · 召回依据：${item.recall_basis}` : ""}
        </span>
      </span>
      {onClick && <ExternalLink className="w-3 h-3 text-ink-faint shrink-0 mt-1" />}
    </button>
  );
}

/* ── 论文行（深入研究） ── */

function PaperRow({ paper, explored, onClick }: {
  paper: PaperBrief;
  explored?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      title="打开论文详情"
      className="w-full flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-paper-warm transition-colors">
      <span className="flex-1 min-w-0 text-xs text-ink-secondary truncate">{paper.title}</span>
      {paper.year ? <span className="text-2xs text-ink-faint shrink-0">{paper.year}</span> : null}
      <span className={cn("text-2xs shrink-0", explored ? "text-gold-light" : "text-ink-faint")}>
        {explored ? "已探究" : "未探究"}
      </span>
      <ExternalLink className="w-3 h-3 text-ink-faint shrink-0" />
    </button>
  );
}
