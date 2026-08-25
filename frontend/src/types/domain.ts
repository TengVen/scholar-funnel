/**
 * 前端领域模型与联合类型 —— 纯类型，禁止业务实现
 *
 * 依赖方向：domain.ts 不依赖任何文件；dto.ts 依赖 domain.ts。
 */

// ── 基础联合类型 ──

/** 五大主页面 */
export type Page = "search" | "cart" | "branch" | "network" | "chat";

/** 骨架论文分类（5/10/5 限额三类） */
export type Category = "foundation" | "mainstream" | "frontier";

/** 分析置信度 */
export type Confidence = "high" | "medium" | "low" | "none";

/** 公告级别 */
export type AnnouncementLevel = "info" | "warning" | "danger";

/** 用户角色 */
export type UserRole = "guest" | "user" | "admin";

/** 任务轮询状态（保留 string 兜底，兼容后端未来新增状态） */
export type TaskStatusState = "pending" | "running" | "done" | "error" | (string & {});

/** 缺口补充检索结果状态 */
export type GapSearchStatus = "ok" | "low_results" | "empty";

/** 分支深挖模式 */
export type BranchMode = "probe_match" | "ai_suggest" | "landscape";

/** 多字段联合排序项（后点优先，每字段独立方向） */
export interface SortSpec {
  field: string;
  order: "asc" | "desc";
}

// ── LLM 运行时配置（settings API 的 DTO，同时是 ChatConfig 的一部分）──

export interface LLMConfig {
  api_key?: string;
  base_url?: string;
  model?: string;
}

// ── 对话页配置（按 search / dialog / advanced / llm 分组）──

export interface ChatConfig {
  /** 检索参数 */
  search: {
    yearFrom: string;
    yearTo: string;
    paperType: "all" | "survey" | "original";
    techProbe: string;
  };
  /** 对话参数 */
  dialog: {
    temperature: number;
  };
  /** 高级选项 */
  advanced: {
    topK: number;
    scoreThreshold: number;
    /** embedding / rerank 模型来源：local=本地模型，api=SiliconFlow API（本地未识别时后端自动回退 api） */
    modelProvider: "local" | "api";
  };
  /** 模型配置（后台内置 API Key，仅切换模型） */
  llm: LLMConfig;
}
