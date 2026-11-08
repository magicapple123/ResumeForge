# SPDX-License-Identifier: Apache-2.0
"""助手流的 SSE 帧编码（从 ``api/assistant_persistence.py`` 下沉的公共实现）。

单独一行的模块：SSE 帧格式是**协议线**，任何"把 data: 写成 data :"之类的改动都要在
一处可审；它同时被流编排（``assistant_stream_events``）与收尾路径使用。
"""

from __future__ import annotations

import json
from typing import Any


def format_sse(payload: dict[str, Any]) -> str:
    """把一个事件对象编码成一帧 SSE（``data: <json>`` + 空行结尾）。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


__all__ = ["format_sse"]
