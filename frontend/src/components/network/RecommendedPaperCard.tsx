"use client";

import { useState } from "react";
import { Loader2, ChevronDown, ChevronUp, ExternalLink, Plus, Check } from "lucide-react";
import type { RecommendedPaper, CartStatus } from "@/types/dto";
import { useCartStore } from "@/stores/cartStore";
import { toast } from "@/lib/toast";

/**
 * 网络推荐论文卡片（后向追溯 / 前向追踪共用）
 *
 * 一键加入骨架时按来源预选分类：后向（遗漏奠基）→ foundation，前向（新前沿）→ frontier。
 */
export function RecommendedPaperCard({
  paper, projectId, cart,
}: {
  paper: RecommendedPaper;
  projectId: number;
  cart: CartStatus | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const addByOpenAlex = useCartStore((s) => s.addByOpenAlex);
  const authors = paper.authors.length > 3
    ? `${paper.authors.slice(0, 3).join(", ")} 等 ${paper.authors.length} 人`
    : paper.authors.join(", ");

  // 已在骨架判断（按 openalex_id）
  const inCart = cart?.items.some((it) => it.openalex_id === paper.openalex_id) ?? false;
  // 推荐分类：后向（遗漏奠基）→ foundation，前向（新前沿）→ frontier
  const recommendCategory = paper.source === "backward" ? "foundation" : "frontier";
  const categoryLabel = recommendCategory === "foundation" ? "奠基理论" : "最新前沿";

  const handleAdd = async () => {
    if (!paper.openalex_id || inCart || adding) return;
    setAdding(true);
    try {
      await addByOpenAlex(projectId, paper.openalex_id, recommendCategory,
        `网络图谱${paper.source === "backward" ? "后向追溯" : "前向追踪"}推荐`);
      // cartStore 内部已自动重载骨架
    } catch (e) {
      toast(`加入失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="card px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-serif text-base font-semibold text-ink leading-snug flex-1">{paper.title}</h3>
        {paper.reason && <span className="badge-blue shrink-0">{paper.reason}</span>}
      </div>
      <div className="flex items-center gap-2 mt-1 text-sm text-ink-muted">
        {paper.year > 0 && <span>{paper.year}</span>}
        {paper.venue && <><span className="text-line">|</span><span>{paper.venue}</span></>}
        {paper.cited_by_count > 0 && <><span className="text-line">|</span><span>被引 {paper.cited_by_count}</span></>}
        {paper.cited_by_n > 0 && <><span className="text-line">|</span><span>共引 {paper.cited_by_n}</span></>}
        {paper.citing_n > 0 && <><span className="text-line">|</span><span>引用 {paper.citing_n}</span></>}
        {authors && <><span className="text-line">|</span><span className="truncate">{authors}</span></>}
      </div>
      {paper.abstract && (
        <div className="mt-2">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-sm text-ink-faint hover:text-ink-muted transition-colors">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "收起" : "摘要"}
          </button>
          {expanded && <p className="mt-2 text-base text-ink-secondary leading-relaxed whitespace-pre-wrap">{paper.abstract}</p>}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-light">
        {/* 一键加入骨架：后向→奠基，前向→前沿 */}
        <button
          onClick={handleAdd}
          disabled={inCart || adding}
          className={inCart
            ? "btn-ghost text-success text-sm cursor-default"
            : "btn-secondary text-sm"}
        >
          {inCart ? (
            <><Check className="w-3 h-3 inline mr-1" />已在骨架</>
          ) : adding ? (
            <><Loader2 className="w-3 h-3 inline mr-1 animate-spin" />加入中...</>
          ) : (
            <><Plus className="w-3 h-3 inline mr-1" />加入{categoryLabel}</>
          )}
        </button>
        {!inCart && (
          <span className="text-2xs text-ink-faint">
            将预选为「{categoryLabel}」
          </span>
        )}
        {paper.doi && <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-sm"><ExternalLink className="w-3 h-3 inline mr-0.5" />DOI</a>}
        {paper.title && <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title.slice(0, 120))}`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-sm">Scholar</a>}
        <div className="flex-1" />
        <span className="badge bg-paper-warm text-ink-muted text-xs">{paper.source === "backward" ? "后向" : "前向"}</span>
      </div>
    </div>
  );
}
