/**
 * Scholar Funnel API Client
 */

const BASE = "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
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

export async function addToCart(projectId: number, paperId: number, category = "mainstream"): Promise<unknown> {
  return request("/api/cart", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, paper_id: paperId, category }),
  });
}

export async function removeFromCart(projectId: number, paperId: number): Promise<unknown> {
  return request(`/api/cart/${paperId}?project_id=${projectId}`, { method: "DELETE" });
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

export async function getBranchResults(projectId: number): Promise<BranchAnalyzeResponse> {
  return request(`/api/branch/results?project_id=${projectId}`);
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

export async function startNetworkAnalyze(projectId: number): Promise<{ task_id: string }> {
  return request("/api/network/analyze", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId }),
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
}

export interface ChatResponse {
  conversation_id: string;
  reply: string;
  stage: string;
  params: Record<string, unknown>;
  search_result?: Record<string, unknown> | null;
}

export async function sendChatMessage(conversationId: string, message: string): Promise<ChatResponse> {
  return request("/api/chat/message", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, message }),
  });
}

export async function startChatSearch(
  conversationId: string, params: Record<string, unknown>,
): Promise<{ task_id: string }> {
  return request("/api/chat/search/start", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, params }),
  });
}

export async function getChatSearchStatus(taskId: string): Promise<TaskStatus> {
  return request(`/api/chat/search/status?task_id=${taskId}`);
}

export async function getChatSearchResult(
  taskId: string,
): Promise<{ ok: boolean; project_id: number; result: SearchResult }> {
  return request(`/api/chat/search/result?task_id=${taskId}`);
}
