/**
 * 骨架配额的纯计算层（无 React 依赖）
 *
 * 上限值与后端一致：storage/cart.py 的 CATEGORY_LIMIT_MAX=30 / TOTAL_LIMIT_MAX=50。
 * 此前 30/50 以字面量散落在 CartDetail 的校验与提示文案里，这里收为单一来源。
 */
import { CATEGORIES } from "@/config/categories";
import type { Category } from "@/types/domain";
import type { ProjectLimits } from "@/types/dto";

/** 单类上限 */
export const CATEGORY_LIMIT_MAX = 30;
/** 三类总和上限 */
export const TOTAL_LIMIT_MAX = 50;

function limitFromConfig(cat: Category, fallback: number): number {
  return CATEGORIES.find((c) => c.key === cat)?.limit ?? fallback;
}

/** 项目未配置限额时的默认值（取自分类静态配置） */
export function defaultLimits(): ProjectLimits {
  return {
    foundation: limitFromConfig("foundation", 5),
    mainstream: limitFromConfig("mainstream", 10),
    frontier: limitFromConfig("frontier", 5),
  };
}

/** 服务端限额 → 生效限额（未加载时回退默认） */
export function resolveLimits(limits: ProjectLimits | null | undefined): ProjectLimits {
  return limits ?? defaultLimits();
}

/** 三类限额之和 */
export function totalOf(limits: ProjectLimits): number {
  return Object.values(limits).reduce((a, b) => a + b, 0);
}

/** 取单个分类的限额（缺省键也能安全回退） */
export function limitOf(limits: ProjectLimits, cat: Category): number {
  return limits[cat] ?? defaultLimits()[cat];
}

/**
 * 校验待保存的限额。通过返回 null，否则返回可直接展示的错误文案。
 * 文案与原实现逐字一致，避免改动用户可见提示。
 */
export function validateLimits(limits: ProjectLimits): string | null {
  const vals = Object.values(limits);
  if (vals.some((v) => v < 1 || v > CATEGORY_LIMIT_MAX)) {
    return `每类限额需在 1~${CATEGORY_LIMIT_MAX} 之间`;
  }
  if (vals.reduce((a, b) => a + b, 0) > TOTAL_LIMIT_MAX) {
    return `三类总和不能超过 ${TOTAL_LIMIT_MAX} 篇`;
  }
  return null;
}
