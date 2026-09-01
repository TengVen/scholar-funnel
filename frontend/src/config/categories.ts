/**
 * 骨架分类相关静态配置 —— 纯数据，禁止业务实现
 *
 * 单一来源：分类的 key/label/limit/desc、专属色、置信度映射、内容层级标签
 * （此前 CATEGORIES ×2、CATEGORY_COLORS ×2、CATEGORY_GROUPS ×2、KEYWORD_COLORS ×3 散落复制）
 */
import type { Category, Confidence, UsageRole } from "@/types/domain";

// ── 分类基本元信息（label + desc + limit，唯一来源）──

export const CATEGORIES: { key: Category; label: string; limit: number; desc: string }[] = [
  { key: "foundation", label: "奠基理论", limit: 5, desc: "定义核心问题的基础工作" },
  { key: "mainstream", label: "主流方法", limit: 10, desc: "当前领域的主流技术路线" },
  { key: "frontier", label: "最新前沿", limit: 5, desc: "近2年的最新进展" },
];

// ── 分类区块视觉（认知结构卡分组标题：圆点 + 文字色）──
// 2026-09-01 主题化：dot 用 CSS 变量（rgb(var(--cat-*))），color 用 tailwind cat 语义类——
// 深色主题=亮金/亮蓝/亮青，浅色主题=深金/深蓝/深青（globals.css 变量集切换）
export const CATEGORY_SECTION: Record<Category, { dot: string; color: string }> = {
  foundation: { dot: "rgb(var(--cat-foundation) / 1)", color: "text-cat-foundation" },
  mainstream: { dot: "rgb(var(--cat-mainstream) / 1)", color: "text-cat-mainstream" },
  frontier: { dot: "rgb(var(--cat-frontier) / 1)", color: "text-cat-frontier" },
};

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

// ── 分类专属色（亮色版）── 2026-09-01 定版：奠基=金 / 主流=蓝 / 前沿=青（与 CATEGORY_SECTION 对齐，消除旧"蓝金青"矛盾）
// 唯一来源：分类色一律以 CATEGORY_SECTION（dot/color）+ CATEGORY_COLORS（亮色/渐变）为准，禁止组件内另定义

export interface CategoryColors {
  text: string;
  textBright: string;
  bar: string;
  dot: string;
}

export const CATEGORY_COLORS: Record<Category, CategoryColors> = {
  foundation: { text: "#c9a24b", textBright: "#e6c879", bar: "linear-gradient(90deg,#c9a24b,#e6c879,#c9a24b)", dot: "rgba(201,162,75,1)" },
  mainstream: { text: "#7BA7FF", textBright: "#B5D4F4", bar: "linear-gradient(90deg,#7BA7FF,#B5D4F4,#7BA7FF)", dot: "rgba(123,167,255,1)" },
  frontier: { text: "#5FCFBE", textBright: "#9FE1CB", bar: "linear-gradient(90deg,#4FAF9F,#9FE1CB,#4FAF9F)", dot: "rgba(95,207,190,1)" },
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

// ── 探针方法使用角色徽章（分支深挖 · 跨领域重构后）──
// 冷调玻璃徽章（与 KEYWORD_COLORS 同一语言）；金色不进徽章，仅用于"发现/创新"强调行
// 匹配态（core/auxiliary/baseline/comparison）为彩色，非匹配态（mentioned/none）为灰色

export interface RoleStyle {
  label: string;
  dot: string;
  bg: string;
  border: string;
  text: string;
}

export const ROLE_MAP: Record<UsageRole, RoleStyle> = {
  core:       { label: "核心方法", dot: "#5FCFBE", bg: "rgba(95,207,190,0.14)",  border: "rgba(95,207,190,0.34)",  text: "#8FE3DA" },
  auxiliary:  { label: "辅助使用", dot: "#7BA7FF", bg: "rgba(123,167,255,0.14)", border: "rgba(123,167,255,0.34)", text: "#9FC4FF" },
  baseline:   { label: "基线方法", dot: "#B4A0F0", bg: "rgba(180,160,240,0.14)", border: "rgba(180,160,240,0.34)", text: "#C4B4F5" },
  comparison: { label: "对比参照", dot: "#6EC8E6", bg: "rgba(110,200,230,0.14)", border: "rgba(110,200,230,0.34)", text: "#8FD8EC" },
  mentioned:  { label: "仅提及",   dot: "#8A8F98", bg: "rgba(138,143,152,0.14)", border: "rgba(138,143,152,0.34)", text: "#A8ACB4" },
  none:       { label: "未使用",   dot: "#6E6A62", bg: "rgba(110,106,98,0.14)",  border: "rgba(110,106,98,0.34)",  text: "#8A8680" },
};

/** 角色是否属于"匹配"（与后端 _compute_probe_match 规则一致，仅展示用） */
export const ROLE_MATCHED: Record<UsageRole, boolean> = {
  core: true, auxiliary: true, baseline: true, comparison: true,
  mentioned: false, none: false,
};
