/**
 * localStorage 配置同步 Hook
 *
 * 规约（防 hydration 崩溃）：首屏用 fallback（服务端/客户端一致），
 * 水合完成后 useEffect 再加载存储值 → 纯客户端更新，不会 SSR 不匹配。
 * 写入时同步持久化。
 */
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CONFIG } from "@/config/chat";
import type { ChatConfig } from "@/types/domain";

export function useLocalStorageConfig<T>(
  key: string,
  fallback: T,
  migrate?: (raw: unknown) => T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        setValue(migrate ? migrate(parsed) : (parsed as T));
      }
    } catch {
      /* ignore */
    }
    // key 变化时重载；migrate/fallback 视为稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  return [value, set];
}

// ── ChatConfig 专属：旧扁平结构 → 分组结构迁移 ──

function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function str(v: unknown, d: string): string {
  return typeof v === "string" ? v : d;
}

/**
 * 兼容两种存储形态：
 * - 旧扁平：{ yearFrom, yearTo, paperType, techProbe, temperature, topK, scoreThreshold, llm }
 * - 新分组：{ search:{...}, dialog:{...}, advanced:{...}, llm:{...} }
 * 保证 localStorage key 不变、旧数据无损迁移。
 */
export function normalizeChatConfig(raw: unknown): ChatConfig {
  const src = (raw ?? {}) as Record<string, unknown>;
  const searchSrc = ("search" in src && typeof src.search === "object" ? (src.search as Record<string, unknown>) : src);
  const dialogSrc = "dialog" in src && typeof src.dialog === "object" ? (src.dialog as Record<string, unknown>) : src;
  const advSrc = "advanced" in src && typeof src.advanced === "object" ? (src.advanced as Record<string, unknown>) : src;

  const paperType = searchSrc.paperType === "survey" || searchSrc.paperType === "original"
    ? searchSrc.paperType
    : DEFAULT_CONFIG.search.paperType;

  return {
    search: {
      yearFrom: str(searchSrc.yearFrom, DEFAULT_CONFIG.search.yearFrom),
      yearTo: str(searchSrc.yearTo, DEFAULT_CONFIG.search.yearTo),
      paperType,
      techProbe: str(searchSrc.techProbe, DEFAULT_CONFIG.search.techProbe),
    },
    dialog: {
      temperature: num(dialogSrc.temperature, DEFAULT_CONFIG.dialog.temperature),
    },
    advanced: {
      topK: num(advSrc.topK, DEFAULT_CONFIG.advanced.topK),
      scoreThreshold: num(advSrc.scoreThreshold, DEFAULT_CONFIG.advanced.scoreThreshold),
    },
    llm: src.llm && typeof src.llm === "object" ? (src.llm as ChatConfig["llm"]) : {},
  };
}
