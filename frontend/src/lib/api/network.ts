/**
 * 网络图谱 API
 */
import { request } from "../http";
import type { NetworkResultResponse, TaskStatus } from "@/types/dto";

export function startNetworkAnalyze(projectId: number, category = ""): Promise<{ task_id: string }> {
  return request("/api/network/analyze", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, category }),
  });
}

export function getNetworkStatus(taskId: string): Promise<TaskStatus> {
  return request(`/api/network/status?task_id=${taskId}`);
}

export function getNetworkResult(taskId: string): Promise<NetworkResultResponse> {
  return request(`/api/network/result?task_id=${taskId}`);
}
