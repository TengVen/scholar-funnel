"use client";

import { orbitSatellites } from "@/lib/chart/networkChart";

/**
 * 单主星群：主星 + 呼吸光环 + 自转装饰 + N 篇环绕星点
 *
 * 纯展示组件，几何计算由 lib/chart/networkChart.ts 的 orbitSatellites 提供。
 * 名称与操作按钮置于旋转组之外，避免跟着自转导致不可读。
 */
export function StarCluster({
  cx, cy, count, label, labelColor, color, fill,
  radius, orbit, analyzing, onAnalyze, disabled, orbitDelay, spinDelay,
}: {
  cx: number; cy: number; count: number;
  label: string; labelColor: string; color: string; fill: string;
  radius: number; orbit: number;
  analyzing: boolean; onAnalyze: () => void; disabled: boolean;
  orbitDelay: number; spinDelay: number;
}) {
  const satellites = orbitSatellites({
    cx, cy, orbit, count, spinSeconds: 26, delayOffset: orbitDelay,
  });

  return (
    <g>
      {/* 星体组：整体缓慢自转（文字/按钮保持在组外，不跟着转） */}
      <g
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: `net-spin 90s linear infinite`,
          animationDelay: `${spinDelay}s`,
        }}
      >
        {/* 呼吸光环（双层） */}
        <circle cx={cx} cy={cy} r={orbit + 10} fill="none" stroke={color}
          strokeWidth={0.7} opacity={0.22} className="net-breathe" />
        <circle cx={cx} cy={cy} r={radius + 12} fill="none" stroke={color}
          strokeWidth={0.8} opacity={0.3} className="net-breathe" style={{ animationDelay: "1.1s" }} />

        {/* 自转装饰虚线环（随整体旋转，视觉增强） */}
        <circle cx={cx} cy={cy} r={radius + 6} fill="none" stroke={color}
          strokeWidth={0.7} strokeDasharray="10 14" opacity={0.4} />

        {/* 环绕论文星点 */}
        {satellites.map((s) => (
          <g key={s.key} className="net-orbit" style={{ transformOrigin: s.origin, animationDelay: s.delay }}>
            <circle cx={s.x} cy={s.y} r={4} fill={color} opacity={0.9} />
            <circle cx={s.x} cy={s.y} r={7} fill="none" stroke={color}
              strokeWidth={0.6} opacity={0.3} />
          </g>
        ))}

        {/* 主星 */}
        <circle cx={cx} cy={cy} r={radius} fill={fill} opacity={0.14} />
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke={color} strokeWidth={1.2} />
        <circle cx={cx} cy={cy} r={7} fill={color} className="net-twinkle" />
      </g>

      {/* 名称 + 数量（不旋转，保持可读） */}
      <text x={cx} y={cy - 14} textAnchor="middle" fill={labelColor}
        fontSize={13.5} fontWeight={500} fontFamily="Georgia, serif">{label}</text>
      <text x={cx} y={cy + 2} textAnchor="middle" fill="#8f8a80" fontSize={11}>
        {count} 篇
      </text>

      {/* 分析此组（不旋转） */}
      <g
        onClick={onAnalyze}
        style={{ cursor: disabled ? "not-allowed" : "pointer" }}
        opacity={disabled ? 0.35 : 1}
      >
        <rect x={cx - 46} y={cy + 26} width={92} height={24} rx={12} fill={fill} opacity={0.16}
          stroke={color} strokeWidth={0.8} />
        <text x={cx} y={cy + 41} textAnchor="middle" fill={labelColor} fontSize={11}>
          {analyzing ? "分析中..." : "分析此组"}
        </text>
      </g>
    </g>
  );
}
