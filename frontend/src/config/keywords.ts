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

/** 清透冷调玻璃色，按序循环 */
export const KEYWORD_COLORS: KeywordColor[] = [
  { bg: "rgba(94, 205, 196, 0.12)", border: "rgba(94, 205, 196, 0.32)", text: "#8FE3DA" }, // 淡青
  { bg: "rgba(120, 170, 255, 0.12)", border: "rgba(120, 170, 255, 0.32)", text: "#9FC4FF" }, // 淡蓝
  { bg: "rgba(140, 220, 160, 0.12)", border: "rgba(140, 220, 160, 0.32)", text: "#A9E8BC" }, // 淡绿
  { bg: "rgba(180, 160, 240, 0.12)", border: "rgba(180, 160, 240, 0.32)", text: "#C4B4F5" }, // 淡紫
  { bg: "rgba(110, 200, 230, 0.12)", border: "rgba(110, 200, 230, 0.32)", text: "#8FD8EC" }, // 青蓝
];
