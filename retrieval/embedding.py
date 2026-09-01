"""
Embedding 向量化 —— 双后端（本地模型 / SiliconFlow API）

- 本地：bge-large-zh-v1.5（1024 维，中英双语）
- API：Qwen/Qwen3-Embedding-0.6B（SiliconFlow，OpenAI 兼容 /embeddings）
- 运行时 configure(provider) 切换：'local' / 'api'
- 兜底规则：provider 为 local 但本地模型文件不存在 → 自动回退 API；两者都不可用 → 抛错
- 输出 L2 归一化向量（配合 pgvector cosine 检索）
"""
import os
import threading
from typing import List, Optional

from sentence_transformers import SentenceTransformer

from utils.config import settings
from utils.log import setup_logger
from utils.api_post import post_json

logger = setup_logger("embedding")

_LOCAL_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "apiTest", "bge-large-zh-v1.5"
)

# 建议最大批大小（CPU 上平衡速度与显存/内存）
_MAX_BATCH = 32

# ── 模块级单例（本地模型延迟加载） ──
_model: SentenceTransformer | None = None
_loaded = False

# 运行时配置（对话页高级设置写入；缺省自动检测）
_runtime: dict = {}


def _local_available() -> bool:
    """本地模型是否可用（目录 + config.json 存在）"""
    return os.path.isdir(_LOCAL_MODEL_PATH) and os.path.exists(
        os.path.join(_LOCAL_MODEL_PATH, "config.json")
    )


def _provider_default() -> str:
    """默认 provider：本地模型存在 → local，否则 api"""
    return "local" if _local_available() else "api"


def _resolve_provider(provider: Optional[str]) -> str:
    """解析实际生效 provider：local 但本地不可用 → 回退 api"""
    p = (provider or _runtime.get("provider") or _provider_default()).lower()
    if p == "local" and not _local_available():
        logger.warning("本地 embedding 模型不可用，回退 API")
        return "api"
    return p


def configure(provider: Optional[str] = None) -> None:
    """运行时切换后端：'local' / 'api'（None=不修改；未配置过时走自动检测）"""
    if provider:
        _runtime["provider"] = provider.lower()


def _ensure_model():
    global _model, _loaded
    if _loaded:
        return
    logger.info(f"加载 BGE Embedding（bge-large-zh-v1.5）: {_LOCAL_MODEL_PATH}")
    _model = SentenceTransformer(_LOCAL_MODEL_PATH)
    _loaded = True
    logger.info("Embedding 模型加载完成（1024 维）")


def _api_embed(texts: List[str], batch_size: int) -> List[list[float]]:
    """SiliconFlow API 向量化（OpenAI 兼容 /embeddings，分批 + 重试）"""
    api_key = _runtime.get("api_key") or settings.sf_api_key
    base = _runtime.get("base_url") or settings.sf_base_url
    model = _runtime.get("model") or settings.sf_embedding_model
    if not api_key:
        raise RuntimeError("未配置 SiliconFlow API Key（.env 的 SILICONFLOW_API_KEY）")

    vectors: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        resp = post_json(
            f"{base.rstrip('/')}/embeddings",
            {"model": model, "input": batch},
            api_key,
        )
        items = sorted(resp.get("data", []), key=lambda d: d.get("index", 0))
        for item in items:
            vec = item.get("embedding")
            if vec:
                # L2 归一化，与本地后端输出一致（配合余弦检索）
                norm = sum(v * v for v in vec) ** 0.5 or 1.0
                vectors.append([v / norm for v in vec])
    if len(vectors) != len(texts):
        raise RuntimeError(f"Embedding API 返回数量不符: {len(vectors)}/{len(texts)}")
    return vectors


class EmbeddingService:
    def __init__(self, provider: Optional[str] = None):
        self.provider = provider

    def encode(self, texts: List[str], batch_size: int = _MAX_BATCH) -> List[list[float]]:
        """将文本列表向量化（L2 归一化）。后端由 provider 决定：local / api"""
        if not texts:
            return []
        if _resolve_provider(self.provider) == "api":
            return _api_embed(texts, batch_size)
        _ensure_model()
        vectors = _model.encode(
            texts,
            batch_size=batch_size,
            normalize_embeddings=True,   # L2 归一化，余弦相似度 = 点积
            show_progress_bar=False,
        )
        return [v.tolist() for v in vectors]

    def encode_one(self, text: str) -> list[float]:
        """单条文本向量化"""
        return self.encode([text])[0]


# 模块级默认实例（provider 由运行时配置决定，首次调用时生效）
_default: EmbeddingService | None = None
_default_lock = threading.Lock()  # 并发安全：多任务同时触发懒加载时不重复构造模型


def get_embedder() -> EmbeddingService:
    """获取全局默认 EmbeddingService（单例，双重检查锁——并发检索/分析共享一个模型实例）"""
    global _default
    if _default is None:
        with _default_lock:
            if _default is None:
                _default = EmbeddingService()
    return _default
