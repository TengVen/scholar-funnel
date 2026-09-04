/**
 * lib/map/format.ts —— 领域地图呈现纯函数（供 MapCard / 详情页地图导航 / 工作台复用）
 *
 * 只做数据派生：论文在地图中的位置、地图规模统计、节点去重计数。
 * 无 React 依赖，可独立单测。
 */
import type { PaperMapPosition, RunMapPayload } from "@/types/map";

/** 地图规模摘要（标题栏/折叠态用）：主线数 / 热点数 / 锚点数 */
export function mapStats(payload?: RunMapPayload): { anchors: number; mainlines: number; hotspots: number } {
  return {
    anchors: payload?.anchors?.length ?? 0,
    mainlines: payload?.mainlines?.length ?? 0,
    hotspots: payload?.hotspots?.length ?? 0,
  };
}

/** 一篇论文在领域地图中的位置（出现在哪些锚点/主线/热点）；未出现 → 各数组为空 */
export function locatePaper(payload: RunMapPayload | undefined, paperId: number): PaperMapPosition {
  const position: PaperMapPosition = { anchors: [], mainlines: [], hotspots: [] };
  if (!payload) return position;
  for (const a of payload.anchors ?? []) {
    if (a.paper_id === paperId) position.anchors.push(a.title || `锚点 #${a.paper_id}`);
  }
  for (const m of payload.mainlines ?? []) {
    if (m.paper_ids.includes(paperId)) position.mainlines.push(m.name);
  }
  for (const h of payload.hotspots ?? []) {
    if (h.paper_ids.includes(paperId)) position.hotspots.push(h.question);
  }
  return position;
}

/** 地图内所有论文 id（锚点/主线/热点去重；用于"该论文是否被地图覆盖"等判断） */
export function mapPaperIds(payload?: RunMapPayload): Set<number> {
  const ids = new Set<number>();
  if (!payload) return ids;
  for (const a of payload.anchors ?? []) ids.add(a.paper_id);
  for (const m of payload.mainlines ?? []) for (const pid of m.paper_ids) ids.add(pid);
  for (const h of payload.hotspots ?? []) for (const pid of h.paper_ids) ids.add(pid);
  return ids;
}
