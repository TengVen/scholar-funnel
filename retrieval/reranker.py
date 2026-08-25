"""
Reranker —— 论文相关性重排序（双后端：本地模型 / SiliconFlow API）

- 本地：BGE Reranker（bge-reranker-large，transformers/ONNX）
- API：Qwen/Qwen3-Reranker-0.6B（SiliconFlow，POST /rerank）
- 运行时 configure(provider) 切换：'local' / 'api'
- 兜底规则：provider 为 local 但本地模型文件不存在 → 自动回退 API
"""
import os
import torch
from typing import List, Tuple, Optional
from transformers import AutoTokenizer

from utils.config import settings
from utils.log import setup_logger
from utils.api_post import post_json

logger = setup_logger("reranker")

_LOCAL_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "apiTest", "bge-reranker-large"
)

# ── 运行时选择推理后端 ──
BACKEND = "pytorch"
try:
    from optimum.onnxruntime import ORTModelForSequenceClassification
    BACKEND = "onnx"
except ImportError:
    from transformers import AutoModelForSequenceClassification

_MAX_SEQ_LEN = 384        # CPU 上缩短序列长度 ≈ 2x 加速
_MAX_BATCH = 64           # 拆成小 batch，避免单次处理太多

# ── 模块级缓存 ──
_tokenizer = None
_model = None
_device = None
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
        logger.warning("本地 rerank 模型不可用，回退 API")
        return "api"
    return p


def configure(provider: Optional[str] = None) -> None:
    """运行时切换后端：'local' / 'api'（None=不修改；未配置过时走自动检测）"""
    if provider:
        _runtime["provider"] = provider.lower()


def _ensure_model(model_path: str):
    global _tokenizer, _model, _device, _loaded
    if _loaded:
        return

    path = model_path or _LOCAL_MODEL_PATH
    logger.info(f"加载 BGE Reranker（{BACKEND} 后端）: {path}")
    _tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)

    if BACKEND == "onnx":
        onnx_path = os.path.join(path, "onnx", "model.onnx")
        if os.path.exists(onnx_path):
            _model = ORTModelForSequenceClassification.from_pretrained(
                path, file_name="onnx/model.onnx",
                provider="CPUExecutionProvider",
            )
            _device = torch.device("cpu")
            logger.info("使用 ONNX Runtime CPU 推理")
        else:
            logger.warning("ONNX 模型文件不存在，回退到 PyTorch")
            _fallback_pytorch(path)
    else:
        _fallback_pytorch(path)

    _loaded = True


def _fallback_pytorch(path: str):
    global _model, _device
    _model = AutoModelForSequenceClassification.from_pretrained(
        path, local_files_only=True
    )
    _model.eval()
    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    _model.to(_device)
    device_str = "GPU" if _device.type == "cuda" else "CPU"
    logger.info(f"使用 PyTorch {device_str}")


def _api_rerank(query_text: str, docs: List[str]) -> List[Tuple[int, float]]:
    """SiliconFlow /rerank：分批打分，返回 [(doc_index, score), ...]"""
    api_key = _runtime.get("api_key") or settings.sf_api_key
    base = _runtime.get("base_url") or settings.sf_base_url
    model = _runtime.get("model") or settings.sf_rerank_model
    if not api_key:
        raise RuntimeError("未配置 SiliconFlow API Key（.env 的 SILICONFLOW_API_KEY）")

    scored: List[Tuple[int, float]] = []
    for i in range(0, len(docs), _MAX_BATCH):
        batch = docs[i:i + _MAX_BATCH]
        resp = post_json(
            f"{base.rstrip('/')}/rerank",
            {
                "model": model,
                "query": query_text,
                "documents": batch,
                "top_n": len(batch),
                "return_documents": False,
            },
            api_key,
        )
        for r in resp.get("results", []):
            scored.append((i + r["index"], float(r.get("relevance_score", 0.0))))
    return scored


class ResearchReranker:
    def __init__(self, model_path: str = None, provider: Optional[str] = None):
        self.provider = provider
        if _resolve_provider(provider) == "local":
            _ensure_model(model_path or _LOCAL_MODEL_PATH)
        self.tokenizer = _tokenizer
        self.model = _model
        self.device = _device

    @staticmethod
    def _pair_text(p: dict) -> str:
        return f"Title: {p.get('title', '')} | Abstract: {p.get('abstract', '')[:800]}"

    def rerank(self, query_text: str, papers: List[dict]) -> List[Tuple[dict, float]]:
        """给候选论文按相关性打分并排序，返回 [(paper, score), ...]"""
        if not papers:
            return []

        if _resolve_provider(self.provider) == "api":
            docs = [self._pair_text(p) for p in papers]
            score_map = dict(_api_rerank(query_text, docs))
            results = [(p, score_map.get(i, 0.0)) for i, p in enumerate(papers)]
            results.sort(key=lambda x: x[1], reverse=True)
            return results

        # ── 本地推理 ──
        if not _loaded:
            _ensure_model(_LOCAL_MODEL_PATH)
        pairs = [self._pair_text(p) for p in papers]

        all_scores = []
        for i in range(0, len(pairs), _MAX_BATCH):
            batch_pairs = pairs[i:i + _MAX_BATCH]
            all_scores.extend(self._score_batch(batch_pairs))

        results = list(zip(papers, all_scores))
        results.sort(key=lambda x: x[1], reverse=True)
        return results

    def _score_batch(self, pairs: List[tuple]) -> List[float]:
        """给一个 batch 的 pairs 评分（本地后端）"""
        inputs = self.tokenizer(
            pairs, padding=True, truncation=True,
            max_length=_MAX_SEQ_LEN, return_tensors="pt"
        )

        if BACKEND == "onnx":
            # ONNX Runtime: 输入是 dict of numpy
            inputs_np = {k: v.numpy() for k, v in inputs.items()}
            outputs = self.model(**inputs_np)
            logits = torch.from_numpy(outputs.logits)
        else:
            # PyTorch: 正常 tensor 推理
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            logits = self.model(**inputs).logits

        # 解析分数
        if logits.dim() == 2 and logits.shape[1] == 1:
            scores = torch.sigmoid(logits.squeeze(-1))
        elif logits.dim() == 2 and logits.shape[1] == 2:
            scores = torch.softmax(logits, dim=1)[:, 1]
        else:
            scores = torch.sigmoid(logits.view(-1))

        return [s.item() for s in scores.cpu()]
