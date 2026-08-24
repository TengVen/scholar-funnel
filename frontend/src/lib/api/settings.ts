/**
 * 系统设置 API —— LLM 运行时配置 / 系统公告
 */
import { request } from "../http";
import type { Announcement } from "@/types/dto";

// ── LLM 运行时配置 ──

export function setLLMConfig(config: {
  api_key?: string;
  base_url?: string;
  model?: string;
}): Promise<{ ok: boolean; message: string }> {
  return request("/api/settings/llm", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export function getLLMConfig(): Promise<{ ok: boolean; model: string }> {
  return request("/api/settings/llm");
}

// ── 系统公告（对话页铃铛）──

export function getAnnouncements(): Promise<Announcement[]> {
  return request("/api/announcements");
}
