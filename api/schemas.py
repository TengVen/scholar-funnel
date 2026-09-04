"""
Pydantic 请求/响应模型 —— API 层的数据契约
"""
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional


# ── Project ──

class ProjectCreate(BaseModel):
    name: str = Field(..., max_length=255)
    user_query: str
    tech_probe: str = ""


class ProjectOut(BaseModel):
    id: int
    name: str
    user_query: str
    tech_probe: str | None
    created_at: str

    class Config:
        from_attributes = True


# ── Search ──

class SearchRequest(BaseModel):
    project_id: int
    user_query: str
    tech_probe: str = ""
    per_query: int = Field(default=25, ge=5, le=100)
    year_from: int | None = None
    year_to: int | None = None
    score_threshold: float = 0.0
    top_k: int = Field(default=100, ge=10, le=500)
    max_queries: int = Field(default=8, ge=1, le=20)


class SearchResponse(BaseModel):
    expanded_queries: list[str]
    reasoning: str
    total_found: int
    after_rerank: int
    new_saved: int
    survey_count: int
    trace: dict


class GapSearchRequest(BaseModel):
    """缺口补充检索请求：定向检索某类别的论文，返回候选不入库"""
    project_id: int
    user_query: str                    # 领域描述（沿用项目研究方向）
    target_category: str               # foundation / mainstream / frontier
    tech_probe: str = ""
    user_constraint: str = ""          # 可选：用户补充约束（如"重点关注变分方法"）
    per_query: int = Field(default=25, ge=5, le=100)
    top_k: int = Field(default=50, ge=5, le=200)
    score_threshold: float = 0.35      # 比全量检索更严，过滤噪声
    max_queries: int = Field(default=6, ge=1, le=20)


class GapCandidate(BaseModel):
    """缺口补充检索候选论文"""
    paper_id: int | None = None        # 已在库则带 id，否则 None
    openalex_id: str
    title: str
    authors: list[str] = []
    year: int | None = None
    venue: str = ""
    abstract: str = ""
    cited_by_count: int = 0
    is_survey: bool = False
    keywords: list[str] = []
    github_url: str | None = None
    relevance_score: float = 0.0       # BGE 相关度
    recommended_category: str           # 推荐类别
    confidence: str = "medium"          # high / medium / low
    reason: str = ""                    # AI 判定理由
    already_in_cart: bool = False
    already_in_db: bool = False
    similarity: float | None = None     # 语义相似度（语义缺口补充用）


class SemanticGapRequest(BaseModel):
    """语义缺口补充请求：骨架质心 → 项目内未入骨架论文"""
    project_id: int
    target_category: str                # foundation / mainstream / frontier
    top_k: int = Field(default=20, ge=1, le=50)
    similarity_threshold: float = Field(default=0.35, ge=0.0, le=1.0)


class GapSearchResponse(BaseModel):
    """缺口补充检索响应：候选列表（不入库）"""
    target_category: str
    candidates: list[GapCandidate]
    expanded_queries: list[str]
    reasoning: str
    total_found: int
    returned: int
    status: str                        # ok / low_results / empty


class TitleLookupRequest(BaseModel):
    """按标题直达查询（骨架补充的"标题直达"模式）"""
    project_id: int
    title: str                         # 论文标题
    target_category: str               # foundation / mainstream / frontier


class LocalSearchRequest(BaseModel):
    """本地库二次检索请求：对已入库论文按向量语义召回领域/技术子集"""
    project_id: int
    query: str                         # 领域或技术探针（语义查询）
    limit: int = Field(default=30, ge=1, le=100)


class LocalSearchResponse(BaseModel):
    """本地库二次检索响应：返回已入库论文的子集（不重复入库）"""
    papers: list[PaperOut]
    total: int
    query: str
    mode: str = "local"


# ── Paper ──

class PaperWhy(BaseModel):
    """召回溯源（"为什么是它"）：来源 ai_papers.recall_meta，纯 E2 级结构化事实"""
    routes: list[str] = []            # core / synonym / aux / loose / semantic
    matched_terms: list[str] = []     # 命中的检索词（title/abstract 朴素匹配）
    source: str = "openalex"          # openalex / semantic
    similarity: float | None = None   # 语义召回相似度（仅 semantic）
    rerank_score: float | None = None
    confidence: str | None = None     # high / medium / low（由 rerank_score 分档）
    reason: str | None = None         # 自然语言推荐理由（面向用户；分数/匹配/置信度为内部信号不外露）


class PaperOut(BaseModel):
    id: int
    title: str
    authors: list[str] | None = None
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    abstract: str | None = None
    cited_by_count: int = 0
    is_survey: bool = False
    trunk_score: float | None = None
    keywords: list[str] = []
    github_url: str | None = None
    in_cart: bool = False
    why: PaperWhy | None = None


class PaperListResponse(BaseModel):
    papers: list[PaperOut]
    total: int
    page: int
    page_size: int


# ── 论文详情页（三栏 + 三态）──

class PaperDetailOut(BaseModel):
    """详情页聚合：基础元数据 + 三态 + 分析就绪状态 + 可执行动作"""
    mode: str                        # project / transient
    paper_id: int | None = None
    openalex_id: str
    title: str
    authors: list[str] = []
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    abstract: str | None = None
    abstract_source: str = ""         # 摘要来源："" 原文 / ai_tldr（Semantic Scholar AI 概要，非原文）
    cited_by_count: int = 0
    github_url: str | None = None
    keywords: list[str] = []
    is_oa: bool = False
    oa_pdf_url: str | None = None
    oa_landing_url: str | None = None
    pdf_available: bool = False        # 是否提供站内 PDF 预览（仅 arXiv 论文）
    in_project: bool = False
    stage: str | None = None
    in_cart: bool = False
    category: str | None = None       # 骨架/认知结构分类
    why: PaperWhy | None = None
    judgment: dict | None = None      # {action, reason}
    sections: list | None = None      # 全文分节（有分析后）
    analysis: dict = {}               # {status: none/running/done, source?: cache/db, content?, material_type?}
    actions: dict = {}                # {can_explore, can_ask}
    qa_history: list[dict] = []       # 该论文历史问答（时间升序，≤20；{question, answer, citations}，供左栏对话流恢复）


class ExploreRequest(BaseModel):
    """深入探究：transient → candidate（落库 + 触发单篇分析预热）
    openalex_id：transient 模式（无 paper_id）用 OpenAlex ID 落库；
    persist：L3 直接落库——分析完成后写 paper_analysis，无需问答。"""
    project_id: int
    openalex_id: str | None = None
    persist: bool = False


class AskRequest(BaseModel):
    """详情页单篇问答：触发分析落库（L2→L3）+ 基于分节/摘要回答"""
    project_id: int
    question: str
    history: list[dict] = Field(
        default_factory=list,
        description="最近对话轮次 [{role: user|assistant, content}]（≤10，承接追问用；仅作上下文不落库）",
    )


class AskResponse(BaseModel):
    answer: str
    citations: list = []              # [{section, snippet}]


# ── Cart ──

class CartAddRequest(BaseModel):
    project_id: int
    paper_id: int
    category: str = "mainstream"
    notes: str = ""


class JudgmentRequest(BaseModel):
    """论文研究判断（对话式修正 / UI 共用）：adopt / exclude / uncertain / none"""
    project_id: int
    paper_id: int
    action: str
    reason: str = ""
    # 仅 adopt 需要：骨架分类（缺省时由服务端按分类规则建议）
    category: str | None = None


class JoinProjectRequest(BaseModel):
    """L1"加入研究"：把回答来源论文纳入项目候选（stage=candidate，不进骨架）"""
    project_id: int
    openalex_id: str


class CartItemOut(BaseModel):
    cart_id: int
    paper_id: int
    openalex_id: str = ""
    category: str
    title: str
    authors: list[str] | None = None
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    abstract: str | None = None
    cited_by_count: int = 0
    is_survey: bool = False
    keywords: list[str] = []
    github_url: str | None = None
    notes: str = ""
    added_at: str = ""


class CartStatusResponse(BaseModel):
    items: list[CartItemOut]
    counts: dict[str, int]
    total: int
    full: bool


# ── Branch ──

class BranchAnalyzeRequest(BaseModel):
    project_id: int
    mode: str = "probe_match"
    probe: str = ""
    category: str = ""   # 分类范围: foundation/mainstream/frontier，空=全部


class BranchPaperResultOut(BaseModel):
    paper_id: int
    title: str
    authors: list[str] = []
    year: int | None = None
    venue: str = ""
    doi: str = ""
    abstract: str = ""
    cited_by_count: int = 0
    category: str = ""
    content_level: int = 5
    content_source: str = "abstract"
    method_summary: str = ""
    probe_match: bool = False
    probe_confidence: str = "none"
    key_findings: str = ""
    optimization_method: str = ""          # 兼容字段：回填 implementation_or_application
    # ── 增强字段（跨领域重构，均为可选，旧前端忽略即可）──
    usage_role: str = ""                   # core/auxiliary/baseline/comparison/mentioned/none
    implementation_or_application: str = ""
    probe_relation: str = ""
    research_question: str = ""
    methodology_type: str = ""
    method_category: str = ""
    method_components: list = []
    research_design: str = ""
    key_innovation: str = ""
    limitations: str = ""
    evidence: list = []
    error: str = ""


class BranchAnalyzeResponse(BaseModel):
    results: list[BranchPaperResultOut]
    total: int
    mode: str
    level_distribution: dict[str, int] = {}


# ── Network ──

class NetworkAnalyzeRequest(BaseModel):
    project_id: int
    category: str = ""   # 分类范围: foundation/mainstream/frontier，空=全部


class RecommendedPaperOut(BaseModel):
    openalex_id: str
    title: str
    authors: list[str] = []
    year: int = 0
    venue: str = ""
    doi: str = ""
    cited_by_count: int = 0
    abstract: str = ""
    source: str = ""
    cited_by_n: int = 0
    citing_n: int = 0
    reason: str = ""


class GraphNodeOut(BaseModel):
    id: str
    label: str
    group: str = "recommended"
    category: str = ""
    year: int = 0
    size: int = 10


class GraphEdgeOut(BaseModel):
    source_id: str
    target_id: str
    label: str = ""


class NetworkResultResponse(BaseModel):
    backward: list[RecommendedPaperOut]
    forward: list[RecommendedPaperOut]
    graph_nodes: list[GraphNodeOut]
    graph_edges: list[GraphEdgeOut]
    stats: dict = {}


# ── Chat ──

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    conversation_id: str
    message: str
    project_id: int | None = None
    llm_config: dict | None = None


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    stage: str = "greeting"
    params: dict = {}
    search_result: dict | None = None
    task_id: str | None = None      # full_search 异步任务（前端轮询用）
    task_type: str | None = None    # "full_search" / "deep_research"（前端按类型选轮询路径）
