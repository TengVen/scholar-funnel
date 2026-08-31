"use client";

import type { CSSProperties } from "react";
import { Layers } from "lucide-react";
import type { BranchPaperResult, CartStatus } from "@/types/dto";
import { CATEGORY_COLORS, CATEGORY_GROUPS } from "@/config/categories";
import { GroupHeader } from "./GroupHeader";
import { SkeletonPreviewCard } from "./SkeletonPreviewCard";
import { BranchSquareCard } from "./BranchSquareCard";
import { LandscapeCard } from "./LandscapeCard";

/**
 * 三类混合视图：始终展示全部三类
 * - 已分析（result 中有 paper_id）→ 结果卡（landscape 用 LandscapeCard，其余用 BranchSquareCard）
 * - 未分析 → 待分析卡 SkeletonPreviewCard
 * - 该组正在分析 → 整组鎏金涟漪波纹 + 半透明降级其他组
 */
export function BranchMixedView({
  cart, result, mode, analyzing, analyzingCat, probeEmpty, onAnalyze,
}: {
  cart: CartStatus;
  result: { results: BranchPaperResult[] } | null;
  mode: string;
  analyzing: boolean;
  analyzingCat: string;
  probeEmpty: boolean;
  onAnalyze: (cat: string) => void;
}) {
  // 已分析论文的 paper_id → 结果 映射
  const analyzedMap = new Map<number, BranchPaperResult>();
  result?.results.forEach((p) => analyzedMap.set(p.paper_id, p));

  return (
    <div className="space-y-5">
      {/* 提示条 */}
      <div className="flex items-center gap-2 text-sm text-ink-muted bg-paper-warm rounded-lg px-4 py-2.5">
        <Layers className="w-3.5 h-3.5 text-gold-light shrink-0" />
        <span>
          {result && result.results.length > 0
            ? `已深挖 ${result.results.length} 篇，未分析的分类仍显示待分析卡片`
            : `当前为骨架中的 ${cart.total} 篇论文，选择上方模式点击「全量分析」，或点分类旁的「单类分析」只深挖那一类`}
        </span>
      </div>

      {CATEGORY_GROUPS.map(({ key, label }) => {
        const items = cart.items.filter((it) => it.category === key);
        if (items.length === 0) return null;
        const isAnalyzing = analyzing && analyzingCat === key;
        const c = CATEGORY_COLORS[key] ?? CATEGORY_COLORS.mainstream;
        return (
          <div
            key={key}
            className={`relative rounded-xl transition-opacity ${isAnalyzing ? "" : analyzing ? "opacity-60" : ""}`}
            style={isAnalyzing ? ({ "--ripple-color": `${c.dot}88` } as CSSProperties) : undefined}
          >
            {/* 分析中：鎏金涟漪波纹（三层扩散） */}
            {isAnalyzing && (
              <>
                <span className="ripple-ring absolute inset-0 rounded-xl pointer-events-none" />
                <span className="ripple-ring-2 absolute inset-0 rounded-xl pointer-events-none" />
                <span className="ripple-ring-3 absolute inset-0 rounded-xl pointer-events-none" />
              </>
            )}
            {/* 分析中：组容器鎏金亮边 */}
            <div
              className={isAnalyzing ? "rounded-xl border border-gold/60 bg-accent-light/20 -m-px" : ""}
              style={isAnalyzing ? { boxShadow: `0 0 16px ${c.dot}33` } : undefined}
            />
            <div className="relative">
              <GroupHeader
                cat={key} label={label} count={items.length}
                analyzing={isAnalyzing} probeEmpty={probeEmpty} onAnalyze={onAnalyze}
              />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                {items.map((item) => {
                  const analyzed = analyzedMap.get(item.paper_id);
                  return analyzed ? (
                    mode === "landscape" ? (
                      <LandscapeCard key={item.paper_id} paper={analyzed} />
                    ) : (
                      <BranchSquareCard key={item.paper_id} paper={analyzed} mode={mode} />
                    )
                  ) : (
                    <SkeletonPreviewCard key={item.paper_id} item={item} />
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
