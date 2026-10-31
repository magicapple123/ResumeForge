# SPDX-License-Identifier: Apache-2.0
"""v2 文档测试助手的兼容入口（实现以 tests/document_test_support.py 为唯一来源）。

为什么有两层：backend-tests 的 document_test_support.py 是断言口径的唯一实现；
本文件只做**兼容 re-export**，保留计划里约定的名字（doc_of / item_by_key / values /
texts / walk_items）与少量别名，避免两份选取器各写一套以后漂移。

导入约定：两种方式都支持——
- from tests.document_helpers import values（namespace package 方式）；
- from document_helpers import values（pytest 把 tests 目录放进 sys.path 时）。
"""

from __future__ import annotations

from typing import Any

try:  # 作为 tests 包成员导入
    from .document_test_support import *  # noqa: F401,F403
    from .document_test_support import __all__ as _support_all
except ImportError:  # pragma: no cover - pytest 直接按文件名导入时
    from document_test_support import *  # noqa: F401,F403
    from document_test_support import __all__ as _support_all


def texts(content: Any) -> list[str]:
    """文档里全部**未隐藏**文本值（与 document_test_support.values 同一口径）。"""
    return values(content)  # noqa: F405 - 来自 import *


def walk_sections(content: Any) -> list[dict]:
    """全部板块（按文档顺序）。"""
    return list(as_document(content).get("sections") or [])  # noqa: F405


__all__ = [*_support_all, "texts", "walk_sections"]
