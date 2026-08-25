/**
 * 检索 API —— 主检索 / 缺口补充 / 标题直达 / 论文列表
 */
import { request } from "../http";
import type {
  SearchRequest,
  SearchResult,
  GapSearchRequest,
  GapSearchResult,
  TitleLookupRequest,
  PaperListParams,
  PaperListResponse,
} from "@/types/dto";

// ── 主检索（异步 task + 轮询） ──

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动主干检索并等待完成。
 * 后端 /trunk 已异步化（30-120s），此处内部完成 start → poll → result，
 * 对调用方保持"一次调用返回完整结果"的语义。
 */
export async function runTrunkSearch(body: SearchRequest): Promise<SearchResult> {
  const { task_id } = await request<{ task_id: string; status: string }>(
    "/api/search/trunk",
    { method: "POST", body: JSON.stringify(body) },
  );
  for (;;) {
    await sleep(2500);
    const st = await request<{ status: string; error?: string | null }>(
      `/api/search/trunk/status?task_id=${task_id}`,
    );
    if (st.status === "done") break;
    if (st.status === "error") throw new Error(st.error || "检索失败");
  }
  return request<SearchResult>(`/api/search/trunk/result?task_id=${task_id}`);
}

// ── 缺口补充 ──

export function runGapSearch(body: GapSearchRequest): Promise<GapSearchResult> {
  return request("/api/search/gap", { method: "POST", body: JSON.stringify(body) });
}

export function runGapSemantic(
  projectId: number,
  targetCategory: string,
  topK = 20,
  threshold = 0.35,
): Promise<GapSearchResult> {
  return request("/api/search/gap-semantic", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      target_category: targetCategory,
      top_k: topK,
      similarity_threshold: threshold,
    }),
  });
}

// ── 标题直达 ──

export function lookupTitleByTitle(body: TitleLookupRequest): Promise<GapSearchResult> {
  return request("/api/search/title", { method: "POST", body: JSON.stringify(body) });
}

// ── 论文列表（检索结果展示）──

export function listPapers(params: PaperListParams): Promise<PaperListResponse> {
  const qs = new URLSearchParams();
  qs.set("project_id", String(params.project_id));
  if (params.stage) qs.set("stage", params.stage);
  if (params.sort_by) qs.set("sort_by", params.sort_by);
  if (params.sort_order) qs.set("sort_order", params.sort_order);
  if (params.filter_survey) qs.set("filter_survey", params.filter_survey);
  if (params.min_citations) qs.set("min_citations", String(params.min_citations));
  if (params.page !== undefined) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  return request(`/api/papers?${qs.toString()}`);
}
