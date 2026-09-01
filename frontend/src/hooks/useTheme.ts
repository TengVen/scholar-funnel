"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from "@/config/theme";

/**
 * 主题切换 hook（多主题架构）：
 * - 首次挂载：读 localStorage（校验 key 合法，否则回退默认）→ 应用到 html[data-theme]
 * - setTheme：应用 + 持久化
 * 组件无需感知主题实现（CSS 变量切换由 globals.css 承担）。
 */
export function useTheme() {
  const [theme, setThemeState] = useState<string>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      const valid = saved && THEMES.some((t) => t.key === saved);
      const t = valid ? (saved as string) : DEFAULT_THEME;
      setThemeState(t);
      document.documentElement.dataset.theme = t;
    } catch {
      /* localStorage 不可用时保持默认 */
    }
  }, []);

  const setTheme = useCallback((t: string) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      /* 忽略持久化失败 */
    }
  }, []);

  /** 循环切到下一个主题（切换按钮用） */
  const cycleTheme = useCallback(() => {
    const idx = THEMES.findIndex((t) => t.key === theme);
    const next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next.key);
  }, [theme, setTheme]);

  return { theme, setTheme, cycleTheme };
}
