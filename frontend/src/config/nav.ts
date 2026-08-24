/**
 * 顶部导航静态配置 —— 纯数据，禁止业务实现
 */
import type { LucideIcon } from "lucide-react";
import {
  Search,
  Puzzle,
  GitBranch,
  Network,
  MessageSquare,
} from "lucide-react";
import type { Page } from "@/types/domain";

export interface NavTab {
  key: Page;
  label: string;
  icon: LucideIcon;
  color: string;
  glow: string;
}

/** 低饱和珠宝色导航（5 段，居中对称） */
export const NAV_TABS: NavTab[] = [
  { key: "chat", label: "对话", icon: MessageSquare, color: "#D6B35A", glow: "rgba(214,179,90,0.18)" },
  { key: "search", label: "检索", icon: Search, color: "#5B8FF9", glow: "rgba(91,143,249,0.18)" },
  { key: "cart", label: "骨架", icon: Puzzle, color: "#D4AF37", glow: "rgba(212,175,55,0.18)" },
  { key: "branch", label: "分支", icon: GitBranch, color: "#9B7ED8", glow: "rgba(155,126,216,0.18)" },
  { key: "network", label: "网络", icon: Network, color: "#4FAF9F", glow: "rgba(79,175,159,0.18)" },
];
