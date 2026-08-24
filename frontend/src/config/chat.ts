/**
 * 对话页静态配置 —— 纯数据，禁止业务实现
 */
import type { LucideIcon } from "lucide-react";
import { Info, AlertTriangle, AlertCircle } from "lucide-react";
import type { AnnouncementLevel, ChatConfig } from "@/types/domain";

/** 对话页默认配置（分组：search / dialog / advanced / llm） */
export const DEFAULT_CONFIG: ChatConfig = {
  search: {
    yearFrom: "",
    yearTo: "",
    paperType: "all",
    techProbe: "",
  },
  dialog: {
    temperature: 0.2,
  },
  advanced: {
    topK: 100,
    scoreThreshold: 0,
  },
  llm: {},
};

/** 空态示例研究方向 */
export const SUGGESTIONS: string[] = [
  "风力发电功率预测",
  "Transformer 与 CNN 在图像修复中的效果对比",
  "知识蒸馏在推荐系统中的应用",
  "多智能体协作推理的研究现状",
];

/** 模型选择项（后台内置 API Key，仅切换模型） */
export const LLM_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];

/** 公告级别样式（颜色 / 文案 / 图标 / 底色淡染）——icon 存组件引用，保持纯数据 */
export const ANN_LEVEL_STYLE: Record<AnnouncementLevel, { color: string; label: string; icon: LucideIcon; bg: string }> = {
  info: {
    color: "#5B8FF9",
    label: "公告",
    icon: Info,
    bg: "rgba(91,143,249,0.10)",
  },
  warning: {
    color: "#c9a24b",
    label: "提醒",
    icon: AlertTriangle,
    bg: "rgba(201,162,75,0.10)",
  },
  danger: {
    color: "#e24b4a",
    label: "重要",
    icon: AlertCircle,
    bg: "rgba(226,75,74,0.10)",
  },
};
