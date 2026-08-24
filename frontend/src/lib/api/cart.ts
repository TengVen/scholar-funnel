/**
 * 骨架（Cart）API —— 状态 / 增删 / 分类 / AI / 导出
 */
import { request, requestText } from "../http";
import type { CartStatus, CartClassifyResult, DiagnosisResult } from "@/types/dto";

export function getCart(projectId: number): Promise<CartStatus> {
  return request(`/api/cart?project_id=${projectId}`);
}

export function addToCart(
  projectId: number,
  paperId: number,
  category = "mainstream",
  notes = "",
): Promise<unknown> {
  return request("/api/cart", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, paper_id: paperId, category, notes }),
  });
}

export function addToCartByOpenAlex(
  projectId: number,
  openalexId: string,
  category: string,
  notes = "",
): Promise<unknown> {
  const qs = new URLSearchParams({
    project_id: String(projectId),
    openalex_id: openalexId,
    category,
    notes,
  });
  return request(`/api/cart/add-by-openalex?${qs}`, { method: "POST" });
}

export function removeFromCart(projectId: number, paperId: number): Promise<unknown> {
  return request(`/api/cart/${paperId}?project_id=${projectId}`, { method: "DELETE" });
}

export function classifyPaper(paperId: number): Promise<CartClassifyResult> {
  return request(`/api/cart/classify?paper_id=${paperId}`, { method: "POST" });
}

export function summarizeCart(projectId: number): Promise<{ summary: string }> {
  return request(`/api/cart/summarize?project_id=${projectId}`, { method: "POST" });
}

export function changeCategory(projectId: number, paperId: number, newCategory: string): Promise<unknown> {
  return request(
    `/api/cart/${paperId}/category?project_id=${projectId}&new_category=${newCategory}`,
    { method: "PUT" },
  );
}

export function diagnoseCart(projectId: number): Promise<DiagnosisResult> {
  return request(`/api/cart/diagnose?project_id=${projectId}`);
}

/** 导出 BibTeX —— 统一走传输层（带鉴权 + 错误规范化），返回文本 */
export function exportBibtex(projectId: number): Promise<string> {
  return requestText(`/api/cart/export/bibtex?project_id=${projectId}`);
}
