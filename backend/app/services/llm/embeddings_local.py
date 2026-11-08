# SPDX-License-Identifier: Apache-2.0
"""本地 ONNX embedding provider：隔离运行时时才导入 onnxruntime / tokenizers / numpy。

**为什么导入放在函数体内**：这三个包只存在于按需下载的隔离运行时（``DATA_DIR/rag-runtime``），
backend/.venv 与基础安装包都没有它们。模块顶层 import 会直接打断只用远程 provider 的用户；
这里只在 :func:`rag_runtime_loader.ensure_runtime` 成功之后、函数体内导入（任务书 §2 红线）。

**异步纪律**（任务书要求）：tokenizer 加载、ONNX session 创建与 ``session.run`` 都是阻塞 CPU
调用，全部放进 ``asyncio.to_thread``；模型加载用 ``asyncio.Lock`` 保证每个 provider 实例
只加载一次，另有**模块级缓存**让同一进程里 60 组评测/多次生成复用同一 session（不重复加载
123MB 权重）。加载失败抛可读 :class:`EmbeddingError`，不含完整路径/用户名/密钥。
"""

from __future__ import annotations

import asyncio
import logging
import threading
from pathlib import Path
from typing import Any

from ..rag.rag_runtime_loader import RuntimeUnavailable, ensure_runtime, register_unload_hook
from .embeddings import BaseEmbeddingProvider, EmbeddingBatch, EmbeddingError, EmbeddingModelSpec

logger = logging.getLogger(__name__)

#: 一次 session.run 的批大小（任务书：16~32；取上限减少 session.run 次数）。
BATCH_SIZE = 32
#: 与 scripts/rag_eval_embedding_worker.py 一致的最大序列长度。
MAX_LENGTH = 512

_CACHE_LOCK = threading.Lock()
_MODEL_CACHE: dict[tuple[str, str, int], _LoadedModel] = {}


class _LoadedModel:
    """一个已加载的 tokenizer + ONNX session（跨 provider 实例复用）。"""

    __slots__ = ("dim", "input_names", "pad_id", "pooling", "session", "tokenizer")

    def __init__(
        self,
        *,
        tokenizer: Any,
        session: Any,
        input_names: set[str],
        pooling: str,
        dim: int,
        pad_id: int,
    ) -> None:
        self.tokenizer = tokenizer
        self.session = session
        self.input_names = input_names
        self.pooling = pooling
        self.dim = dim
        self.pad_id = pad_id


def clear_model_cache() -> None:
    """清空 session/tokenizer 缓存（运行时卸载、切换模型或测试用）。"""
    with _CACHE_LOCK:
        _MODEL_CACHE.clear()


# 运行时被 unload_runtime() 卸载时，让缓存里的 session 一起失效，避免指向已删目录。
register_unload_hook(clear_model_cache)


def _cache_key(model_dir: Path, pooling: str, dim: int) -> tuple[str, str, int]:
    try:
        location = str(model_dir.resolve())
    except OSError:
        location = str(model_dir)
    return (location, pooling, dim)


def _load_model(model_dir: Path, pooling: str, dim: int) -> _LoadedModel:
    """同步加载（调用方负责放进 to_thread）：先查进程缓存，再 ensure_runtime + import。"""
    key = _cache_key(model_dir, pooling, dim)
    with _CACHE_LOCK:
        cached = _MODEL_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        ensure_runtime()
    except RuntimeUnavailable as exc:
        raise EmbeddingError(str(exc)) from exc
    # 下面的导入只能发生在 ensure_runtime() 之后（模块 docstring 的硬约束）。
    import onnxruntime as ort  # noqa: PLC0415
    from tokenizers import Tokenizer  # noqa: PLC0415

    tokenizer_path = model_dir / "tokenizer.json"
    if not tokenizer_path.is_file():
        raise EmbeddingError("本地模型文件缺失（tokenizer.json）")
    onnx_files = sorted(path for path in model_dir.glob("*.onnx") if path.is_file())
    if not onnx_files:
        raise EmbeddingError("本地模型文件缺失（ONNX 权重）")
    try:
        tokenizer = Tokenizer.from_file(str(tokenizer_path))
        tokenizer.enable_truncation(max_length=MAX_LENGTH)
        session = ort.InferenceSession(str(onnx_files[0]), providers=["CPUExecutionProvider"])
        input_names = {item.name for item in session.get_inputs()}
    except EmbeddingError:
        raise
    except Exception as exc:  # noqa: BLE001 - 损坏的权重/架构不符都转可读错误
        raise EmbeddingError(f"本地模型加载失败（{type(exc).__name__}）") from exc
    pad_id = tokenizer.token_to_id("[PAD]")
    loaded = _LoadedModel(
        tokenizer=tokenizer,
        session=session,
        input_names=input_names,
        pooling=pooling,
        dim=dim,
        pad_id=pad_id if pad_id is not None else 0,
    )
    with _CACHE_LOCK:
        _MODEL_CACHE[key] = loaded
    return loaded


def _pool(
    sequence: Any, token_count: int, attention_mask: list[int], pooling: str
) -> tuple[float, ...]:
    """把 [seq, hidden] 的模型输出聚合成一条向量（与 spike worker 的池化口径一致）。"""
    if pooling == "cls":
        pooled = sequence[0]
    elif pooling == "last-token":
        pooled = sequence[max(1, token_count) - 1]
    else:  # mean
        total = [0.0] * len(sequence[0])
        count = 0
        for index, keep in enumerate(attention_mask):
            if not keep:
                continue
            row = sequence[index]
            for position in range(len(row)):
                total[position] += float(row[position])
            count += 1
        pooled = [value / max(1, count) for value in total]
    return tuple(float(value) for value in pooled)


def _padded_lists(values: list[list[int]], width: int, pad_value: int) -> list[list[int]]:
    """把一条 batch 的变长 token 列表右填到同一宽度（ONNX batch 输入必须是矩形）。"""
    return [list(item) + [pad_value] * (width - len(item)) for item in values]


def _encode_sync(model: _LoadedModel, texts: list[str]) -> tuple[tuple[float, ...], ...]:
    """同步批量编码（调用方负责放进 to_thread）；**batch 内先右 padding 再 session.run**。

    真实文本长度参差不齐，直接把变长 list-of-list 传给 ONNX 会抛
    "Could not create tensor from given input list"（spike worker 逐条推理所以没暴露，
    产品 warm 路径一次喂 32 条必炸）。padding 位 attention_mask=0，pooling 口径不变。
    """
    vectors: list[tuple[float, ...]] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start : start + BATCH_SIZE]
        encodings = model.tokenizer.encode_batch(batch)
        width = max((len(encoding.ids) for encoding in encodings), default=0)
        feed: dict[str, object] = {
            "input_ids": _padded_lists(
                [encoding.ids for encoding in encodings], width, model.pad_id
            )
        }
        if "attention_mask" in model.input_names:
            feed["attention_mask"] = _padded_lists(
                [encoding.attention_mask for encoding in encodings], width, 0
            )
        if "token_type_ids" in model.input_names:
            feed["token_type_ids"] = _padded_lists(
                [encoding.type_ids for encoding in encodings], width, 0
            )
        try:
            outputs = model.session.run(None, feed)
        except Exception as exc:  # noqa: BLE001 - 推理失败按可读错误回退关键词链
            raise EmbeddingError(f"本地模型推理失败（{type(exc).__name__}）") from exc
        for encoding, sequence in zip(encodings, outputs[0], strict=False):
            vector = _pool(sequence, len(encoding.ids), encoding.attention_mask, model.pooling)
            if len(vector) != model.dim:
                raise EmbeddingError(f"本地模型输出维度与配置不符（{len(vector)} != {model.dim}）")
            vectors.append(vector)
    return tuple(vectors)


class LocalOnnxEmbeddingProvider(BaseEmbeddingProvider):
    """本地 granite ONNX provider（幂等、确定性；与远程共用 BaseEmbeddingProvider 契约）。

    ``model_dir`` 由调用方（工厂层）按 ``rag_runtime_loader.model_dir(variant)`` 传入；
    构造本身不加载模型，首次 ``embed_*`` 时才在后台线程加载并做版本自检。
    """

    def __init__(self, spec: EmbeddingModelSpec, *, model_dir: Path) -> None:
        super().__init__(spec)
        self._model_dir = Path(model_dir)
        self._load_lock = asyncio.Lock()
        self._loaded: _LoadedModel | None = None

    async def _ensure_loaded(self) -> _LoadedModel:
        if self._loaded is not None:
            return self._loaded
        async with self._load_lock:
            if self._loaded is None:
                self._loaded = await asyncio.to_thread(
                    _load_model, self._model_dir, self.spec.pooling, self.spec.dim
                )
            return self._loaded

    async def _embed_prefixed(self, texts: list[str], *, budget: Any = None) -> EmbeddingBatch:
        model = await self._ensure_loaded()
        vectors = await asyncio.to_thread(_encode_sync, model, texts)
        return EmbeddingBatch(vectors, self.spec.model, self.spec.dim, 0)

    def self_check(self) -> int:
        """同步自检（activate_local 用）：加载模型并编码一条短文本，返回实际维度。"""
        model = _load_model(self._model_dir, self.spec.pooling, self.spec.dim)
        vectors = _encode_sync(model, ["语义检索自检"])
        if len(vectors) != 1:
            raise EmbeddingError("本地模型自检失败")
        return len(vectors[0])


__all__ = [
    "BATCH_SIZE",
    "LocalOnnxEmbeddingProvider",
    "MAX_LENGTH",
    "clear_model_cache",
]
