/**
 * 分支深挖 API
 */
import { request } from "../http";
import type { BranchAnalyzeRequest, BranchAnalyzeResponse, TaskStatus } from "@/types/dto";

export function startBranchAnalyze(body: BranchAnalyzeRequest): Promise<{ task_id: string }> {
  return request("/api/branch/analyze", { method: "POST", body: JSON.stringify(body) });
}

export function getBranchStatus(taskId: string): Promise<TaskStatus> {
  return request(`/api/branch/status?task_id=${taskId}`);
}

export function getBranchResult(taskId: string): Promise<BranchAnalyzeResponse> {
  return request(`/api/branch/result?task_id=${taskId}`);
}

export function getBranchResults(
  projectId: number,
  mode = "",
  signal?: AbortSignal,
): Promise<BranchAnalyzeResponse> {
  return request(
    `/api/branch/results?project_id=${projectId}&mode=${mode}`,
    signal ? { signal } : undefined,
  );
}
