"""
BGE Embedding —— 论文语义向量化

- 模型：bge-large-zh-v1.5（1024 维，中英双语，中文 query → 英文论文跨语言匹配）
- 模块级单例缓存（与 reranker 同款模式）
- 输出 L2 归一化向量（配合 pgvector cosine 检索）
"""
import os
from typing import List

from sentence_transformers import SentenceTransformer
from utils.log import setup_logger

logger = setup_logger("embedding")

_LOCAL_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "apiTest", "bge-large-zh-v1.5"
)

# 模块级单例
_model: SentenceTransformer | None = None
_loaded = False

# 建议最大批大小（CPU 上平衡速度与显存/内存）
_MAX_BATCH = 32


def _ensure_model(model_path: str | None = None):
    global _model, _loaded
    if _loaded:
        return
    path = model_path or _LOCAL_MODEL_PATH
    logger.info(f"加载 BGE Embedding（bge-large-zh-v1.5）: {path}")
    _model = SentenceTransformer(path)
    _loaded = True
    logger.info("Embedding 模型加载完成（1024 维）")


class EmbeddingService:
    def __init__(self, model_path: str | None = None):
        _ensure_model(model_path)

    def encode(self, texts: List[str], batch_size: int = _MAX_BATCH) -> List[list[float]]:
        """
        将文本列表向量化（1024 维，L2 归一化）。

        Args:
            texts: 文本列表（论文 title+abstract 拼接，或检索 query）
            batch_size: 批大小

        Returns:
            List[list[float]] —— 每项是 1024 维浮点向量
        """
        if not texts:
            return []
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


# 模块级默认实例（延迟加载，首次调用才载入模型）
_default: EmbeddingService | None = None


def get_embedder() -> EmbeddingService:
    """获取全局默认 EmbeddingService（单例）"""
    global _default
    if _default is None:
        _default = EmbeddingService()
    return _default
