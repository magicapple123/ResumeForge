# SPDX-License-Identifier: Apache-2.0
"""RAG 检索的不可变值类型：chunk、身份桥接结果、候选与检索作用域。

本模块只放**纯数据**（frozen dataclass），不依赖任何 rag 子模块、数据库或 LLM：
- `RagChunk`：一条资料条目派生出的最小检索单元。身份（`entry_id` /
  `canonical_item_hash`）必须在 chunk 侧补齐——下游 `build_consumed_data()` 输出的
  候选字典里已经没有 `entry_id`（计划 §3.2）；
- `ChunkingResult`：chunk 列表 + `(section_key, entry_id) ⇄ canonical_item_hash`
  双向桥接表；融合阶段用 hash 找回 boost，再映射回真实条目；
- `RagCandidate`：一路检索（关键词 / 向量 / 融合）产出的候选；`source` 只取
  `RAG_SOURCE_*` 三个值，`score` 由调用方**先定点化再比较**（计划 §3.3）；
- `RagScope`：一次检索的隔离边界（数据集 / 资料组 / workspace revision）。
  `workspace_revision` 只用于诊断与整库失效判断，**不进条目级缓存键**（计划 §4.1）。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

#: `RagCandidate.source` 的三个合法取值。
RAG_SOURCE_KEYWORD = "keyword"
RAG_SOURCE_VECTOR = "vector"
RAG_SOURCE_FUSED = "fused"
RAG_SOURCES: frozenset[str] = frozenset({RAG_SOURCE_KEYWORD, RAG_SOURCE_VECTOR, RAG_SOURCE_FUSED})


@dataclass(frozen=True)
class RagChunk:
    """一条资料条目的检索单元；所有字段都由冻结的消费快照确定性派生。

    `display_text` 用于最终上下文与 embedding，`normalized_text` 用于稳定哈希和重复
    检测，`content_hash` 是规范化文本的 sha256，`canonical_item_hash` 指向**下游候选
    字典**的规范哈希（两者不是一回事，混用会大面积失配，见计划 §3.2）。
    """

    chunk_id: str
    section_key: str
    section_name: str
    entry_id: str
    field_ids: tuple[str, ...]
    display_text: str
    normalized_text: str
    content_hash: str
    canonical_item_hash: str
    section_order: int
    entry_order: int


@dataclass(frozen=True)
class ChunkingResult:
    """一次 chunk 构建的完整产物 + 身份桥接表（两张映射互为逆）。

    同分区内两条条目内容完全相同时 canonical hash 相同：`canonical_by_entry` 仍然
    完整，`entry_by_canonical` 保留先出现的那条（hash 表达内容，不表达 entry 身份）。
    """

    chunks: tuple[RagChunk, ...]
    canonical_by_entry: Mapping[tuple[str, str], str]
    entry_by_canonical: Mapping[str, tuple[str, str]]


@dataclass(frozen=True)
class RagCandidate:
    """一路检索的候选；跨路融合时必须带上 `canonical_item_hash` 才能映射回条目。"""

    chunk_id: str
    section_key: str
    entry_id: str
    canonical_item_hash: str
    score: float
    source: str


@dataclass(frozen=True)
class RagScope:
    """检索作用域：跨数据集 / 资料组绝不混召回。"""

    dataset_id: str
    group_id: str
    workspace_revision: int


__all__ = [
    "RAG_SOURCES",
    "RAG_SOURCE_FUSED",
    "RAG_SOURCE_KEYWORD",
    "RAG_SOURCE_VECTOR",
    "ChunkingResult",
    "RagCandidate",
    "RagChunk",
    "RagScope",
]
