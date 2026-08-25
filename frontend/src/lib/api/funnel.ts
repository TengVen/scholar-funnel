/**
 * 漏斗（LangGraph 多智能体工作流）API
 */
import { request } from "../http";
import type {
  FunnelStartResponse,
  FunnelResumeResponse,
  FunnelStateResponse,
} from "@/types/dto";

export interface FunnelStartPayload {
  project_id: number;
  user_input: string;
  tech_probe?: string;
  mode?: "auto" | "step";
  methodology?: string;
  paper_type?: string;
  year_from?: number | null;
  year_to?: number | null;
}

export interface FunnelResumePayload {
  thread_id: string;
  user_input?: string;
  skeleton_confirmed?: number[];
  skeleton_skipped?: number[];
  selected_probe?: string;
}

/** 启动漏斗（异步，立即返回 thread_id；进度走 /state 轮询） */
export function startFunnel(body: FunnelStartPayload): Promise<FunnelStartResponse> {
  return request("/api/funnel/start", { method: "POST", body: JSON.stringify(body) });
}

/** 恢复被中断的漏斗（异步，立即返回；进度走 /state 轮询） */
export function resumeFunnel(body: FunnelResumePayload): Promise<FunnelResumeResponse> {
  return request("/api/funnel/resume", { method: "POST", body: JSON.stringify(body) });
}

/** 查询漏斗状态（轮询用） */
export function getFunnelState(threadId: string): Promise<FunnelStateResponse> {
  return request(`/api/funnel/state?thread_id=${encodeURIComponent(threadId)}`);
}
