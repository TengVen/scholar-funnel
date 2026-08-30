"use client";

import { useState } from "react";
import { Map, ChevronDown, ChevronUp } from "lucide-react";
import type { CognitiveStructure, StructurePaper } from "@/types/dto";
import type { Category } from "@/types/domain";
import { addToCart } from "@/lib/api/cart";
import { useCartStore } from "@/stores/cartStore";
import { CATEGORY_SECTION, CATEGORY_META } from "@/config/categories";
import { toast } from "@/lib/toast";
import { PaperActionRow } from "./PaperActionRow";

/**
 * L2 认知结构卡（L2Renderer）：论文 = 认知结构节点。
 * 明确区分"核心推荐"与"全部候选"：核心推荐 = 认知结构主动装载的论文；
 * 候选结果池（共发现 N 篇）经"查看全部"入口探索，不因只展示部分而丢弃。
 * 分类以"奠基/主流/前沿"区块标题直接呈现（内部模型判断不外露）。
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

  return (
    <div className="card max-w-[85%] w-full px-4 py-3">
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
              <div className="space-y-1.5">
                {visible.map((p) => (
                  <PaperRow key={p.paper_id} paper={p} projectId={projectId} />
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
          className="btn-secondary text-xs !py-1.5"
        >
          {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          查看全部 {structure.total_candidates} 篇
        </button>
        {!showAll && (
          <span className="text-xs text-ink-faint">
            候选结果池已保留全部 {structure.total_candidates} 篇，其余论文可继续探索
          </span>
        )}
      </div>
    </div>
  );
}

function PaperRow({ paper, projectId }: { paper: StructurePaper; projectId?: number | null }) {
  const [adding, setAdding] = useState(false);
  const inCart = useCartStore(
    (s) => s.cart?.items.some((it) => it.paper_id === paper.paper_id) ?? false,
  );
  const label = CATEGORY_META[paper.suggested_category].label;

  const handleAdd = async () => {
    if (!projectId) return;
    setAdding(true);
    try {
      await addToCart(projectId, paper.paper_id, paper.suggested_category, `认知结构推荐（${label}）`);
      toast(`已加入骨架（${label}）`, "success");
    } catch (e) {
      toast(`加入骨架失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setAdding(false);
    }
  };

  return (
    <PaperActionRow
      title={paper.title}
      meta={[paper.year ? String(paper.year) : "", paper.cited_by_count ? `被引 ${paper.cited_by_count}` : ""]}
      reason={paper.reason}
      inCart={inCart}
      adding={adding}
      onAdd={handleAdd}
    />
  );
}
