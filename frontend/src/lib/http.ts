/**
 * HTTP 传输层 —— 全站唯一出口
 *
 * 职责：
 * - Token 注入（Authorization）
 * - 401 自动刷新（refresh → 单次重试；失败 → 清 token + 派发 auth:expired）
 * - 响应解析（JSON / 文本）
 * - 错误规范化（统一抛 ApiError）
 *
 * 禁止业务组件直接 fetch / axios；所有业务 API 必须经过本层。
 */
import { ApiError } from "@/types/api";
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "./tokenStore";

const BASE = "";

/** 用 refresh token 换新 access token（内部流程，不走 request 避免递归） */
async function refreshToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { access_token: string; refresh_token: string };
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

function buildUrl(path: string): string {
  return `${BASE}${path}`;
}

function buildHeaders(options?: RequestInit): Record<string, string> {
  const token = getAccessToken();
  // FormData（文件上传）：不能手动设 Content-Type，浏览器会自动带 multipart boundary
  const isForm = typeof FormData !== "undefined" && options?.body instanceof FormData;
  return {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers as Record<string, string> | undefined),
  };
}

async function toApiError(res: Response): Promise<ApiError> {
  let detail: unknown;
  let message = `请求失败 (${res.status})`;
  const ct = res.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const body = (await res.json()) as { detail?: unknown };
      detail = body.detail;
      if (typeof body.detail === "string") message = body.detail;
    } else {
      message = (await res.text()) || message; // 非 JSON（如 PDF 端点的 text/plain 错误页）
    }
  } catch {
    /* 响应体不可读则用默认消息 */
  }
  return new ApiError(message, res.status, detail);
}

/** 401 处理：刷新一次 → 重试；刷新失败 → 清 token + auth:expired */
async function handleUnauthorized(): Promise<never> {
  clearTokens();
  window.dispatchEvent(new CustomEvent("auth:expired"));
  throw new ApiError("登录已过期，请重新登录", 401);
}

/** JSON 请求（默认路径） */
export async function request<T>(path: string, options?: RequestInit, _retry = true): Promise<T> {
  const res = await fetch(buildUrl(path), { ...options, headers: buildHeaders(options) });
  if (res.status === 401) {
    if (_retry && (await refreshToken())) {
      return request<T>(path, options, false); // 刷新成功 → 用新 token 重试一次
    }
    await handleUnauthorized();
  }
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as T;
}

/** 文本响应请求（如导出 BibTeX）——同样统一走传输层（带鉴权、错误规范化） */
export async function requestText(path: string, options?: RequestInit, _retry = true): Promise<string> {
  const res = await fetch(buildUrl(path), { ...options, headers: buildHeaders(options) });
  if (res.status === 401) {
    if (_retry && (await refreshToken())) {
      return requestText(path, options, false);
    }
    await handleUnauthorized();
  }
  if (!res.ok) {
    throw await toApiError(res);
  }
  return res.text();
}

/** 二进制响应请求（如 PDF blob）——带鉴权、401 刷新重试、错误规范化 */
export async function requestBlob(path: string, options?: RequestInit, _retry = true): Promise<Blob> {
  const res = await fetch(buildUrl(path), { ...options, headers: buildHeaders(options) });
  if (res.status === 401) {
    if (_retry && (await refreshToken())) {
      return requestBlob(path, options, false);
    }
    await handleUnauthorized();
  }
  if (!res.ok) {
    throw await toApiError(res);
  }
  return res.blob();
}

/** 登出时需要（api/auth 使用） */
export { getRefreshToken, clearTokens };
