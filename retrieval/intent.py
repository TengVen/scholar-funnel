from dataclasses import dataclass, field
from typing import List


@dataclass
class MethodologyDim:
    core: List[str] = field(default_factory=list)
    synonyms: List[str] = field(default_factory=list)
    related: List[str] = field(default_factory=list)
    paradigm: str = ""


@dataclass
class DomainDim:
    core: List[str] = field(default_factory=list)
    synonyms: List[str] = field(default_factory=list)
    broader: List[str] = field(default_factory=list)
    task: str = ""


@dataclass
class ResearchIntent:
    raw_query: str
    tech_probe: str
    methodology: MethodologyDim
    domain: DomainDim
    paradigm: str
    combined_queries: List[str]
    reasoning: str

    def to_embedding_text(self) -> str:
        return (
            f"Methodology: {', '.join(self.methodology.core)}. "
            f"Domain: {', '.join(self.domain.core)}. "
            f"Task: {self.domain.task}. "
            f"Paradigm: {self.paradigm}. "
            f"Research: {self.raw_query}"
        )

    def to_rerank_query(self) -> str:
        """给 Reranker 用的结构化查询文本"""
        return self.to_embedding_text()