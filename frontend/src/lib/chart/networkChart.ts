/**
 * 网络图谱的"数据 → 视觉"映射（纯函数层，无 React / 无 echarts 运行时依赖）
 *
 * 从 NetworkPanel 外移（2026-08-30）：组件只负责挂载 echarts 实例与呈现，
 * 配色、option 构建、星空背景等视觉映射集中在这里复用。
 * 原则依据：AGENTS.md §5「UI 负责呈现，复杂逻辑抽象复用」。
 */
import type { EChartsOption } from "echarts";
import type { NetworkResultResponse } from "@/types/dto";

/** 星图配色：骨架三分类（与全站分类色一致）+ 推荐两类 */
export const NETWORK_CATEGORIES = [
  { name: "奠基理论", itemStyle: { color: "#7BA7FF", shadowColor: "rgba(123,167,255,0.8)" } },
  { name: "主流方法", itemStyle: { color: "#F0CE6E", shadowColor: "rgba(240,206,110,0.8)" } },
  { name: "最新前沿", itemStyle: { color: "#5FCFBE", shadowColor: "rgba(95,207,190,0.8)" } },
  { name: "后向推荐", itemStyle: { color: "#d4a54e", shadowColor: "rgba(212,165,78,0.6)" } },
  { name: "前向推荐", itemStyle: { color: "#6fbfa0", shadowColor: "rgba(111,191,160,0.6)" } },
] as const;

const CATEGORY_INDEX: Record<string, number> = {
  foundation: 0, mainstream: 1, frontier: 2, skeleton: 0,
  backward: 3, forward: 4,
};

/** 深空背景（三处复用，仅对焦位置略有差异） */
export function deepSpaceGradient(focusY: string): string {
  return `radial-gradient(ellipse at 50% ${focusY}, #2e2820 0%, #221d16 32%, #171410 60%, #0e0c0a 82%, #0a0908 100%)`;
}

/** 背景星空（确定性伪随机，避免每次渲染抖动） */
export const STAR_FIELD = Array.from({ length: 60 }, (_, i) => {
  const x = 20 + ((i * 137.3) % 640);
  const y = 18 + ((i * 89.7) % 440);
  const r = 0.7 + ((i * 7.1) % 10) / 5;
  const o = 0.14 + ((i * 13.7) % 20) / 40;
  const d = ((i * 29.3) % 48) / 10;
  const c = i % 3 === 0 ? "#e6c879" : i % 3 === 1 ? "#b8b0a4" : "#8fd8ec";
  return { x, y, r, o, d, c };
});

/** 由分析结果构建 echarts 力导向图 option（组件拿到即用，不再拼装视觉参数） */
export function buildNetworkChartOption(result: NetworkResultResponse): EChartsOption {
  const categories = NETWORK_CATEGORIES.map((c) => ({ name: c.name, itemStyle: { ...c.itemStyle } }));

  return {
    backgroundColor: "transparent",
    tooltip: {
      backgroundColor: "rgba(23,22,20,0.92)",
      borderColor: "#3a332a",
      textStyle: { color: "#f0ece4", fontSize: 12 },
      formatter: (p: { dataType: string; data?: { name: string; year?: number; cited?: number }; name?: string; value?: number; label?: { name: string } }) => {
        const d = p.data ?? {} as { name: string; year?: number; cited?: number };
        const title = (d.name ?? p.label?.name ?? p.name ?? "").slice(0, 60);
        let html = `<div style="font-weight:500;color:#f0ece4;max-width:260px">${title}</div>`;
        if (d.year) html += `<div style="color:#8f8a80;font-size:11px;margin-top:2px">${d.year} 年</div>`;
        if (d.cited) html += `<div style="color:#8f8a80;font-size:11px">被引 ${d.cited}</div>`;
        if (p.dataType === "edge" && p.value) html += `<div style="color:#8f8a80;font-size:11px">${p.value}</div>`;
        return html;
      },
    },
    legend: {
      data: categories.map((c) => c.name),
      top: 8, left: "center",
      itemWidth: 10, itemHeight: 10,
      textStyle: { color: "#8f8a80", fontSize: 11 },
      icon: "circle",
    },
    series: [{
      type: "graph", layout: "force", roam: true,
      draggable: true,
      label: {
        show: true, fontSize: 10, position: "right",
        color: "#b8b0a4", formatter: (p: { data?: { name: string } }) => (p.data?.name ?? "").slice(0, 18),
      },
      edgeSymbol: ["", "arrow"], edgeSymbolSize: [0, 7],
      lineStyle: {
        color: "#4a4238", opacity: 0.55,
        width: 1, type: "dashed", dashOffset: 4,
        curveness: 0.15,
      },
      force: {
        repulsion: 260, gravity: 0.08,
        edgeLength: [60, 170], layoutAnimation: true,
      },
      data: result.graph_nodes.map((n) => {
        const ci = CATEGORY_INDEX[n.category] ?? 0;
        const isSkeleton = n.group === "skeleton";
        return {
          id: n.id,
          name: n.label,
          symbolSize: isSkeleton ? n.size + 6 : n.size + 4,
          category: ci,
          value: n.year,
          itemStyle: {
            color: categories[ci].itemStyle.color,
            borderColor: isSkeleton ? "#ffffff55" : "#00000000",
            borderWidth: isSkeleton ? 2 : 1,
            shadowBlur: isSkeleton ? 18 : 12,
            shadowColor: categories[ci].itemStyle.shadowColor,
            opacity: 1,
          },
          // 骨架节点加光环（第二个装饰圆）
          symbolOffset: [0, 0],
          emphasis: {
            itemStyle: {
              shadowBlur: 30,
              shadowColor: categories[ci].itemStyle.shadowColor,
              borderColor: "#ffffff88",
              borderWidth: 2,
            },
          },
        };
      }),
      links: result.graph_edges.map((e) => ({
        source: e.source_id, target: e.target_id,
        value: e.label,
      })),
      categories: categories.map((c) => ({ name: c.name })),
      emphasis: { focus: "adjacency", lineStyle: { width: 3, opacity: 0.9, color: "#e6c879" } },
    }],
  } as EChartsOption;
}
