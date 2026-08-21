"""
MySQL ORM 模型定义 —— 所有表结构集中管理
"""
from datetime import datetime
from sqlalchemy import (
    String, Text, SmallInteger, Integer, Boolean, DateTime, Enum, JSON,
    ForeignKey, UniqueConstraint, Index,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """ORM 基类"""
    pass


class Project(Base):
    """检索项目"""
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    user_query: Mapped[str] = mapped_column(Text, nullable=False)
    tech_probe: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # 关系
    papers: Mapped[list["Paper"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    citations: Mapped[list["Citation"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    cart_items: Mapped[list["CartItem"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Paper(Base):
    """论文元数据"""
    __tablename__ = "papers"
    __table_args__ = (
        Index("idx_project_stage", "project_id", "stage"),
        Index("idx_cited", "cited_by_count"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    openalex_id: Mapped[str] = mapped_column(String(50), unique=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    authors: Mapped[dict | None] = mapped_column(JSON)
    year: Mapped[int | None] = mapped_column(SmallInteger)
    venue: Mapped[str | None] = mapped_column(String(255))
    doi: Mapped[str | None] = mapped_column(String(255))
    arxiv_id: Mapped[str | None] = mapped_column(String(50))
    abstract: Mapped[str | None] = mapped_column(Text)
    cited_by_count: Mapped[int] = mapped_column(Integer, default=0)
    is_survey: Mapped[bool] = mapped_column(Boolean, default=False)
    stage: Mapped[str] = mapped_column(
        Enum("trunk", "branch", "network", "gap", name="paper_stage"), default="trunk"
    )
    trunk_score: Mapped[float | None] = mapped_column(
        default=None, doc="主干检索最终评分（用于排序）"
    )
    keywords: Mapped[dict | None] = mapped_column(JSON, default=None, doc="关键词/概念标签")
    github_url: Mapped[str | None] = mapped_column(String(500), default=None, doc="关联 GitHub 仓库")
    recommended_category: Mapped[str | None] = mapped_column(
        String(20), default=None, doc="缺口检索推荐类别: foundation/mainstream/frontier"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关系
    project: Mapped["Project"] = relationship(back_populates="papers")
    analysis: Mapped["AnalysisResult | None"] = relationship(
        back_populates="paper", uselist=False, cascade="all, delete-orphan"
    )
    code_repo: Mapped["CodeRepo | None"] = relationship(
        back_populates="paper", uselist=False, cascade="all, delete-orphan"
    )
    cart_entry: Mapped["CartItem | None"] = relationship(
        back_populates="paper", uselist=False
    )


class AnalysisResult(Base):
    """分支深挖分析结果"""
    __tablename__ = "analysis_results"
    __table_args__ = (
        Index("idx_match", "probe_match", "probe_confidence"),
        UniqueConstraint("paper_id", "mode", name="uniq_analysis_paper_mode"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id"), nullable=False)
    mode: Mapped[str | None] = mapped_column(
        String(20), default=None, doc="分析模式: probe_match/ai_suggest/landscape"
    )
    content_level: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    content_source: Mapped[str] = mapped_column(String(30))
    method_summary: Mapped[str | None] = mapped_column(Text)
    probe_match: Mapped[bool] = mapped_column(Boolean, default=False)
    probe_confidence: Mapped[str | None] = mapped_column(
        Enum("high", "medium", "low", "none", name="confidence_level")
    )
    key_formulas: Mapped[dict | None] = mapped_column(JSON)
    optimization_method: Mapped[str | None] = mapped_column(String(255))
    analyzed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关系
    paper: Mapped["Paper"] = relationship(back_populates="analysis")


class Citation(Base):
    """引用关系"""
    __tablename__ = "citations"
    __table_args__ = (
        UniqueConstraint("project_id", "source_id", "target_id", name="uniq_citation"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    source_id: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str] = mapped_column(String(50), nullable=False)
    is_influential: Mapped[bool] = mapped_column(Boolean, default=False)

    # 关系
    project: Mapped["Project"] = relationship(back_populates="citations")


class CodeRepo(Base):
    """开源代码信息"""
    __tablename__ = "code_repos"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id"), nullable=False)
    github_url: Mapped[str | None] = mapped_column(String(500))
    stars: Mapped[int] = mapped_column(Integer, default=0)
    language: Mapped[str | None] = mapped_column(String(50))
    last_updated: Mapped[str | None] = mapped_column(String(20))
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关系
    paper: Mapped["Paper"] = relationship(back_populates="code_repo")


class Author(Base):
    """作者信息"""
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    openalex_id: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    affiliation: Mapped[str | None] = mapped_column(String(500))
    h_index: Mapped[int | None] = mapped_column(Integer)
    works_count: Mapped[int | None] = mapped_column(Integer)
    cited_by_count: Mapped[int | None] = mapped_column(Integer)
    tracked: Mapped[bool] = mapped_column(Boolean, default=False)


class CartItem(Base):
    """骨架清单"""
    __tablename__ = "cart"
    __table_args__ = (
        UniqueConstraint("project_id", "paper_id", name="uniq_cart"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id"), nullable=False)
    category: Mapped[str] = mapped_column(
        Enum("foundation", "mainstream", "frontier", name="cart_category"),
        nullable=False,
    )
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    notes: Mapped[str | None] = mapped_column(Text)

    # 关系
    project: Mapped["Project"] = relationship(back_populates="cart_items")
    paper: Mapped["Paper"] = relationship(back_populates="cart_entry")