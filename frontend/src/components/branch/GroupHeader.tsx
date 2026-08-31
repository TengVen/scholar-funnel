"use client";

import type { Category } from "@/types/domain";
import { CATEGORY_COLORS } from "@/config/categories";

/**
 * 分组标题：专属色 + 水波流光带 + 单类分析按钮
 */
export function GroupHeader({
  cat, label, count, analyzing, probeEmpty, onAnalyze,
}: {
  cat: string; label: string; count: number;
  analyzing: boolean; probeEmpty: boolean;
  onAnalyze: (cat: string) => void;
}) {
  const c = CATEGORY_COLORS[cat as Category] ?? CATEGORY_COLORS.mainstream;
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-3.5 rounded-full shrink-0" style={{ background: c.dot }} />
        <span className="text-base font-medium" style={{ color: c.text }}>
          {label}
        </span>
        <span className="text-xs text-gold-light tabular-nums font-medium">
          {count} 篇
        </span>
        {/* 单类分析：与标题同风格 + 鎏金边框 360° 环绕（按钮保持原样） */}
        <button
          onClick={() => onAnalyze(cat)}
          disabled={analyzing || count === 0 || probeEmpty}
          className="relative rounded-md overflow-hidden shrink-0
                     disabled:opacity-40 disabled:cursor-not-allowed disabled:[&_.gold-border-rotator]:hidden"
          title={`对「${label}」按当前模式分析`}
        >
          {/* 旋转的鎏金 conic 渐变 */}
          <span
            className="gold-border-rotator absolute"
            style={{
              inset: -30,
              background:
                "conic-gradient(from 0deg, transparent 0deg, transparent 300deg, #F0CE6E 340deg, #FFE9A8 360deg)",
            }}
          />
          {/* 内容层（遮住中间，只露边框） */}
          <span
            className="relative block rounded-[5px] px-2.5 py-1 text-xs font-medium"
            style={{ color: c.textBright, background: "#1e1b17" }}
          >
            单类分析
          </span>
        </button>
      </div>
      {/* 水波流光带（亮色） */}
      <div
        className="flow-bar h-[3px] rounded-full mt-1.5"
        style={{
          backgroundImage: c.bar,
          opacity: 0.85,
          boxShadow: `0 0 8px ${c.dot}55`,
        }}
      />
    </div>
  );
}
