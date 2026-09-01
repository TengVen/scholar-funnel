/**
 * 关键词玻璃徽章配色 —— 纯数据，禁止业务实现
 *
 * 单一来源（此前在 PaperCard / BranchPanel / CartDetail 三处逐行复制）
 */
export interface KeywordColor {
  bg: string;
  border: string;
  text: string;
}

/** 清透冷调玻璃色，按序循环（2026-09-01 主题化：色相走 aux 变量，深色亮/浅色深） */
export const KEYWORD_COLORS: KeywordColor[] = [
  { bg: "rgb(var(--aux-teal) / 0.12)", border: "rgb(var(--aux-teal) / 0.32)", text: "rgb(var(--aux-teal) / 1)" },   // 淡青
  { bg: "rgb(var(--aux-blue) / 0.12)", border: "rgb(var(--aux-blue) / 0.32)", text: "rgb(var(--aux-blue) / 1)" },   // 淡蓝
  { bg: "rgb(var(--aux-green) / 0.12)", border: "rgb(var(--aux-green) / 0.32)", text: "rgb(var(--aux-green) / 1)" }, // 淡绿
  { bg: "rgb(var(--aux-purple) / 0.12)", border: "rgb(var(--aux-purple) / 0.32)", text: "rgb(var(--aux-purple) / 1)" }, // 淡紫
  { bg: "rgb(var(--aux-cyan) / 0.12)", border: "rgb(var(--aux-cyan) / 0.32)", text: "rgb(var(--aux-cyan) / 1)" },   // 青蓝
];
