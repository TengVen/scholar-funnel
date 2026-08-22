/**
 * 前端认证：token 管理 + 游客自动注册 + 当前用户状态
 *
 * - Access/Refresh 存 localStorage
 * - 首次访问无 token → 自动注册游客（/api/auth/guest）
 * - 游客可在任何页面升级为正式账号（数据零迁移归入）
 * - 当前用户状态：模块级内存 + 变更事件通知（供 React 订阅）
 */
import { request } from "./api";

const ACCESS_KEY = "sf_access_token";
const REFRESH_KEY = "sf_refresh_token";

export interface AuthUser {
  id: number;
  username: string;
  nickname: string | null;
  role: string;        // guest / user / admin
  email: string | null;
  is_guest: boolean;
}

// ── token 存取 ──
export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ── 当前用户（内存缓存 + 事件通知）──
let _currentUser: AuthUser | null = null;
type Listener = (u: AuthUser | null) => void;
const _listeners = new Set<Listener>();

export function getCurrentUser(): AuthUser | null {
  return _currentUser;
}
export function setCurrentUser(u: AuthUser | null) {
  _currentUser = u;
  _listeners.forEach((l) => l(u));
}
export function subscribeAuth(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

// ── 认证 API ──
interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

export async function apiLogin(username: string, password: string): Promise<AuthUser> {
  const res = await request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setTokens(res.access_token, res.refresh_token);
  setCurrentUser(res.user);
  return res.user;
}

export async function apiRegister(username: string, password: string, email?: string): Promise<AuthUser> {
  const res = await request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, email: email || null }),
  });
  setTokens(res.access_token, res.refresh_token);
  setCurrentUser(res.user);
  return res.user;
}

/** 游客升级正式账号（游客数据归入新账号） */
export async function apiUpgradeGuest(username: string, password: string, email?: string): Promise<AuthUser> {
  const res = await request<AuthResponse>("/api/auth/upgrade", {
    method: "POST",
    body: JSON.stringify({ username, password, email: email || null }),
  });
  setTokens(res.access_token, res.refresh_token);
  setCurrentUser(res.user);
  return res.user;
}

export async function apiLogout() {
  const refresh = getRefreshToken();
  if (refresh) {
    try {
      await request("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refresh }),
      });
    } catch {
      /* 忽略登出错误 */
    }
  }
  clearTokens();
  setCurrentUser(null);
}

export async function apiMe(): Promise<AuthUser | null> {
  try {
    const u = await request<AuthUser>("/api/auth/me");
    setCurrentUser(u);
    return u;
  } catch {
    return null;
  }
}

// ── 游客自动注册（首次访问）──
export async function ensureGuest(): Promise<AuthUser | null> {
  if (getAccessToken()) {
    // 已有 token：尝试恢复当前用户
    return apiMe();
  }
  try {
    const res = await request<AuthResponse>("/api/auth/guest", { method: "POST" });
    setTokens(res.access_token, res.refresh_token);
    setCurrentUser(res.user);
    return res.user;
  } catch {
    return null;
  }
}

// ── 刷新 token（401 时调用）──
export async function tryRefreshToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await request<AuthResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refresh }),
    });
    setTokens(res.access_token, res.refresh_token);
    return true;
  } catch {
    clearTokens();
    setCurrentUser(null);
    return false;
  }
}
