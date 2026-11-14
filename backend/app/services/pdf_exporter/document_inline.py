# SPDX-License-Identifier: Apache-2.0
"""把 ``Inline`` 片段拼回"带标记的纯文本"（PDF 绘制层的投影口）。

为什么还保留 ``**``：PDF 侧统一走 ``parse_rich_runs`` 解析标记，这里只负责把结构化
片段还原成文本协议，不再复制一套"什么算加粗"的判断。已经自带 ``**`` 的片段不重复包裹，
否则会解析出嵌套加粗。
"""

from collections.abc import Sequence

from ...schemas.resume_document_plan import Inline


def inline_text(segments: Sequence[Inline]) -> str:
    parts: list[str] = []
    for segment in segments:
        text = str(segment.text or "")
        if not text:
            continue
        if segment.strong and not text.startswith("**"):
            text = "**" + text + "**"
        parts.append(text)
    return "".join(parts)
