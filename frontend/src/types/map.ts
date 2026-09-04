/**
 * 领域地图类型（T10 地图结构化归纳，独立文件——按域拆分，不并入 types/dto.ts）
 *
 * 数据源：ai_run_maps 表（run 级业务实体，一份快照三端复用）：
 * 对话 MapCard / 工作台 run 区块 / 论文详情页左栏地图导航。
 * 契约：GET/POST /api/search/runs/{id}/map、GET /api/papers/{id}/map。
 */

/** 地图归纳产物（快照）：节点均为 run 内论文，paper_id 可点进详情 */
export interface RunMapPayload {
  topic?: string;
  /** 综述锚点（入门该读谁） */
  anchors?: Array<{ paper_id: number; title: string; year?: number | null; is_survey?: boolean }>;
  /** 方法主线（每条配支撑论文） */
  mainlines?: Array<{ name: string; description?: string; paper_ids: number[] }>;
  /** 活跃问题（被引/近期热点） */
  hotspots?: Array<{ question: string; paper_ids: number[] }>;
  /** 时间演进（可选） */
  evolution?: Array<{
    stage: string;
    description?: string;
    year_from?: number | null;
    year_to?: number | null;
  }>;
  /** true = 规则版（LLM 失败降级生成），前端可标注 */
  fallback?: boolean;
}

export type RunMapStatus = "none" | "generating" | "done" | "failed";

/** run 地图状态与快照（GET/POST /api/search/runs/{id}/map） */
export interface RunMapState {
  status: RunMapStatus;
  topic?: string;
  map?: RunMapPayload;
  /** 地图引用 paper_id → 标题（mainlines/hotspots 只存 ids，读取时后端反查标题；缺失时前端兜底显示 #id） */
  titles?: Record<string, string>;
  model?: string | null;
  error?: string | null;
  created_at?: string | null;
}

/** 论文 → 领域地图（GET /api/papers/{id}/map；transient/无 run 时 status=none） */
export interface PaperMapState extends RunMapState {
  run_id?: number | null;
  run_query?: string | null;
}

/**
 * 论文在领域地图中的位置（详情页定位条数据）。
 * 由前端从快照反查：该 paper_id 出现在哪些综述锚点/方法主线/活跃问题。
 */
export interface PaperMapPosition {
  anchors: string[];
  mainlines: string[];
  hotspots: string[];
}
