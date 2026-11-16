# SPDX-License-Identifier: Apache-2.0
"""拼音 + 数字自然序的排序键（F）——兼容壳，实现已下沉到 ``app/runtime``。

真源是 :mod:`app.runtime.text_sort_impl`：``app/database.py`` 要在建连接时给每个
SQLite 连接注册 ``rf_pinyin`` collation，而 database 属于最底层基础设施，反向依赖
``app/services`` 是一条不该有的架构回边。排序键本身是纯函数、无 IO、不依赖任何业务
概念，放在 ``runtime/`` 才是它该在的层。

本模块保留为**再导出壳**：``from app.services.text_sort import compare_text, sort_key``
一类既有导入路径（测试与排序工具）继续可用，且拿到的是同一个函数对象——``lru_cache``
的缓存与 ``cache_clear()`` 因此仍然共享，不会出现"两套缓存"。
"""

from __future__ import annotations

from ..runtime.text_sort_impl import compare_text as compare_text
from ..runtime.text_sort_impl import sort_key as sort_key

__all__ = ["compare_text", "sort_key"]
