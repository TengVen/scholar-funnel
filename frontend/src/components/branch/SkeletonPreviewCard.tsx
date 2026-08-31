"use client";

import { Crosshair } from "lucide-react";
import type { CartItem } from "@/types/dto";
import { KEYWORD_COLORS } from "@/config/keywords";

/**
 * 待分析卡片（未分析论文的占位卡片）
 */
export function SkeletonPreviewCard({ item }: { item: CartItem }) {
  const authors = (item.authors || []).slice(0, 3).join(", ");

  return (
    <div className="rounded-lg px-4 py-3.5 flex flex-col min-h-[130px]
                    border border-dashed border-line bg-paper-white/40">
      {/* Title + 待分析徽章 */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-serif text-base font-semibold text-ink leading-snug flex-1 line-clamp-2">
          {item.title}
        </h4>
        <span className="badge bg-paper-warm text-ink-faint shrink-0 whitespace-nowrap">
          待分析
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 mt-1 text-xs text-ink-faint">
        {item.year && <span>{item.year}</span>}
        {item.cited_by_count > 0 && (
          <>
            <span className="text-line">|</span>
            <span>被引 {item.cited_by_count}</span>
          </>
        )}
        {item.venue && (
          <>
            <span className="text-line">|</span>
            <span className="truncate">{item.venue}</span>
          </>
        )}
        {authors && (
          <>
            <span className="text-line">|</span>
            <span className="truncate">{authors}</span>
          </>
        )}
      </div>

      {/* 分类理由 */}
      {item.notes && (
        <p className="text-xs text-gold-light/70 mt-1.5 flex items-center gap-1">
          <span className="w-1 h-1 rounded-full bg-gold shrink-0" />
          {item.notes}
        </p>
      )}

      {/* 关键词 */}
      {item.keywords && item.keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {item.keywords.slice(0, 4).map((kw, i) => (
            <span
              key={kw}
              className="px-1.5 py-0.5 rounded-md text-2xs backdrop-blur-sm"
              style={{
                background: KEYWORD_COLORS[i % KEYWORD_COLORS.length].bg,
                border: `1px solid ${KEYWORD_COLORS[i % KEYWORD_COLORS.length].border}`,
                color: KEYWORD_COLORS[i % KEYWORD_COLORS.length].text,
              }}
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* Footer 提示 */}
      <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-line-light">
        <span className="text-2xs text-ink-faint flex items-center gap-1">
          <Crosshair className="w-2.5 h-2.5" />
          分析后将显示 方法/匹配/发现
        </span>
      </div>
    </div>
  );
}
