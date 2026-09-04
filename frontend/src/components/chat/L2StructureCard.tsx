"use client";

import { useState } from "react";
import { Map, ChevronDown, ChevronUp } from "lucide-react";
import type { CognitiveStructure, StructurePaper } from "@/types/dto";
import type { Category } from "@/types/domain";
import { CATEGORY_SECTION, CATEGORY_META } from "@/config/categories";
import { PaperAbstractRow } from "./PaperAbstractRow";

/**
 * L2 认知结构卡（L2Renderer）：论文 = 认知结构节点。
 * 明确区分"核心推荐"与"全部候选"；分类以"奠基/主流/前沿"区块标题呈现。
 * 操作收敛：论文点击进入详情页（认知位置/为什么推荐在详情页展示）。
 */
interface L2StructureCardProps {
  content: string;
  structure: CognitiveStructure;
  projectId?: number | null;
}

export function L2StructureCard({ content, structure, projectId }: L2StructureCardProps) {
  const [showAll, setShowAll] = useState(false);

  const groups: { key: Category; papers: StructurePaper[] }[] = [
    { key: "foundation", papers: structure.foundation },
    { key: "mainstream", papers: structure.mainstream },
    { key: "frontier", papers: structure.frontier },
  ];
  // 展开后实际可见 = 三类入选论文总数（≠ 候选池 total_candidates）
  const shownTotal = groups.reduce((n, g) => n + g.papers.length, 0);

  return (
    <div className="card bg-paper-chrome max-w-[85%] w-full px-4 py-3">
      {content && <div className="text-base leading-relaxed text-ink-secondary mb-2 whitespace-pre-wrap">{content}</div>}

      <div className="flex items-center gap-2">
        <Map className="w-4 h-4 text-accent" />
        <p className="font-serif text-base font-semibold text-ink">认知结构「{structure.topic || "未命名主题"}」</p>
      </div>
      <p className="text-sm text-ink-muted mt-1">
        核心推荐 <span className="text-gold-light tabular-nums">{structure.selected_count}</span> 篇 ·
        共发现 <span className="tabular-nums">{structure.total_candidates}</span> 篇相关论文
      </p>

      <div className="mt-3 space-y-3">
        {groups.map(({ key, papers }) => {
          const meta = CATEGORY_SECTION[key];
          const visible = showAll ? papers : papers.slice(0, 3);
          if (papers.length === 0) return null;
          return (
            <div key={key}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: meta.dot }} />
                <span className={`text-sm ${meta.color}`}>{CATEGORY_META[key].label} · {papers.length} 篇</span>
              </div>
              <div className="space-y-1">
                {visible.map((p) => (
                  <PaperAbstractRow
                    key={p.paper_id}
                    title={p.title}
                    meta={[p.year ? String(p.year) : "", p.cited_by_count ? `被引 ${p.cited_by_count}` : ""]}
                    reason={p.one_liner ?? p.reason}
                    recallBasis={p.recall_basis}
                    href={`/paper/${p.paper_id}${projectId ? `?project_id=${projectId}&auto=1` : ""}`}
                    paperId={p.paper_id}
                    projectId={projectId}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="inline-flex items-center gap-1 text-xs !py-1.5 px-3 rounded-md bg-gold/10 border border-gold/40 text-gold-deep hover:bg-gold/20 hover:border-gold/60 transition-colors backdrop-blur-sm"
        >
          {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showAll ? "收起" : `展开全部核心推荐（${shownTotal} 篇）`}
        </button>
        {!showAll && (
          <span className="text-xs text-ink-faint">
            候选结果池已保留全部 {structure.total_candidates} 篇，其余论文可在检索页/工作台继续探索
          </span>
        )}
      </div>
    </div>
  );
}
