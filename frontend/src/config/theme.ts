/**
 * 主题注册表（config/theme.ts）——纯静态数据，唯一来源。
 * 多主题架构（2026-09-01）：每套主题 = globals.css 里一组 CSS 变量集；
 * 新增主题只需：① 这里加一条 ② globals.css 加 [data-theme="x"] 变量集。
 */
export interface ThemeDef {
  key: string;
  label: string;
}

export const THEMES: ThemeDef[] = [
  { key: "dark", label: "深色墨黑" },
  { key: "light", label: "暖米白" },
  { key: "ivory", label: "象牙白" },
  { key: "frost", label: "雾蓝灰" },
];

export const THEME_STORAGE_KEY = "scholar_funnel_theme";
export const DEFAULT_THEME = "dark";
