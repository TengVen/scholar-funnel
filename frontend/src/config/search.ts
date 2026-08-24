/**
 * 检索列表静态配置 —— 纯数据，禁止业务实现
 */
import type { SortSpec } from "@/types/domain";

/** 每页论文数 */
export const PAGE_SIZE = 20;

/** 联合排序可选字段（点击顺序 = 排序优先级） */
export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "trunk_score", label: "相关度" },
  { value: "cited_by_count", label: "被引量" },
  { value: "year", label: "年份" },
];

/** 综述筛选 */
export const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "survey", label: "综述" },
  { value: "non_survey", label: "非综述" },
];

/** 默认排序（相关度降序） */
export const DEFAULT_SORT: SortSpec[] = [{ field: "trunk_score", order: "desc" }];
