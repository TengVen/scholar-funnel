"""
BGE Reranker —— 论文相关性重排序
- 模块级单例缓存
- 批量推理
- ONNX Runtime 加速（如果可用）
"""
import os
import torch
from typing import List, Tuple
from transformers import AutoTokenizer
from utils.log import setup_logger

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
            logger.info(f"使用 ONNX Runtime CPU 推理")
        else:
            logger.warning(f"ONNX 模型文件不存在，回退到 PyTorch")
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


class ResearchReranker:
    def __init__(self, model_path: str = None):
        _ensure_model(model_path or _LOCAL_MODEL_PATH)
        self.tokenizer = _tokenizer
        self.model = _model
        self.device = _device

    @torch.no_grad()
    def rerank(self, query_text: str, papers: List[dict]) -> List[Tuple[dict, float]]:
        if not papers:
            return []

        pairs = [
            (query_text, f"Title: {p.get('title', '')} | Abstract: {p.get('abstract', '')[:800]}")
            for p in papers
        ]

        all_scores = []
        for i in range(0, len(pairs), _MAX_BATCH):
            batch_pairs = pairs[i : i + _MAX_BATCH]
            scores = self._score_batch(batch_pairs)
            all_scores.extend(scores)

        results = list(zip(papers, all_scores))
        results.sort(key=lambda x: x[1], reverse=True)
        return results

    def _score_batch(self, pairs: List[tuple]) -> List[float]:
        """给一个 batch 的 pairs 评分"""
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
