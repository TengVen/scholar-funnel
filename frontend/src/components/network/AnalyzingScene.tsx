"use client";

import type { CartStatus } from "@/types/dto";
import type { Category } from "@/types/domain";
import { CATEGORY_COLORS, CATEGORY_GROUPS } from "@/config/categories";
import { deepSpaceGradient, orbitSatellites, STAR_FIELD } from "@/lib/chart/networkChart";

/**
 * 分析中：被分析的主星放大占主视野 + 轻量解析动画
 *
 * 星点绕主星加速旋转（8s/圈），与静态态的 26s/圈形成"解析感"对比。
 */
export function AnalyzingScene({
  category, cart, progress,
}: {
  category: string;
  cart: CartStatus | null;
  progress: string;
}) {
  const c = CATEGORY_COLORS[category as Category] ?? CATEGORY_COLORS.mainstream;
  const label = CATEGORY_GROUPS.find((g) => g.key === category)?.label ?? "全部骨架";
  const count = category
    ? cart?.items.filter((it) => it.category === category).length ?? 0
    : cart?.total ?? 0;

  const cx = 340;
  const cy = 235;
  const orbit = 130;      // 环绕轨道（放大后）
  const radius = 64;      // 主星（放大）

  // 环绕星点：加速旋转（8s/圈），分析中的"解析感"
  // 即使 0 篇也保留 1 颗，避免空场
  const satellites = orbitSatellites({
    cx, cy, orbit, count, spinSeconds: 8, minCount: 1,
  });

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* 星空背景（复用意境背景） */}
      <div
        className="absolute inset-0"
        style={{
          background: deepSpaceGradient("46%"),
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 50% 50%, ${c.dot}26 0%, ${c.dot}10 45%, transparent 70%)`,
        }}
      />

      {/* 内容：放大主星 + 环绕星点 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg viewBox="0 0 680 480" className="w-full max-w-[640px]" role="img"
          aria-label={`正在分析${label}`}>
          {/* 背景星空 */}
          {STAR_FIELD.map((s, i) => (
            <circle key={`star${i}`} cx={s.x} cy={s.y} r={s.r} fill={s.c}
              opacity={s.o} className="net-twinkle" style={{ animationDelay: `${s.d}s` }} />
          ))}

          {/* 呼吸大光环 */}
          <circle cx={cx} cy={cy} r={orbit + 26} fill="none" stroke={c.textBright}
            strokeWidth={0.8} opacity={0.22} className="net-breathe" />
          <circle cx={cx} cy={cy} r={orbit + 10} fill="none" stroke={c.textBright}
            strokeWidth={1} opacity={0.3} className="net-breathe" style={{ animationDelay: "0.9s" }} />

          {/* 自转虚线环 */}
          <circle cx={cx} cy={cy} r={orbit + 16} fill="none" stroke={c.textBright}
            strokeWidth={0.7} strokeDasharray="10 14" opacity={0.4}
            style={{ transformOrigin: `${cx}px ${cy}px`, animation: "net-spin 40s linear infinite" }} />

          {/* 环绕星点（加速解析） */}
          {satellites.map((s) => (
            <g key={s.key} className="net-orbit-fast"
              style={{ transformOrigin: s.origin, animationDelay: s.delay }}>
              <circle cx={s.x} cy={s.y} r={5} fill={c.textBright} opacity={0.95} />
              <circle cx={s.x} cy={s.y} r={9} fill="none" stroke={c.textBright}
                strokeWidth={0.7} opacity={0.35} />
            </g>
          ))}

          {/* 主星（放大） */}
          <circle cx={cx} cy={cy} r={radius} fill={c.dot} opacity={0.14} />
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke={c.textBright} strokeWidth={1.4} />
          <circle cx={cx} cy={cy} r={10} fill={c.textBright} className="net-twinkle" />

          {/* 名称 + 状态 */}
          <text x={cx} y={cy - 24} textAnchor="middle" fill={c.textBright}
            fontSize={15} fontWeight={500} fontFamily="Georgia, serif">{label}</text>
          <text x={cx} y={cy - 6} textAnchor="middle" fill="#8f8a80" fontSize={11.5}>
            {count} 篇论文 · 正在解析引用网络
          </text>

          {/* 进度 */}
          <text x={cx} y={cy + radius + 26} textAnchor="middle" fill="#b8b0a4" fontSize={12}>
            {progress || "正在检索引用关系..."}
          </text>
        </svg>
      </div>
    </div>
  );
}
