/**
 * 论文域 API（lib/api 分层：唯一传输层 http）
 */
import { request } from "@/lib/http";

/** L1"加入研究"：把回答来源论文纳入项目候选（stage=candidate，不进骨架） */
export function joinProject(projectId: number, openalexId: string): Promise<{ ok: boolean; paper_id: number; created?: boolean }> {
  return request("/api/papers/join-project", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, openalex_id: openalexId }),
  });
}
