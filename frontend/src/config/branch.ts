/**
 * 分支深挖静态配置 —— 纯数据，禁止业务实现
 */
import type { LucideIcon } from "lucide-react";
import { Crosshair, Wand2, Compass } from "lucide-react";
import type { BranchMode } from "@/types/domain";

export interface BranchModeConfig {
  key: BranchMode;
  label: string;
  desc: string;
  icon: LucideIcon;
}

/** 三种深挖模式 */
export const BRANCH_MODES: BranchModeConfig[] = [
  {
    key: "probe_match",
    label: "探针匹配",
    desc: "骨架论文是否用了指定技术？",
    icon: Crosshair,
  },
  {
    key: "ai_suggest",
    label: "AI 推荐",
    desc: "让 AI 自动发现核心技术点",
    icon: Wand2,
  },
  {
    key: "landscape",
    label: "全景扫描",
    desc: "逐篇拆解方法论全貌",
    icon: Compass,
  },
];
