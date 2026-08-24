/**
 * 骨架分类相关静态配置 —— 纯数据，禁止业务实现
 *
 * 单一来源：分类的 key/label/limit/desc、专属色、置信度映射、内容层级标签
 * （此前 CATEGORIES ×2、CATEGORY_COLORS ×2、CATEGORY_GROUPS ×2、KEYWORD_COLORS ×3 散落复制）
 */
import type { Category, Confidence } from "@/types/domain";

// ── 分类基本元信息（label + desc + limit，唯一来源）──

export const CATEGORIES: { key: Category; label: string; limit: number; desc: string }[] = [
  { key: "foundation", label: "奠基理论", limit: 5, desc: "定义核心问题的基础工作" },
  { key: "mainstream", label: "主流方法", limit: 10, desc: "当前领域的主流技术路线" },
  { key: "frontier", label: "最新前沿", limit: 5, desc: "近2年的最新进展" },
];

/** 分类 → label/desc（GapPanel 等按 key 查） */
export const CATEGORY_META: Record<Category, { label: string; desc: string }> = {
  foundation: { label: "奠基理论", desc: "定义核心问题的基础工作" },
  mainstream: { label: "主流方法", desc: "当前主流技术路线" },
  frontier: { label: "最新前沿", desc: "近两年最新进展" },
};

/** 分类分组（key + label，分支/网络页共用） */
export const CATEGORY_GROUPS: { key: Category; label: string }[] = [
  { key: "foundation", label: "奠基理论" },
  { key: "mainstream", label: "主流方法" },
  { key: "frontier", label: "最新前沿" },
];

// ── 分类专属色（亮色版，与顶部导航珠宝色统一）+ 流光渐变对 ──

export interface CategoryColors {
  text: string;
  textBright: string;
  bar: string;
  dot: string;
}

export const CATEGORY_COLORS: Record<Category, CategoryColors> = {
  foundation: { text: "#7BA7FF", textBright: "#A8C6FF", bar: "linear-gradient(90deg,#5B8FF9,#B7D2FF,#5B8FF9)", dot: "rgba(123,167,255,1)" },
  mainstream: { text: "#F0CE6E", textBright: "#FFE9A8", bar: "linear-gradient(90deg,#D6B35A,#FFE9A8,#D6B35A)", dot: "rgba(240,206,110,1)" },
  frontier: { text: "#5FCFBE", textBright: "#A8EADF", bar: "linear-gradient(90deg,#4FAF9F,#A8EADF,#4FAF9F)", dot: "rgba(95,207,190,1)" },
};

// ── 手动选择分类时的默认理由 ──

export const CATEGORY_NOTES: Record<Category, string> = {
  foundation: "手动选择：奠基理论类",
  mainstream: "手动选择：主流方法类",
  frontier: "手动选择：最新前沿类",
};

// ── 置信度映射（分支深挖：探针匹配徽章）──

export const CONFIDENCE_MAP: Record<Confidence, { label: string; cls: string }> = {
  high: { label: "高度匹配", cls: "bg-emerald-500/15 text-emerald-300" },
  medium: { label: "中等匹配", cls: "bg-amber-500/15 text-amber-300" },
  low: { label: "低度匹配", cls: "bg-orange-500/15 text-orange-300" },
  none: { label: "未匹配", cls: "bg-paper-warm text-ink-muted" },
};

/** 置信度映射（缺口补充：候选置信徽章；文案与分支页不同，故保留独立项） */
export const CONFIDENCE_LABEL: Record<Exclude<Confidence, "none">, { text: string; cls: string }> = {
  high: { text: "高置信", cls: "badge-green" },
  medium: { text: "中置信", cls: "badge-amber" },
  low: { text: "低置信", cls: "bg-red-500/15 text-red-400 badge" },
};

// ── 内容来源层级标签（分支深挖）──

export const LEVEL_LABELS: Record<number, string> = {
  1: "PDF 全文",
  2: "HTML 全文",
  3: "LLM 回忆",
  4: "引用上下文",
  5: "仅摘要",
};
