# SPDX-License-Identifier: Apache-2.0
"""精确预览的进程内结果缓存：同一组输入只排一次 PDF。

**为什么前端缓存不够**：前端那份（`exactPreviewCache`）只覆盖"同一个页面会话里的重复"。
服务端这一份覆盖的是另外三类：

- 「简历制作台」与主预览是两个面板实例，页面刷新后前端缓存就没了；
- 前端因为去抖 / 竞态取消防掉的那次请求，服务端其实已经把 PDF 算完了；
- 用户来回拖同一个滑块（A → B → A），A 那一份刚刚排过。

单份 PDF 约 100–400KB，一次渲染本机实测 ~450ms（其中字体解析 ~310ms）。命中时是
**0ms**——比任何渲染优化都值。

**key 由调用方给**：内容指纹 + 渲染配置指纹（就是响应头里的 `X-Content-Sha256` 与
`X-Render-Config-Sha256` 那两枚）。内容、模板、版式、页数、字号、字体任何一项变了 key
就变，所以这里**不需要失效逻辑**。唯一要显式清理的是"用户字体变更"——那条路径同时会调
`pdf_exporter.reset_font_cache()`，见 `api/fonts.py`。

同步端点跑在 FastAPI 的线程池里，所以读写都要持锁；锁的粒度是"整个缓存"，因为临界区
只是几次字典操作（几十微秒），分片只会增加复杂度。
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from dataclasses import dataclass

# 24 份 ≈ 一轮调参（字号 / 行距 / 页边距各试几次）用得着的全部组合。
MAX_ENTRIES = 24
# 32MB：即使每份 1MB 的"重简历"也放得下 32 份里的前 24 份。
MAX_BYTES = 32 * 1024 * 1024


@dataclass(frozen=True)
class CachedPreviewPdf:
    """一份可以直接回给浏览器的响应：字节 + **完整的响应头**。

    头一起存是刻意的：命中与未命中必须逐字节、逐头一致（`Content-Disposition` 的文件名、
    `X-Content-Sha256` 这些如果重算，两边迟早会漂）。
    """

    content: bytes
    media_type: str
    headers: dict[str, str]


_lock = threading.Lock()
_entries: OrderedDict[str, CachedPreviewPdf] = OrderedDict()
_total_bytes = 0


def get(key: str) -> CachedPreviewPdf | None:
    """命中就返回，并把它标成"最近用过"（LRU 顺序）。"""
    with _lock:
        hit = _entries.get(key)
        if hit is None:
            return None
        _entries.move_to_end(key)
        return hit


def put(key: str, value: CachedPreviewPdf) -> None:
    """存一份（同 key 覆盖），随后按条数 / 总字节淘汰最久未用的。"""
    global _total_bytes
    with _lock:
        previous = _entries.pop(key, None)
        if previous is not None:
            _total_bytes -= len(previous.content)
        _entries[key] = value
        _total_bytes += len(value.content)
        while _entries and (
            len(_entries) > MAX_ENTRIES or (len(_entries) > 1 and _total_bytes > MAX_BYTES)
        ):
            _, dropped = _entries.popitem(last=False)
            _total_bytes -= len(dropped.content)


def clear() -> None:
    """整份清掉：字体变更 / 测试隔离用。"""
    global _total_bytes
    with _lock:
        _entries.clear()
        _total_bytes = 0


def stats() -> tuple[int, int]:
    """(条数, 总字节)：调试与测试断言用。"""
    with _lock:
        return len(_entries), _total_bytes
