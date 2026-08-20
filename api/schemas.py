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


# ── Paper ──

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
    in_cart: bool = False


class PaperListResponse(BaseModel):
    papers: list[PaperOut]
    total: int
    page: int
    page_size: int


# ── Cart ──

class CartAddRequest(BaseModel):
    project_id: int
    paper_id: int
    category: str = "mainstream"
    notes: str = ""


class CartItemOut(BaseModel):
    cart_id: int
    paper_id: int
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


class BranchPaperResultOut(BaseModel):
    paper_id: int
    title: str
    authors: list[str] = []
    year: int | None = None
    venue: str = ""
    doi: str = ""
    abstract: str = ""
    cited_by_count: int = 0
    content_level: int = 5
    content_source: str = "abstract"
    method_summary: str = ""
    probe_match: bool = False
    probe_confidence: str = "none"
    key_findings: str = ""
    optimization_method: str = ""
    error: str = ""


class BranchAnalyzeResponse(BaseModel):
    results: list[BranchPaperResultOut]
    total: int
    mode: str
    level_distribution: dict[str, int] = {}


# ── Network ──

class NetworkAnalyzeRequest(BaseModel):
    project_id: int


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


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    stage: str = "greeting"
    params: dict = {}
    search_result: dict | None = None
