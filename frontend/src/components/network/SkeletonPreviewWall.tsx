"use client";

import type { CartStatus } from "@/types/dto";
import { deepSpaceGradient, STAR_FIELD } from "@/lib/chart/networkChart";
import { StarCluster } from "./StarCluster";

/**
 * 未分析时的三区意境视图：三类骨架各据一方，可单独/全量分析
 */
export function SkeletonPreviewWall({
  cart, analyzing, onAnalyze,
}: {
  cart: CartStatus;
  analyzing: boolean;
  onAnalyze: (cat: string) => void;
}) {
  const counts = {
    foundation: cart.items.filter((it) => it.category === "foundation").length,
    mainstream: cart.items.filter((it) => it.category === "mainstream").length,
    frontier: cart.items.filter((it) => it.category === "frontier").length,
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* 星空背景：铺满整个结果区（CSS 渐变，无边界） */}
      <div
        className="absolute inset-0"
        style={{
          background: deepSpaceGradient("44%"),
        }}
      />
      {/* 金色光晕（铺满背景） */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at 50% 50%, rgba(230,200,121,0.12) 0%, rgba(230,200,121,0.05) 55%, transparent 75%)",
        }}
      />

      {/* 星空内容（SVG 透明背景，居中） */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg viewBox="0 0 680 480" className="w-full max-w-[640px]" role="img"
          aria-label="网络未展开：三类骨架论文各据一方，论文星点环绕主星旋转，等待分析展开引用网络">
          {/* 背景星空（60 颗小星点，错峰闪烁） */}
          {STAR_FIELD.map((s, i) => (
            <circle key={`star${i}`} cx={s.x} cy={s.y} r={s.r} fill={s.c}
              opacity={s.o} className="net-twinkle" style={{ animationDelay: `${s.d}s` }} />
          ))}

          {/* ── 连接三组的淡弧线（三角布局） ── */}
          <path d="M150 165 Q 340 100 530 165" fill="none" stroke="#c9a24b"
            strokeWidth={0.6} strokeDasharray="2 5" opacity={0.22} className="net-dash" />
          <path d="M150 165 Q 200 330 330 330" fill="none" stroke="#c9a24b"
            strokeWidth={0.6} strokeDasharray="2 5" opacity={0.22} className="net-dash"
            style={{ animationDelay: "0.8s" }} />
          <path d="M530 165 Q 480 330 350 330" fill="none" stroke="#c9a24b"
            strokeWidth={0.6} strokeDasharray="2 5" opacity={0.22} className="net-dash"
            style={{ animationDelay: "1.6s" }} />

          {/* ── 三个主星群：三角布局，距离拉开（整体缓慢自转） ── */}
          <StarCluster
            cx={150} cy={162} count={counts.foundation}
            label="奠基理论" labelColor="#A8C6FF" color="#7BA7FF" fill="#5B8FF9"
            radius={44} orbit={68} analyzing={analyzing}
            onAnalyze={() => !analyzing && counts.foundation > 0 && onAnalyze("foundation")}
            disabled={analyzing || counts.foundation === 0}
            orbitDelay={0} spinDelay={0}
          />
          <StarCluster
            cx={530} cy={162} count={counts.frontier}
            label="最新前沿" labelColor="#A8EADF" color="#5FCFBE" fill="#4FAF9F"
            radius={40} orbit={62} analyzing={analyzing}
            onAnalyze={() => !analyzing && counts.frontier > 0 && onAnalyze("frontier")}
            disabled={analyzing || counts.frontier === 0}
            orbitDelay={8} spinDelay={10}
          />
          <StarCluster
            cx={340} cy={330} count={counts.mainstream}
            label="主流方法" labelColor="#FFE9A8" color="#F0CE6E" fill="#D6B35A"
            radius={50} orbit={80} analyzing={analyzing}
            onAnalyze={() => !analyzing && counts.mainstream > 0 && onAnalyze("mainstream")}
            disabled={analyzing || counts.mainstream === 0}
            orbitDelay={4} spinDelay={5}
          />

          {/* ── 底部提示 ── */}
          <text x={340} y={412} textAnchor="middle" fill="#8f8a80" fontSize={12}>
            三类骨架各据一方 · 每篇论文是一颗环绕的星点
          </text>
          <text x={340} y={432} textAnchor="middle" fill="#6b655a" fontSize={11}>
            点击「分析此组」单独展开，或上方「开始全量网络分析」
          </text>
        </svg>
      </div>
    </div>
  );
}
