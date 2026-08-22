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
    __tablename__ = "ai_projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    user_query: Mapped[str] = mapped_column(Text, nullable=False)
    tech_probe: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_users.id"), default=None, doc="归属用户（NULL=系统级未归属）"
    )
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
    __tablename__ = "ai_papers"
    __table_args__ = (
        Index("idx_project_stage", "project_id", "stage"),
        Index("idx_cited", "cited_by_count"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("ai_projects.id"), nullable=False)
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
        Enum("trunk", "branch", "network", "gap", name="ai_paper_stage"), default="trunk"
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
    __tablename__ = "ai_analysis_results"
    __table_args__ = (
        Index("idx_match", "probe_match", "probe_confidence"),
        UniqueConstraint("paper_id", "mode", name="uniq_analysis_paper_mode"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("ai_papers.id"), nullable=False)
    mode: Mapped[str | None] = mapped_column(
        String(20), default=None, doc="分析模式: probe_match/ai_suggest/landscape"
    )
    content_level: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    content_source: Mapped[str] = mapped_column(String(30))
    method_summary: Mapped[str | None] = mapped_column(Text)
    probe_match: Mapped[bool] = mapped_column(Boolean, default=False)
    probe_confidence: Mapped[str | None] = mapped_column(
        Enum("high", "medium", "low", "none", name="ai_confidence_level")
    )
    key_formulas: Mapped[dict | None] = mapped_column(JSON)
    optimization_method: Mapped[str | None] = mapped_column(String(255))
    analyzed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关系
    paper: Mapped["Paper"] = relationship(back_populates="analysis")


class Citation(Base):
    """引用关系"""
    __tablename__ = "ai_citations"
    __table_args__ = (
        UniqueConstraint("project_id", "source_id", "target_id", name="uniq_citation"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("ai_projects.id"), nullable=False)
    source_id: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str] = mapped_column(String(50), nullable=False)
    is_influential: Mapped[bool] = mapped_column(Boolean, default=False)

    # 关系
    project: Mapped["Project"] = relationship(back_populates="citations")


class CodeRepo(Base):
    """开源代码信息"""
    __tablename__ = "ai_code_repos"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("ai_papers.id"), nullable=False)
    github_url: Mapped[str | None] = mapped_column(String(500))
    stars: Mapped[int] = mapped_column(Integer, default=0)
    language: Mapped[str | None] = mapped_column(String(50))
    last_updated: Mapped[str | None] = mapped_column(String(20))
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关系
    paper: Mapped["Paper"] = relationship(back_populates="code_repo")


class Author(Base):
    """作者信息"""
    __tablename__ = "ai_authors"

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
    __tablename__ = "ai_cart"
    __table_args__ = (
        UniqueConstraint("project_id", "paper_id", name="uniq_cart"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("ai_projects.id"), nullable=False)
    paper_id: Mapped[int] = mapped_column(ForeignKey("ai_papers.id"), nullable=False)
    category: Mapped[str] = mapped_column(
        Enum("foundation", "mainstream", "frontier", name="ai_cart_category"),
        nullable=False,
    )
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    notes: Mapped[str | None] = mapped_column(Text)

    # 关系
    project: Mapped["Project"] = relationship(back_populates="cart_items")
    paper: Mapped["Paper"] = relationship(back_populates="cart_entry")


# ══════════════════════════════════════════════════════════
#  用户与认证域（对齐 db/postgres/02_users.sql）
# ══════════════════════════════════════════════════════════

class User(Base):
    """用户主表（纯净身份）"""
    __tablename__ = "ai_users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    nickname: Mapped[str | None] = mapped_column(String(64))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[int] = mapped_column(SmallInteger, default=1)   # 0=禁用 1=正常
    role: Mapped[str] = mapped_column(String(32), default="user")  # guest/user/admin
    tenant_id: Mapped[int | None] = mapped_column(Integer)
    preferences: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)


class UserCredential(Base):
    """登录凭据（密码哈希）"""
    __tablename__ = "ai_user_credentials"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("ai_users.id"), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    salt: Mapped[str | None] = mapped_column(String(64))
    password_set_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserSecurity(Base):
    """账号安全状态"""
    __tablename__ = "ai_user_security"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("ai_users.id"), unique=True, nullable=False)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(64))
    login_fail_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_login_ip: Mapped[str | None] = mapped_column(String(64))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserSession(Base):
    """登录会话（Refresh Token 哈希，可吊销）"""
    __tablename__ = "ai_user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("ai_users.id"), nullable=False)
    session_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(64))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Conversation(Base):
    """会话（Agent 对话容器，按用户隔离）"""
    __tablename__ = "ai_conversations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("ai_users.id"), nullable=False)
    tenant_id: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str | None] = mapped_column(String(255))
    agent_id: Mapped[int | None] = mapped_column(Integer)
    agent_version_id: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[int] = mapped_column(SmallInteger, default=1)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    token_usage_total: Mapped[int] = mapped_column(Integer, default=0)
    cost_total: Mapped[float] = mapped_column(default=0)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False)
    share_uuid: Mapped[str | None] = mapped_column(String(32), unique=True)
    share_password: Mapped[str | None] = mapped_column(String(64))
    share_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
    # 注意：memory_embedding（vector 列）不在此映射，向量读写走 storage/vector_store.py 原生 SQL

    # 会话落库新增（DDL 07）
    stage: Mapped[str | None] = mapped_column(String(20), default="greeting")
    params: Mapped[dict | None] = mapped_column(JSON)
    project_id: Mapped[int | None] = mapped_column(Integer)


class Message(Base):
    """会话消息（按用户隔离）"""
    __tablename__ = "ai_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("ai_conversations.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("ai_users.id"), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[str | None] = mapped_column(String(16), default="text")
    attachments: Mapped[dict | None] = mapped_column(JSON)
    feedback: Mapped[int | None] = mapped_column(SmallInteger)
    feedback_comment: Mapped[str | None] = mapped_column(Text)
    is_error: Mapped[bool] = mapped_column(Boolean, default=False)
    error_code: Mapped[str | None] = mapped_column(String(32))
    error_detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)