# SPDX-License-Identifier: Apache-2.0
"""搜索结果的进程内 TTL 缓存（P4-05）。

## 为什么值得缓存

DeepSeek 搜索按次计费，Bing/DDG 会被限流；而"同一句问话连问两次"在实际使用里非常常见
（模型换了措辞重试、用户点了两次、一次回答里两个工具调用问了同一件事）。命中缓存等于
省掉一次网络 + 一次计费。

## 边界（写清楚，免得被当成"结果永不更新"）

- **进程内、内存里**：不落盘、不进备份、不进数据集；进程重启即清空。
- 键 = ``normalized_query + sorted(sources) + depth``：来源顺序不影响命中（并发查询本来
  就没有顺序语义），但"改了来源集合"必须换键，否则会拿到另一套来源拼出来的结果。
- TTL 5–10 分钟（取 8 分钟）：再长就会出现"明明刚发布的新岗位搜不到"的错觉。
- 只缓存**成功**结果：失败不缓存，否则一次临时故障会在 TTL 内被反复复述。
- 时钟可注入（``clock`` 参数）：测试用假时钟推进过期，不 sleep。
"""

from __future__ import annotations

import copy
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Sequence
from typing import Any

#: 默认 TTL：8 分钟（题面给的 5–10 分钟区间取中）。
DEFAULT_TTL_SECONDS = 8 * 60
#: 条目上限：每条结果几十 KB，64 条已经远超一次会话的真实使用量。
DEFAULT_MAX_ENTRIES = 64


def normalize_query(query: str) -> str:
    """缓存键里的查询归一：折叠空白 + casefold（"后端 招聘" 与 "后端  招聘" 同一条）。"""
    return " ".join(str(query or "").split()).casefold()


def cache_key(query: str, sources: Sequence[str], depth: str, limit: int | None = None) -> str:
    """``normalized_query|sorted(sources)|depth|limit``。

    ``limit`` 必须进键：模型调 ``web_search`` 时可以传更少的条数，``limit=3`` 与
    ``limit=8`` 的结果集不一样，共用一条缓存会让第二次调用拿到更长的列表
    （"设置上限 8 却返回 8 条"正是这样被踩到的）。
    """
    ordered = ",".join(sorted({str(item) for item in sources if item}))
    return f"{normalize_query(query)}|{ordered}|{depth}|{'' if limit is None else int(limit)}"


class SearchCache:
    """带 TTL 的 LRU 缓存（线程安全：uvicorn 的同步路由与事件循环都可能碰它）。"""

    def __init__(
        self,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_seconds
        self._max = max(1, max_entries)
        self._clock = clock
        self._data: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        """取一条未过期的副本；过期即删并返回 None（惰性清理）。"""
        now = self._clock()
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            stored_at, value = entry
            if now - stored_at > self._ttl:
                del self._data[key]
                return None
            self._data.move_to_end(key)
            return copy.deepcopy(value)

    def set(self, key: str, value: Any) -> None:
        """写入一条（深拷贝，防止调用方后续修改污染缓存）；超额时淘汰最久未用。"""
        with self._lock:
            self._data[key] = (self._clock(), copy.deepcopy(value))
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)


#: 进程内唯一实例。放在模块级（而不是 `aggregate` 里）是为了让测试能直接清空它：
#: 缓存是跨用例共享的全局状态，不清理会让「上一个用例的结果串进下一个用例」。
search_cache = SearchCache()


def reset_search_cache() -> None:
    """清空进程内缓存（测试与"设置改了，立刻重新搜"用）。"""
    search_cache.clear()


__all__ = [
    "DEFAULT_MAX_ENTRIES",
    "DEFAULT_TTL_SECONDS",
    "SearchCache",
    "cache_key",
    "normalize_query",
    "reset_search_cache",
    "search_cache",
]
