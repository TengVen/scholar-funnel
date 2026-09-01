"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen, ChevronDown, ChevronRight, ExternalLink,
  FlaskConical, GitBranch, Loader2, Search,
} from "lucide-react";
import type {
  ConversationWorkspace, PaperBrief, SearchRunRecord, SubResearchWorkspace,
} from "@/types/dto";
import type { Category } from "@/types/domain";
import { CATEGORY_SECTION, CATEGORY_META } from "@/config/categories";
import { getWorkspace } from "@/lib/api/chat";
import { cn } from "@/lib/utils";

/**
 * 工作台概览（对话页伸缩右栏，2-page IA）：
 * 对话 → 子研究树，每个子研究含四区块：
 * - 检索记录（点击跳转检索页，样式沿用现有检索页）
 * - L2 认知结构（骨架摘要，只读展示）
 * - 论文推荐（深研推荐集，样式复刻 L3 结果卡：按类别分组 + 年份/理由 + 已/未探究）
 * - 深入研究（已探究论文，点击直达详情页）
 * 纯展示 + 回调注入：跳转行为由调用方（page）裁决。整栏纵向滚动。
 */
interface WorkspacePanelProps {
  conversationId: string | null;
  onOpenSearch: (projectId: number) => void;
  onOpenPaper: (paperId: number, projectId: number) => void;
}

const GROUP_ORDER: Category[] = ["foundation", "mainstream", "frontier"];

export function WorkspacePanel({ conversationId, onOpenSearch, onOpenPaper }: WorkspacePanelProps) {
  const [ws, setWs] = useState<ConversationWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

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
        // 默认展开所有子研究
        setOpenIds(new Set(data.sub_researches.map((s) => s.project_id)));
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
    <div className="flex flex-col gap-3 px-3 py-3 flex-1 min-h-0 overflow-y-auto">
      {ws.sub_researches.map((s) => (
        <SubResearchCard
          key={s.project_id}
          sub={s}
          open={openIds.has(s.project_id)}
          onToggle={() => toggle(s.project_id)}
          onOpenSearch={onOpenSearch}
          onOpenPaper={onOpenPaper}
        />
      ))}
    </div>
  );
}

/* ── 子研究卡片（四区块）── */

function SubResearchCard({ sub, open, onToggle, onOpenSearch, onOpenPaper }: {
  sub: SubResearchWorkspace;
  open: boolean;
  onToggle: () => void;
  onOpenSearch: (pid: number) => void;
  onOpenPaper: (pid: number, projId: number) => void;
}) {
  const exploredCount = sub.explored_papers.length;

  return (
    <div className="rounded-lg border border-line bg-paper-warm/40 overflow-hidden">
      {/* 头部 */}
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-paper-warm transition-colors">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-ink-faint shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-faint shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-ink truncate">{sub.name}</span>
          <span className="block text-2xs text-ink-faint">
            {sub.search_runs.length} 次检索 · {sub.papers.length} 篇推荐 · {exploredCount} 篇已探究
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line divide-y divide-line/60">
          {/* 检索记录 */}
          <Section icon={<Search className="w-3 h-3" />} title="检索记录">
            {sub.search_runs.length === 0 ? (
              <p className="text-xs text-ink-faint">暂无检索记录</p>
            ) : (
              <div className="space-y-1">
                {sub.search_runs.slice(0, 5).map((r) => (
                  <SearchRunRow key={r.id} run={r} onClick={() => onOpenSearch(sub.project_id)} />
                ))}
              </div>
            )}
          </Section>

          {/* L2 认知结构（只读） */}
          <Section icon={<GitBranch className="w-3 h-3" />} title="L2 认知结构">
            {sub.cognitive.categories.length === 0 ? (
              <p className="text-xs text-ink-faint">暂无认知结构</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sub.cognitive.categories.map((c) => (
                  <span key={c.category} className="text-[11px] px-2 py-0.5 rounded-full border border-line bg-paper-warm text-ink-muted">
                    {c.category} · {c.count}
                  </span>
                ))}
              </div>
            )}
          </Section>

          {/* 论文推荐（深研推荐集，样式复刻 L3 结果卡） */}
          <Section icon={<BookOpen className="w-3 h-3" />} title={`论文推荐（${sub.papers.length}）`}>
            {sub.papers.length === 0 ? (
              <p className="text-xs text-ink-faint">暂无推荐论文（发起深度调研后在此查看）</p>
            ) : (
              /* 框内滑动浏览：固定高度内部滚动，不整栏全量堆叠 */
              <div className="max-h-64 overflow-y-auto -mr-1 pr-1 space-y-2.5">
                {GROUP_ORDER.map((cat) => {
                  const group = sub.papers.filter((p) => p.category === cat);
                  if (group.length === 0) return null;
                  const meta = CATEGORY_SECTION[cat];
                  return (
                    <div key={cat}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: meta.dot }} />
                        <span className={`text-xs font-medium ${meta.color}`}>
                          {CATEGORY_META[cat].label} · {group.length} 篇
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {group.map((p) => (
                          <RecommendRow key={p.paper_id} paper={p}
                            onClick={() => onOpenPaper(p.paper_id, sub.project_id)} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* 深入研究 */}
          <Section icon={<FlaskConical className="w-3 h-3" />} title={`深入研究（${exploredCount}）`}>
            {exploredCount === 0 ? (
              <p className="text-xs text-ink-faint">暂无深入探究记录</p>
            ) : (
              <div className="space-y-1">
                {sub.explored_papers.map((p) => (
                  <PaperRow key={p.paper_id} paper={p} explored onClick={() => onOpenPaper(p.paper_id, sub.project_id)} />
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

/* ── 区块标题行 ── */

function Section({ icon, title, children }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-ink-faint">{icon}</span>
        <span className="text-xs font-medium text-ink-muted">{title}</span>
      </div>
      {children}
    </div>
  );
}

/* ── 检索记录行 ── */

const RUN_TYPE_LABEL: Record<string, string> = {
  trunk: "全量检索", gap: "缺口补充", semantic: "语义检索", local: "本地库检索",
};

function SearchRunRow({ run, onClick }: { run: SearchRunRecord; onClick: () => void }) {
  const label = RUN_TYPE_LABEL[run.run_type] ?? run.run_type;
  const coverage = run.covered_ratio != null ? `${Math.round(run.covered_ratio * 100)}% 已覆盖` : "";
  return (
    <button type="button" onClick={onClick}
      title="查看检索页"
      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left border border-line bg-paper-warm/50 hover:bg-paper-warm transition-colors">
      <span className="text-[11px] px-1.5 py-0.5 rounded border border-line text-ink-muted whitespace-nowrap shrink-0">
        {label}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-ink-secondary truncate">{run.query || "(无查询词)"}</span>
        <span className="block text-2xs text-ink-faint">
          {run.total_found} 召回 · {run.saved_count} 入库{coverage ? ` · ${coverage}` : ""}
        </span>
      </span>
      <ExternalLink className="w-3 h-3 text-ink-faint shrink-0" />
    </button>
  );
}

/* ── 推荐论文行（复刻 L3 结果卡 PaperNavRow：标题 + 年份 + 理由 + 已/未探究）── */

function RecommendRow({ paper, onClick }: { paper: PaperBrief; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      title={paper.explored ? "已深入探究，打开论文详情" : "打开论文详情"}
      className="group w-full flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent-light/10 transition-colors">
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-ink leading-snug group-hover:text-gold-light transition-colors">{paper.title}</span>
        <span className="block text-2xs text-ink-faint mt-0.5">
          {paper.year ? String(paper.year) : ""}
          {paper.explored ? " · 已探究" : " · 未探究"}
        </span>
        {paper.reason && <span className="block text-2xs text-ink-muted mt-0.5 leading-relaxed line-clamp-2">{paper.reason}</span>}
      </span>
      <ExternalLink className="w-3 h-3 shrink-0 text-ink-faint mt-1 group-hover:text-accent transition-colors" />
    </button>
  );
}

/* ── 深入研究论文行 ── */

function PaperRow({ paper, explored, onClick }: {
  paper: PaperBrief;
  explored?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      title="打开论文详情"
      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-paper-warm transition-colors">
      <span className="flex-1 min-w-0 text-xs text-ink-secondary truncate">{paper.title}</span>
      <span className={cn(
        "text-2xs shrink-0",
        explored ? "text-gold-light" : "text-ink-faint",
      )}>
        {explored ? "已探究" : "未探究"}
      </span>
      <ExternalLink className="w-3 h-3 text-ink-faint shrink-0" />
    </button>
  );
}
