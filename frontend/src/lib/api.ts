/**
 * Scholar Funnel API Client
 */

const BASE = "";

export async function request<T>(path: string, options?: RequestInit, _retry = true): Promise<T> {
  // 注入 Authorization（动态 import 避免循环依赖）
  const { getAccessToken } = await import("./auth");
  const token = getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });
  if (res.status === 401 && _retry) {
    // access 过期 → 用 refresh 换新，重试一次
    const { tryRefreshToken } = await import("./auth");
    if (await tryRefreshToken()) {
      return request<T>(path, options, false);
    }
    // 刷新失败（refresh 也过期/被吊销）→ 触发重新登录
    window.dispatchEvent(new CustomEvent("auth:expired"));
    throw new Error("登录已过期，请重新登录");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `请求失败 (${res.status})`);
  }
  return res.json();
}

// ── Project ──

export interface Project {
  id: number;
  name: string;
  user_query: string;
  tech_probe: string | null;
  created_at: string;
}

export async function listProjects(): Promise<Project[]> {
  return request("/api/projects");
}

export async function createProject(name: string, user_query: string, tech_probe = ""): Promise<Project> {
  return request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, user_query, tech_probe }),
  });
}

// ── Search ──

export interface SearchRequest {
  project_id: number;
  user_query: string;
  tech_probe?: string;
  per_query?: number;
  year_from?: number | null;
  year_to?: number | null;
  score_threshold?: number;
  top_k?: number;
}

export interface SearchResult {
  expanded_queries: string[];
  reasoning: string;
  total_found: number;
  after_rerank: number;
  new_saved: number;
  survey_count: number;
  trace: Record<string, unknown>;
}

export async function runTrunkSearch(body: SearchRequest): Promise<SearchResult> {
  return request("/api/search/trunk", { method: "POST", body: JSON.stringify(body) });
}

// ── Gap Search（缺口补充检索）──

export interface GapSearchRequest {
  project_id: number;
  user_query: string;
  target_category: string;   // foundation / mainstream / frontier
  tech_probe?: string;
  user_constraint?: string;  // 可选：用户补充约束
  per_query?: number;
  top_k?: number;
  score_threshold?: number;
  max_queries?: number;
}

export interface GapCandidate {
  paper_id: number | null;
  openalex_id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  abstract: string;
  cited_by_count: number;
  is_survey: boolean;
  keywords: string[];
  github_url: string | null;
  relevance_score: number;
  recommended_category: string;
  confidence: string;    // high / medium / low
  reason: string;
  already_in_cart: boolean;
  already_in_db: boolean;
  similarity: number | null;   // 语义相似度（语义补充模式）
}

export interface GapSearchResult {
  target_category: string;
  candidates: GapCandidate[];
  expanded_queries: string[];
  reasoning: string;
  total_found: number;
  returned: number;
  status: string;        // ok / low_results / empty
}

export async function runGapSearch(body: GapSearchRequest): Promise<GapSearchResult> {
  return request("/api/search/gap", { method: "POST", body: JSON.stringify(body) });
}

export async function runGapSemantic(
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

export interface TitleLookupRequest {
  project_id: number;
  title: string;
  target_category: string;
}

export async function lookupTitleByTitle(body: TitleLookupRequest): Promise<GapSearchResult> {
  return request("/api/search/title", { method: "POST", body: JSON.stringify(body) });
}

// ── Paper ──

export interface Paper {
  id: number;
  title: string;
  authors: string[] | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  abstract: string | null;
  cited_by_count: number;
  is_survey: boolean;
  trunk_score: number | null;
  keywords: string[];
  github_url: string | null;
  in_cart: boolean;
}

export interface PaperListResponse {
  papers: Paper[];
  total: number;
  page: number;
  page_size: number;
}

export interface PaperListParams {
  project_id: number;
  stage?: string;
  sort_by?: string;
  sort_order?: string;
  filter_survey?: string;
  min_citations?: number;
  page?: number;
  page_size?: number;
}

export async function listPapers(params: PaperListParams): Promise<PaperListResponse> {
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

// ── Cart ──

export interface CartItem {
  cart_id: number;
  paper_id: number;
  openalex_id: string;
  category: string;
  title: string;
  authors: string[] | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  abstract: string | null;
  cited_by_count: number;
  is_survey: boolean;
  keywords: string[];
  github_url: string | null;
  notes: string;
  added_at: string;
}

export interface CartStatus {
  items: CartItem[];
  counts: Record<string, number>;
  total: number;
  full: boolean;
}

export async function getCart(projectId: number): Promise<CartStatus> {
  return request(`/api/cart?project_id=${projectId}`);
}

export async function addToCart(
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

export async function addToCartByOpenAlex(
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

export async function removeFromCart(projectId: number, paperId: number): Promise<unknown> {
  return request(`/api/cart/${paperId}?project_id=${projectId}`, { method: "DELETE" });
}

export interface CartClassifyResult {
  category: string;
  reason: string;
}

export async function classifyPaper(paperId: number): Promise<CartClassifyResult> {
  return request(`/api/cart/classify?paper_id=${paperId}`, { method: "POST" });
}

export async function summarizeCart(projectId: number): Promise<{ summary: string }> {
  return request(`/api/cart/summarize?project_id=${projectId}`, { method: "POST" });
}

export async function changeCategory(projectId: number, paperId: number, newCategory: string): Promise<unknown> {
  return request(
    `/api/cart/${paperId}/category?project_id=${projectId}&new_category=${newCategory}`,
    { method: "PUT" },
  );
}

export async function diagnoseCart(projectId: number): Promise<{
  verdict: string; summary?: string; counts: Record<string, number>;
  total: number; issues: string[]; suggestions: string[];
}> {
  return request(`/api/cart/diagnose?project_id=${projectId}`);
}

export async function exportBibtex(projectId: number): Promise<string> {
  const res = await fetch(`/api/cart/export/bibtex?project_id=${projectId}`);
  if (!res.ok) throw new Error("导出失败");
  return res.text();
}

// ── Task polling ──

export interface TaskStatus {
  status: string;
  current?: number;
  total?: number;
  detail?: string;
  step?: string;
  error?: string | null;
}

// ── Branch ──

export interface BranchAnalyzeRequest {
  project_id: number;
  mode: string;
  probe?: string;
  category?: string;   // 分类范围: foundation/mainstream/frontier，空=全部
}

export interface BranchPaperResult {
  paper_id: number;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  abstract: string;
  cited_by_count: number;
  category: string;   // foundation / mainstream / frontier
  content_level: number;
  content_source: string;
  method_summary: string;
  probe_match: boolean;
  probe_confidence: string;
  key_findings: string;
  optimization_method: string;
  error: string;
}

export interface BranchAnalyzeResponse {
  results: BranchPaperResult[];
  total: number;
  mode: string;
  level_distribution: Record<string, number>;
}

export async function startBranchAnalyze(body: BranchAnalyzeRequest): Promise<{ task_id: string }> {
  return request("/api/branch/analyze", { method: "POST", body: JSON.stringify(body) });
}

export async function getBranchStatus(taskId: string): Promise<TaskStatus> {
  return request(`/api/branch/status?task_id=${taskId}`);
}

export async function getBranchResult(taskId: string): Promise<BranchAnalyzeResponse> {
  return request(`/api/branch/result?task_id=${taskId}`);
}

export async function getBranchResults(
  projectId: number,
  mode = "",
): Promise<BranchAnalyzeResponse> {
  return request(`/api/branch/results?project_id=${projectId}&mode=${mode}`);
}

// ── Network ──

export interface RecommendedPaper {
  openalex_id: string;
  title: string;
  authors: string[];
  year: number;
  venue: string;
  doi: string;
  cited_by_count: number;
  abstract: string;
  source: string;
  cited_by_n: number;
  citing_n: number;
  reason: string;
}

export interface GraphNode {
  id: string;
  label: string;
  group: string;
  category: string;
  year: number;
  size: number;
}

export interface GraphEdge {
  source_id: string;
  target_id: string;
  label: string;
}

export interface NetworkResultResponse {
  backward: RecommendedPaper[];
  forward: RecommendedPaper[];
  graph_nodes: GraphNode[];
  graph_edges: GraphEdge[];
  stats: Record<string, number>;
}

export async function startNetworkAnalyze(
  projectId: number,
  category = "",
): Promise<{ task_id: string }> {
  return request("/api/network/analyze", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, category }),
  });
}

export async function getNetworkStatus(taskId: string): Promise<TaskStatus> {
  return request(`/api/network/status?task_id=${taskId}`);
}

export async function getNetworkResult(taskId: string): Promise<NetworkResultResponse> {
  return request(`/api/network/result?task_id=${taskId}`);
}

// ── Chat ──

export interface ChatMessage {
  role: string;
  content: string;
  project_id?: number;   // 检索完成消息关联的项目（"查看项目"按钮）
  project_name?: string;
}

export interface ChatResponse {
  conversation_id: string;
  reply: string;
  stage: string;
  params: Record<string, unknown>;
  search_result?: Record<string, unknown> | null;
  task_id?: string | null;   // full_search 异步任务（前端轮询）
}

export interface SearchSummary {
  summary: string;
  project_id: number;
  project_name: string;
}

export async function sendChatMessage(
  conversationId: string,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<ChatResponse> {
  return request("/api/chat/message", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, message, ...extra }),
  });
}

// ── Settings (LLM 配置) ──

export interface LLMConfig {
  api_key?: string;
  base_url?: string;
  model?: string;
}

export async function setLLMConfig(config: LLMConfig): Promise<{ ok: boolean; message: string }> {
  return request("/api/settings/llm", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function getLLMConfig(): Promise<{ ok: boolean; model: string }> {
  return request("/api/settings/llm");
}

export async function getChatSearchStatus(taskId: string): Promise<TaskStatus> {
  return request(`/api/chat/search/status?task_id=${taskId}`);
}

export async function finalizeSearchSummary(
  taskId: string,
): Promise<SearchSummary> {
  return request(`/api/chat/search/${taskId}/summary`, { method: "POST" });
}
