"""
全局配置管理 —— 单一入口，读取 .env
"""
import os
from pathlib import Path
from dataclasses import dataclass, field
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


# ── 厂商绑定表：provider → (base_url, default_model) ──
PROVIDERS = {
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "default_model": "deepseek-v4-flash",
    },
    "kimi": {
        "base_url": "https://api.moonshot.cn/v1",
        "default_model": "moonshot-v1-32k",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
    },
    # 想加别的厂商，直接在这里新增一行即可
}


@dataclass
class Settings:
    """应用全局配置"""

    # 数据库（PostgreSQL + pgvector）
    postgres_url: str = field(
        default_factory=lambda: os.getenv(
            "POSTGRES_URL",
            "postgresql+psycopg://postgres:123456@localhost:5432/agent",
        )
    )

    # 认证
    jwt_secret: str = field(
        default_factory=lambda: os.getenv(
            "JWT_SECRET", "scholar-funnel-dev-secret-0123456789abcdef"
        )
    )

    # LLM —— 绑定为一组：provider + api_key
    llm_provider: str = field(
        default_factory=lambda: os.getenv("LLM_PROVIDER", "deepseek").lower().strip()
    )
    llm_api_key: str = field(
        default_factory=lambda: os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    )
    llm_model: str = field(
        default_factory=lambda: os.getenv("LLM_MODEL", "").strip()
    )

    # SiliconFlow（embedding / rerank API 后端，对话页可切换；本地模型仍可用）
    sf_api_key: str = field(
        default_factory=lambda: os.getenv("SILICONFLOW_API_KEY", "")
    )
    sf_base_url: str = field(
        default_factory=lambda: os.getenv("SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1")
    )
    sf_embedding_model: str = field(
        default_factory=lambda: os.getenv("SF_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")
    )
    sf_rerank_model: str = field(
        default_factory=lambda: os.getenv("SF_RERANK_MODEL", "Qwen/Qwen3-Reranker-0.6B")
    )

    google_api_key: str = field(
        default_factory=lambda: os.getenv("GOOGLE_API_KEY", "")
    )

    # GitHub
    github_token: str = field(
        default_factory=lambda: os.getenv("GITHUB_TOKEN", "")
    )

    # 日志落库（utils/log.py DbLogHandler 异步写 sys_app_logs）
    log_db_enabled: bool = field(
        default_factory=lambda: os.getenv("LOG_DB_ENABLED", "true").lower() in ("1", "true", "yes", "on")
    )
    log_db_level: str = field(
        default_factory=lambda: os.getenv("LOG_DB_LEVEL", "INFO").upper().strip()
    )

    # 本地路径
    data_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data")
    pdf_cache_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data" / "pdfs")
    chroma_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data" / "chroma")

    def __post_init__(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.pdf_cache_dir.mkdir(parents=True, exist_ok=True)
        self.chroma_dir.mkdir(parents=True, exist_ok=True)

        # 校验 provider 是否合法
        if self.llm_provider not in PROVIDERS:
            raise RuntimeError(
                f"不支持的 LLM_PROVIDER: '{self.llm_provider}'。 "
                f"可选: {', '.join(PROVIDERS.keys())}"
            )
        if not self.llm_api_key:
            raise RuntimeError("未配置 LLM_API_KEY（或兼容的 OPENAI_API_KEY）")

    # ── 绑定属性：直接取对应厂商的地址和模型 ──
    @property
    def llm_base_url(self) -> str:
        return PROVIDERS[self.llm_provider]["base_url"]

    @property
    def llm_default_model(self) -> str:
        # 如果 .env 显式配置了 LLM_MODEL，优先用；否则用厂商默认值
        return self.llm_model or PROVIDERS[self.llm_provider]["default_model"]


settings = Settings()