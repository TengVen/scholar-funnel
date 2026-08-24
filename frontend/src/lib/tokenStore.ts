/**
 * Token 存取 —— 基础设施叶子模块
 *
 * 只负责 localStorage 读写，不依赖任何业务模块；
 * http.ts（401 刷新）与 authStore（登录/登出）都引它，从而解开 api↔auth 循环依赖。
 */
import { STORAGE_KEYS } from "@/config/storage";

export function getAccessToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.accessToken);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.refreshToken);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(STORAGE_KEYS.accessToken, access);
  localStorage.setItem(STORAGE_KEYS.refreshToken, refresh);
}

export function clearTokens() {
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
}
