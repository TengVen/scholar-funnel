/**
 * 论文域 API（lib/api 分层：唯一传输层 http）
 */
import { request, requestBlob } from "@/lib/http";
import type { PaperDetail, PaperAskResult, PaperMapState } from "@/types/dto";

/** L1"加入研究"：把回答来源论文纳入项目候选（stage=candidate，不进骨架） */
export function joinProject(projectId: number, openalexId: string): Promise<{ ok: boolean; paper_id: number; created?: boolean }> {
  return request("/api/papers/join-project", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, openalex_id: openalexId }),
  });
}

/** 上传 PDF 补全全文（非 arXiv 论文）：落盘 + 自动触发全文级重算 */
export function uploadPaperPdf(paperId: number, projectId: number, file: File): Promise<{ paper_id: number; status: string; task_id?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("paper_id", String(paperId));
  fd.append("project_id", String(projectId));
  return request("/api/papers/upload", { method: "POST", body: fd });
}

/** 项目论文详情聚合（三态读取入口） */
export function getPaperDetail(paperId: number, projectId: number): Promise<PaperDetail> {
  return request(`/api/papers/${paperId}?project_id=${projectId}`);
}

/** transient 浏览态：OpenAlex 实时拉取，不落库；传 projectId 时回查库内已收录行（paper_id/分析状态） */
export function getTransientPaper(openalexId: string, projectId?: number | null): Promise<PaperDetail> {
  const p = projectId ? `&project_id=${projectId}` : "";
  return request(`/api/papers/transient?openalex_id=${encodeURIComponent(openalexId)}${p}`);
}

/** 深入探究（paper_id 模式）：落库 candidate（转 L2）+ 触发单篇分析预热；persist=true 分析完成直接落库（L3） */
export function explorePaper(paperId: number, projectId: number, persist = false): Promise<{ status: string; task_id?: string }> {
  return request(`/api/papers/${paperId}/explore?project_id=${projectId}&persist=${persist}`);
}

/** 深入探究（transient 无 paper_id 模式）：按 openalex_id 落库 candidate（幂等，转 L2）+ 触发单篇分析 */
export function exploreOpenalexPaper(
  projectId: number,
  openalexId: string,
  persist = false,
): Promise<{ paper_id: number; status: string; task_id?: string }> {
  return request("/api/papers/explore", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, openalex_id: openalexId, persist }),
  });
}

/** 分析状态/结果轮询（统一返回 {status, content?, ...}） */
export function getPaperAnalysis(paperId: number, projectId: number): Promise<PaperDetail["analysis"]> {
  return request(`/api/papers/${paperId}/analysis/result?project_id=${projectId}`);
}

/** 论文 → 领域地图（T10：详情页左栏地图导航；transient/无 run 时 status=none） */
export function getPaperMap(paperId: number, projectId: number): Promise<PaperMapState> {
  return request(`/api/papers/${paperId}/map?project_id=${projectId}`);
}

/** 详情页连续问答（触发分析落库 L2→L3 + 引用回溯；history 最近 ≤10 轮承接追问） */
export function askPaper(
  paperId: number,
  projectId: number,
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<PaperAskResult> {
  return request(`/api/papers/${paperId}/ask`, {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, question, history: history.slice(-10) }),
  });
}

/** 原文 PDF 二进制（仅 arXiv）：带 token 拉取 → 前端转 blob URL 供 iframe 预览 */
export function fetchPdfBlob(openalexId: string): Promise<Blob> {
  return requestBlob(`/api/papers/pdf?openalex_id=${encodeURIComponent(openalexId)}`);
}
