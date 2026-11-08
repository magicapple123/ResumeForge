# SPDX-License-Identifier: Apache-2.0
"""按 entry 粒度的有界进程内向量缓存（计划 §4.1 / §4.2）。

**缓存键**（逐项来自计划，顺序无关但内容必须全含）::

    (dataset_id, group_id, entry_id, model, dim, pooling, prefix, content_hash)

**workspace_revision 刻意不进键**：它是整份资料组的整体版本号，一旦进键，用户改一个字
就会让全部向量失效，按 §2.2 的量级等于每次编辑后首次生成都全量重编码。它只作为诊断
字段与"整库重建"的旁路判断存在（见 `rag_observability` 的日志字段）。

**失效粒度 = 一条**：内容变化时 `content_hash` 变化 → 该条目 key 不同 → 只有这一条
缓存未命中；其余条目的 key 不变，继续命中。因此不需要逐条失效 API，旧向量会随 LRU
淘汰自然消失。

**边界**：向量索引是**可重建派生数据**——进程内有上限、不写业务库、不进备份；
重启后允许重算。真实 embedding 不可用时调用方直接回退关键词链，本模块不参与降级决策。
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from dataclasses import dataclass

from ..llm.embeddings import EmbeddingModelSpec

#: 进程内缓存上限（条）。语料上限由 SECTION_LIMITS 硬约束（最坏约 320 条/份），
#: 4096 条足够覆盖多份资料组轮换，又不会让长期挂机的进程无限增长。
DEFAULT_MAX_ENTRIES = 4096


@dataclass(frozen=True)
class RagIndexKey:
    """一条向量缓存的全部身份。`prefix` 已把 query/doc 前缀与归一化声明合并。"""

    dataset_id: str
    group_id: str
    entry_id: str
    model: str
    dim: int
    pooling: str
    prefix: str
    content_hash: str


@dataclass(frozen=True)
class RagIndexStats:
    """诊断计数（只进日志/测试，不含任何资料内容）。"""

    size: int
    hits: int
    misses: int
    puts: int
    evictions: int


def index_prefix(spec: EmbeddingModelSpec) -> str:
    """模型侧参与缓存键的声明：两份前缀 + 是否归一化（三者任一变化 = 新索引）。"""
    raw = f"{spec.query_prefix}\x1f{spec.doc_prefix}\x1f{int(bool(spec.normalize))}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def build_index_key(
    spec: EmbeddingModelSpec,
    *,
    dataset_id: str,
    group_id: str,
    entry_id: str,
    content_hash: str,
) -> RagIndexKey:
    return RagIndexKey(
        dataset_id=str(dataset_id),
        group_id=str(group_id),
        entry_id=str(entry_id),
        model=spec.model,
        dim=int(spec.dim),
        pooling=str(spec.pooling),
        prefix=index_prefix(spec),
        content_hash=str(content_hash),
    )


class RagIndex:
    """有界 LRU 向量缓存（线程安全：生成请求可能来自多个工作线程）。"""

    def __init__(self, max_entries: int = DEFAULT_MAX_ENTRIES) -> None:
        if max_entries < 1:
            raise ValueError("向量缓存上限必须 >= 1")
        self._max_entries = int(max_entries)
        self._data: OrderedDict[RagIndexKey, tuple[float, ...]] = OrderedDict()
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0
        self._puts = 0
        self._evictions = 0

    def get(self, key: RagIndexKey) -> tuple[float, ...] | None:
        with self._lock:
            vector = self._data.get(key)
            if vector is None:
                self._misses += 1
                return None
            self._hits += 1
            self._data.move_to_end(key)
            return vector

    def put(self, key: RagIndexKey, vector: tuple[float, ...] | list[float]) -> None:
        values = tuple(float(value) for value in vector)
        if len(values) != key.dim:
            raise ValueError(f"向量维度不符：期望 {key.dim}，实际 {len(values)}")
        with self._lock:
            self._data[key] = values
            self._data.move_to_end(key)
            self._puts += 1
            while len(self._data) > self._max_entries:
                self._data.popitem(last=False)
                self._evictions += 1

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def stats(self) -> RagIndexStats:
        with self._lock:
            return RagIndexStats(
                size=len(self._data),
                hits=self._hits,
                misses=self._misses,
                puts=self._puts,
                evictions=self._evictions,
            )


_GLOBAL_INDEX = RagIndex()


def get_rag_index() -> RagIndex:
    """进程级唯一索引（生产路径）；测试用 `reset_rag_index` 隔离。"""
    return _GLOBAL_INDEX


def reset_rag_index(max_entries: int = DEFAULT_MAX_ENTRIES) -> RagIndex:
    global _GLOBAL_INDEX
    _GLOBAL_INDEX = RagIndex(max_entries=max_entries)
    return _GLOBAL_INDEX


__all__ = [
    "DEFAULT_MAX_ENTRIES",
    "RagIndex",
    "RagIndexKey",
    "RagIndexStats",
    "build_index_key",
    "get_rag_index",
    "index_prefix",
    "reset_rag_index",
]
