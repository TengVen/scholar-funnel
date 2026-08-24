/**
 * 系统公告 Hook —— 拉取 + 未读状态（浏览器本地持久化）
 *
 * 从 ChatConfigBar 中拆出：公告数据、已读集合、标记已读逻辑不再属于 UI。
 */
import { useCallback, useEffect, useState } from "react";
import { getAnnouncements } from "@/lib/api/settings";
import { STORAGE_KEYS } from "@/config/storage";
import type { Announcement } from "@/types/dto";

function loadReadAnns(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.announcementRead) || "[]"));
  } catch {
    return new Set();
  }
}

function saveReadAnns(s: Set<number>) {
  try {
    localStorage.setItem(STORAGE_KEYS.announcementRead, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export function useAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [readAnns, setReadAnns] = useState<Set<number>>(loadReadAnns);

  // 挂载时拉取（失败静默，不影响对话）
  useEffect(() => {
    getAnnouncements().then(setAnnouncements).catch(() => {});
  }, []);

  const unreadCount = announcements.filter((a) => !readAnns.has(a.id)).length;

  const markAllRead = useCallback(() => {
    setReadAnns((prev) => {
      const next = new Set(prev);
      announcements.forEach((a) => next.add(a.id));
      saveReadAnns(next);
      return next;
    });
  }, [announcements]);

  const markRead = useCallback((id: number) => {
    setReadAnns((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveReadAnns(next);
      return next;
    });
  }, []);

  const isRead = useCallback((id: number) => readAnns.has(id), [readAnns]);

  return { announcements, unreadCount, markAllRead, markRead, isRead };
}
