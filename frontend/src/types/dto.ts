/**
 * 与后端 DTO 一一对应的类型 —— 纯类型，禁止业务实现
 *
 * 依赖方向：dto.ts 依赖 domain.ts（共享联合类型），不依赖任何实现模块。
 */
import type {
  Category,
  Confidence,
  UsageRole,
  AnnouncementLevel,
  UserRole,
  TaskStatusState,
  GapSearchStatus,
} from "./domain";

// ── Auth ──

export interface AuthUser {
  id: number;
  username: string;
  nickname: string | null;
  role: UserRole;
  email: string | null;
  is_guest: boolean;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

// ── Project ──

export interface Project {
  id: number;
  name: string;
  user_query: string;
  tech_probe: string | null;
  created_at: string;
}

/** 项目级骨架限额（每类 1-30，总和 ≤ 50；缺省 5/10/5） */
export type ProjectLimits = Record<Category, number>;

// ── Search（主检索）──

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

/** 检索 trace：timing 是标准字段，其余透传（后端可能追加） */
export interface SearchTrace {
  timing?: Record<string, number>;
  [key: string]: unknown;
}

export interface SearchResult {
  expanded_queries: string[];
  reasoning: string;
  total_found: number;
  after_rerank: number;
  new_saved: number;
  survey_count: number;
  trace: SearchTrace;
}

// ── Gap Search（缺口补充）──

export interface GapSearchRequest {
  project_id: number;
  user_query: string;
  target_category: Category;
  tech_probe?: string;
  user_constraint?: string;
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
  recommended_category: Category;
  confidence: Confidence;
  reason: string;
  already_in_cart: boolean;
  already_in_db: boolean;
  similarity: number | null;
}

export interface GapSearchResult {
  target_category: Category | "";
  candidates: GapCandidate[];
  expanded_queries: string[];
  reasoning: string;
  total_found: number;
  returned: number;
  status: GapSearchStatus;
}

export interface TitleLookupRequest {
  project_id: number;
  title: string;
  target_category: Category;
}

// ── Local Search（本地库二次检索）──

export interface LocalSearchRequest {
  project_id: number;
  query: string;
  limit?: number;
}

export interface LocalSearchResponse {
  papers: Paper[];
  total: number;
  query: string;
  mode: string;
}

// ── Paper ──

/** 召回溯源（"为什么是它"）—— 面向用户只展示 reason；分数/匹配/置信度为内部信号前端不展示 */
export interface PaperWhy {
  routes: string[];             // core / synonym / aux / loose / semantic（内部）
  matched_terms: string[];      // 命中的检索词（内部）
  source: "openalex" | "semantic";
  similarity?: number | null;   // 语义召回相似度（内部）
  rerank_score?: number | null; // 内部
  confidence?: "high" | "medium" | "low" | null; // 内部
  reason?: string | null;       // 自然语言推荐理由（唯一面向用户的展示字段）
}

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
  why?: PaperWhy | null;
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
  /** 剔除的论文 id（如当前 run 的推荐论文），服务端 SQL 层过滤保证分页正确 */
  exclude_paper_ids?: number[];
  /** 仅保留的论文 id（如取推荐论文完整数据，复用同一 PaperCard 样式） */
  include_paper_ids?: number[];
}

/** 推荐论文附加信息（分类徽章 + 一句话理由 + 召回依据；与主列表卡片同款呈现） */
export interface PaperRecommendation {
  category: Category;
  one_liner: string;
  recall_basis?: string;
}

// ── Cart（骨架）──

export interface CartItem {
  cart_id: number;
  paper_id: number;
  openalex_id: string;
  category: Category;
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
  counts: Record<Category, number>;
  total: number;
  full: boolean;
}

export interface CartClassifyResult {
  category: Category;
  reason: string;
}

/** AI 诊断结果 */
export interface DiagnosisResult {
  verdict: string;
  summary?: string;
  counts: Record<Category, number>;
  total: number;
  issues: string[];
  suggestions: string[];
}

// ── 论文详情页（三栏 + 三态）──

export interface PaperRef {
  openalex_id?: string;
  title?: string;
  year?: number | null;
}

/** AI 研究助手六区块（L2/L3 同一套分析能力） */
export interface PaperAnalysisContent {
  summary?: string;                    // 摘要学术化总结（L1 态右栏内容）
  quick_understand?: string;           // 一句话理解
  core_contributions?: string[];       // 核心贡献 ①…②…③…
  method_framework?: { pipeline?: string[]; text?: string; evidence?: EvidenceItem[] };  // 方法框架（证据=per-block 锚定原文）
  experiments?: {
    datasets?: string[];
    baseline?: string;
    ours?: string;
    gains?: string;
    notes?: string;
    evidence?: EvidenceItem[];         // 实验结论的证据锚点
  };
  relation_to_research?: {
    topic?: string;
    related_directions?: string[];
    potential_contribution?: string;
  };
  research_context?: {                 // 研究脉络（三类：基础/横向/纵向）
    base?: PaperRef[];
    horizontal?: PaperRef[];
    vertical?: PaperRef[];
  };
  evidence?: EvidenceItem[];           // 原文依据（E1 锚点，LLM 输出，可点击跳转章节/PDF 页）
}

export interface PaperSection {
  heading: string;
  content: string;
  page_start?: number;                 // PDF 页码锚点（归一化后透传，正文跳转/PDF 翻页用）
}

/** 详情页聚合（transient / candidate / research asset 三态统一读取） */
export interface PaperDetail {
  mode: "project" | "transient";
  paper_id?: number | null;
  openalex_id: string;
  title: string;
  authors: string[];
  year?: number | null;
  venue?: string;
  doi?: string | null;
  arxiv_id?: string | null;
  abstract?: string | null;
  abstract_source?: string;          // "" 原文 / ai_tldr（Semantic Scholar AI 概要，非原文）
  cited_by_count: number;
  github_url?: string | null;
  keywords: string[];
  is_oa?: boolean;
  oa_pdf_url?: string | null;
  oa_landing_url?: string | null;
  pdf_available?: boolean; // 站内 PDF 预览可用（仅 arXiv）
  in_project: boolean;
  stage?: string | null;
  in_cart: boolean;
  category?: string | null;
  why?: PaperWhy | null;
  judgment?: { action?: string; reason?: string } | null;
  sections?: PaperSection[] | null;
  analysis: {
    status: "none" | "running" | "done";
    source?: "cache" | "db";
    content?: PaperAnalysisContent | null;
    sections?: PaperSection[] | null;
    material_type?: string;
  };
  actions: { can_explore: boolean; can_ask: boolean };
  /** 该论文历史问答（时间升序 ≤20；{question, answer, citations}，打开详情页回填左栏对话流） */
  qa_history?: Array<{ question: string; answer: string; citations: Array<{ section?: string; snippet?: string }> }>;
}

export interface PaperAskResult {
  answer: string;
  citations: Array<{ section?: string; snippet?: string }>;
}

// ── 任务轮询通用 ──

export interface TaskStatus {
  status: TaskStatusState;
  current?: number;
  total?: number;
  detail?: string;
  step?: string;
  error?: string | null;
}

// ── Branch（分支深挖）──

export interface BranchAnalyzeRequest {
  project_id: number;
  mode: string;
  probe?: string;
  category?: Category | "";
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
  category: Category;
  content_level: number;
  content_source: string;
  method_summary: string;
  probe_match: boolean;
  probe_confidence: Confidence;
  key_findings: string;
  optimization_method: string;
  /** 跨领域增强字段（可选，旧数据/旧后端缺省） */
  usage_role?: UsageRole | "";
  implementation_or_application?: string;
  probe_relation?: string;
  research_question?: string;
  methodology_type?: string;
  method_category?: string;
  method_components?: string[];
  research_design?: string;
  key_innovation?: string;
  limitations?: string;
  evidence?: EvidenceItem[];
  error: string;
}

/** 方法识别证据（分支深挖） */
export interface EvidenceItem {
  section: string;
  description: string;
}

export interface BranchAnalyzeResponse {
  results: BranchPaperResult[];
  total: number;
  mode: string;
  level_distribution: Record<string, number>;
}

// ── Network（网络图谱）──

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

/** 网络分析统计（骨架/推荐数量；error 存在表示该范围分析失败） */
export interface NetworkStats {
  skeleton_count?: number;
  backward_count?: number;
  forward_count?: number;
  graph_nodes?: number;
  error?: string;
}

export interface NetworkResultResponse {
  backward: RecommendedPaper[];
  forward: RecommendedPaper[];
  graph_nodes: GraphNode[];
  graph_edges: GraphEdge[];
  stats: NetworkStats;
}

// ── Chat（对话）──

export interface DeepResearchCandidate {
  paper_id: number;
  title: string;
  year: number;
  suggested_category: Category;
  reason: string;
  authors_note?: string;       // 第一作者 等
  cited_by_count?: number;
}

export interface DeepResearchProbe {
  probe: string;
  description: string;
  coverage_ratio: number;
}

/** L3 深度调研结果卡附件（研究成果指标；检索过程收纳在 process，"查看检索过程"展开） */
export interface DeepResearchAttachments {
  type: "deep_research" | "deep_research_result";
  level?: "L3";
  thread_id: string;
  project_id: number;
  status?: "running" | "ended";
  metrics?: {
    core_papers: number;         // 核心论文
    new_papers: number;          // 新增文献（主干新入库）
    skeleton_candidates: number; // 骨架候选
    research_probes: number;     // 研究探针
  };
  process?: {
    total_found: number;         // 主干召回
    new_saved: number;
    survey_count: number;
  };
  candidates?: DeepResearchCandidate[];
  probes?: DeepResearchProbe[];
}

/** L1 来源条目（answer_with_sources hits；openalex_id 供"加入研究"） */
export interface L1Source {
  openalex_id?: string | null;
  title: string;
  year?: number | null;
  venue?: string;
  doi?: string | null;
  reason?: string;
  source?: "project" | "openalex";
}

/** L1 来源卡附件：论文 = 当前回答的外部来源 */
export interface L1SourcesAttachment {
  type: "l1_sources";
  level: "L1";
  sources: L1Source[];
}

/** L2 认知结构论文条目（推荐理由三件套：分类 + 一句话理由 + 召回依据） */
export interface StructurePaper {
  paper_id: number;
  title: string;
  year?: number | null;
  cited_by_count: number;
  suggested_category: Category;
  reason: string;                  // 元数据模板（无摘要 / LLM 失败兜底，旧数据回退用）
  one_liner?: string;              // 一句话推荐理由（有摘要 LLM 生成；缺省回退 reason）
  recall_basis?: string;           // 召回依据（命中词/召回路，内部信号不展示）
}

/** L2 认知结构（核心推荐 vs 全部候选计数分离） */
export interface CognitiveStructure {
  topic: string;
  total_candidates: number;   // 共发现（候选结果池）
  selected_count: number;     // 核心推荐
  foundation: StructurePaper[];
  mainstream: StructurePaper[];
  frontier: StructurePaper[];
}

/** L2 认知结构卡附件：论文 = 认知结构节点 */
export interface L2StructureAttachment {
  type: "l2_structure";
  level: "L2";
  cognitive_structure: CognitiveStructure;
}

/** 领域地图消息卡附件（T10，甲：对话内地图卡；run_id/project_id 供卡内自拉快照） */
export interface RunMapAttachment {
  type: "run_map";
  run_id: number;
  project_id: number;
}

export type MessageAttachments =
  | DeepResearchAttachments
  | L1SourcesAttachment
  | L2StructureAttachment
  | RunMapAttachment;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  project_id?: number;
  project_name?: string;
  attachments?: MessageAttachments | null;
}

export interface ChatResponse {
  conversation_id: string;
  reply: string;
  stage: string;
  params: Record<string, unknown>;
  search_result?: Record<string, unknown> | null;
  task_id?: string | null;
  task_type?: "full_search" | "deep_research" | null;
  l1_sources?: L1Source[] | null;
}

export interface SearchSummary {
  summary: string;
  project_id: number;
  project_name: string;
  run_id?: number | null;          // 本次检索的 run（领域地图消息卡关联）
  cognitive_structure?: CognitiveStructure | null;
}

export interface ConversationSummary {
  conversation_id: string;
  title: string;
  stage: string;
  project_id: number | null;
  project_ids: number[];
  message_count: number;
  created_at: string;
  last_message_at: string;
}

export interface ConversationHistory {
  conversation_id: string;
  messages: ChatMessage[];
  stage: string;
  params: Record<string, unknown>;
  project_id: number | null;
  project_ids: number[];
  title: string;
}

// ── 工作台概览（2-page IA：对话 → 子研究 → 四区块）──

export interface SearchRunRecord {
  id: number;
  run_type: string;
  query?: string | null;
  user_constraint?: string | null;
  target_category?: string | null;
  total_found: number;
  saved_count: number;
  covered_ratio?: number | null;
  // ── P1/P3：模式/状态/决策留痕（工作台可见）──
  mode?: string | null;          // full / incremental / local_filter / hybrid
  status?: string | null;        // done / partial / failed / rate_limited
  error?: string | null;
  plan_reason?: string | null;   // Planner 决策说明
  year_from?: number | null;
  year_to?: number | null;
  methodology?: string | null;
  paper_type?: string | null;
  keywords?: string[];          // 该 Run 归属论文的高频关键词 top5（工作台任务信息行）
  papers?: PaperBrief[];         // 该 Run 归属论文（Search Run 独立资产视图）
  cognitive?: Partial<CognitiveStructure>;  // 该 Run 的核心推荐（三分类，finalize 时按 run_id 关联）
  created_at: string;
}

/** 检索记录详情（GET /api/search/runs/{id}，检索页「已推荐」视图数据源；SearchRunRecord + 项目名） */
export interface RunDetail extends SearchRunRecord {
  project_id: number;
  project_name?: string;
  tech_probe?: string | null;
  map_status?: "none" | "generating" | "done" | "failed";  // 领域地图状态（类型见 @/types/map）
}

export interface CognitiveCategoryCount {
  category: string;
  count: number;
}

export interface PaperBrief {
  paper_id: number;
  openalex_id: string;
  title: string;
  year?: number | null;
  stage: string;
  explored: boolean;
  category?: string;   // 建议归类（foundation/mainstream/frontier，深研推荐集）
  reason?: string;     // 推荐理由（深研结果卡同源）
}

export interface SubResearchWorkspace {
  project_id: number;
  name: string;
  user_query?: string | null;
  tech_probe?: string | null;
  created_at: string;
  search_runs: SearchRunRecord[];
  papers: PaperBrief[];            // 子研究池内论文（头部统计）
  explored_papers: PaperBrief[];   // 已探究论文（头部统计）
}

export interface ConversationWorkspace {
  conversation_id: string;
  title: string;
  sub_researches: SubResearchWorkspace[];
}

// ── Settings / 公告 ──

export interface Announcement {
  id: number;
  level: AnnouncementLevel;
  title: string;
  content: string;
  created_at: string;
}

// ── Funnel（漏斗多智能体工作流） ──

export interface SkeletonRecommendation {
  paper_id: number;
  title: string;
  year: number;
  cited_by_count: number;
  venue: string;
  abstract: string;
  suggested_category: Category;
  confidence: Confidence;
  reason: string;
  user_decision?: "accept" | "skip" | "reassign" | null;
  user_category?: string | null;
}

export interface ProbeDerivation {
  probe: string;
  description: string;
  coverage: number;
  coverage_ratio: number;
  sample_papers: string[];
}

export interface FunnelProgress {
  intent?: {
    status: string;
    original_input?: string;
    parsed_query?: string;
    parsed_probe?: string;
    methodology?: string;
    paper_type?: string;
    year_from?: number | null;
    year_to?: number | null;
    confidence?: string;
    reasoning?: string;
    all_complete?: boolean;
    next_question?: string;
  };
  trunk?: {
    status: string;
    total_found?: number;
    after_rerank?: number;
    new_saved?: number;
    survey_count?: number;
  };
  skeleton?: {
    status: string;
    recommended?: number;
    by_category?: Partial<Record<Category, number>>;
  };
  probe?: {
    status: string;
    probes_count?: number;
    top_probe?: string;
  };
}

export interface FunnelState {
  project_id: number;
  user_query: string;
  tech_probe: string;
  mode: "auto" | "step";
  current_stage: string;
  stage_status: string;
  error?: string | null;
  interrupted?: boolean;
  progress?: FunnelProgress;
  trunk_survey_count?: number;
  skeleton_recommendations?: SkeletonRecommendation[];
  skeleton_confirmed?: number[];
  skeleton_skipped?: number[];
  derived_probes?: ProbeDerivation[];
  selected_probe?: string;
}

export interface FunnelStartResponse {
  thread_id: string;
  status: string;
}

export interface FunnelResumeResponse {
  thread_id: string;
  status: string;
}

export interface FunnelStateResponse {
  thread_id: string;
  current_stage: string;
  stage_status: string;
  interrupted: boolean;
  progress: FunnelProgress;
  state: FunnelState;
}
