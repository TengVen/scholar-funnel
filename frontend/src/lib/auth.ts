/**
 * 认证 API —— 只负责"调用哪个接口、DTO 如何传递"
 *
 * 不持有 React 状态、不管理 token 存取（token 由 authStore 编排写入）。
 */
import { request } from "./http";
import type { AuthResponse, AuthUser } from "@/types/dto";

export function apiLogin(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function apiRegister(username: string, password: string, email?: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, email: email || null }),
  });
}

/** 游客升级正式账号（游客数据归入新账号） */
export function apiUpgradeGuest(username: string, password: string, email?: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/upgrade", {
    method: "POST",
    body: JSON.stringify({ username, password, email: email || null }),
  });
}

export function apiLogout(refreshToken: string): Promise<void> {
  return request("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export function apiMe(): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me");
}

/** 游客自动注册（首次访问） */
export function apiGuest(): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/guest", { method: "POST" });
}
