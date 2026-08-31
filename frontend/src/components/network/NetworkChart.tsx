"use client";

import { useEffect, useRef, useState } from "react";
import type { NetworkResultResponse } from "@/types/dto";
import { buildNetworkChartOption, deepSpaceGradient, STAR_FIELD } from "@/lib/chart/networkChart";

/**
 * 引用网络力导向图（echarts 懒加载）
 *
 * echarts 走动态 import，加载失败时降级为文本提示，不拖垮整个面板。
 */
export function NetworkChart({ result }: { result: NetworkResultResponse }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{ dispose: () => void; resize?: () => void } | null>(null);
  const [chartError, setChartError] = useState(false);

  useEffect(() => {
    if (!chartRef.current) return;
    let disposed = false;
    // 用 instanceRef 而非闭包 chart：init 是异步的，onResize 需要在 chart 就绪后仍可引用
    const onResize = () => instanceRef.current?.resize?.();
    const init = async () => {
      try {
        // 动态加载 echarts：任何失败（chunk 404/网络抖动）降级为文本提示，不拖垮整个面板
        const echarts = await import("echarts");
        if (disposed) return;
        if (instanceRef.current) instanceRef.current.dispose();
        const chart = echarts.init(chartRef.current!);
        instanceRef.current = chart;
        setChartError(false);

        // 星图配色与 option 构建已外移 lib/chart/networkChart.ts（纯函数，组件只消费）
        chart.setOption(buildNetworkChartOption(result));
        window.addEventListener("resize", onResize);
      } catch (e) {
        console.error("echarts 渲染失败，图谱降级", e);
        setChartError(true);
      }
    };
    init();
    return () => {
      window.removeEventListener("resize", onResize);
      if (instanceRef.current) instanceRef.current.dispose();
      disposed = true;
    };
  }, [result]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-gold/25 bg-paper-warm">
      {/* 深空背景（与初始态一致） */}
      <div
        className="absolute inset-0"
        style={{
          background: deepSpaceGradient("40%"),
        }}
      />
      {/* 背景星点 */}
      <div className="absolute inset-0 overflow-hidden">
        {STAR_FIELD.slice(0, 36).map((s, i) => (
          <span key={`gstar${i}`} className="absolute rounded-full net-twinkle"
            style={{
              left: `${(s.x / 680) * 100}%`,
              top: `${(s.y / 480) * 100}%`,
              width: s.r * 1.6, height: s.r * 1.6,
              background: s.c, opacity: s.o * 0.8,
              animationDelay: `${s.d}s`,
            }} />
        ))}
      </div>
      {/* 图表本体（echarts 加载失败时降级为文本提示，不拖垮面板） */}
      {chartError ? (
        <div className="relative flex items-center justify-center" style={{ height: 420 }}>
          <p className="text-sm text-ink-faint">图谱组件加载失败，下方论文列表仍可正常使用</p>
        </div>
      ) : (
        <div ref={chartRef} className="relative" style={{ height: 420 }} />
      )}
    </div>
  );
}
