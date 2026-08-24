/**
 * 认证全局状态（zustand）
 *
 * 替代旧的「模块级变量 + Set<Listener> 手写 pub-sub」与 window auth:changed 事件。
 * 编排：调用 lib/auth API → 写入 tokenStore → 更新 user 状态。
 */
import { create } from "zustand";
import {
  apiLogin,
  apiRegister,
  apiUpgradeGuest,
  apiLogout,
  apiMe,
  apiGuest,
} from "@/lib/auth";
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "@/lib/tokenStore";
import type { AuthUser } from "@/types/dto";

interface AuthStore {
  user: AuthUser | null;
  /** 是否已完成初始化（游客兜底/恢复会话） */
  initialized: boolean;
  setUser: (u: AuthUser | null) => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  upgrade: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 启动初始化：有 token → 恢复会话；无 → 自动注册游客 */
  init: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  initialized: false,

  setUser: (user) => set({ user }),

  login: async (username, password) => {
    const res = await apiLogin(username, password);
    setTokens(res.access_token, res.refresh_token);
    set({ user: res.user });
  },

  register: async (username, password, email) => {
    const res = await apiRegister(username, password, email);
    setTokens(res.access_token, res.refresh_token);
    set({ user: res.user });
  },

  upgrade: async (username, password, email) => {
    const res = await apiUpgradeGuest(username, password, email);
    setTokens(res.access_token, res.refresh_token);
    set({ user: res.user });
  },

  logout: async () => {
    const refresh = getRefreshToken();
    if (refresh) {
      try {
        await apiLogout(refresh);
      } catch {
        /* 忽略登出错误 */
      }
    }
    clearTokens();
    set({ user: null });
  },

  init: async () => {
    if (getAccessToken()) {
      try {
        const u = await apiMe();
        set({ user: u, initialized: true });
        return;
      } catch {
        /* token 失效（http 层已派发 auth:expired），继续游客兜底 */
      }
    }
    try {
      const res = await apiGuest();
      setTokens(res.access_token, res.refresh_token);
      set({ user: res.user });
    } catch {
      /* 网络失败，保持未登录 */
    }
    set({ initialized: true });
  },
}));
