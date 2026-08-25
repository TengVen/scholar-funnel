/**
 * 项目 API
 */
import { request } from "../http";
import type { Project, ProjectLimits } from "@/types/dto";

export function listProjects(): Promise<Project[]> {
  return request("/api/projects");
}

export function createProject(name: string, user_query: string, tech_probe = ""): Promise<Project> {
  return request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, user_query, tech_probe }),
  });
}

export function getProjectLimits(projectId: number): Promise<{ limits: ProjectLimits }> {
  return request(`/api/projects/${projectId}/limits`);
}

export function updateProjectLimits(
  projectId: number,
  limits: ProjectLimits,
): Promise<{ limits: ProjectLimits }> {
  return request(`/api/projects/${projectId}/limits`, {
    method: "PUT",
    body: JSON.stringify(limits),
  });
}
