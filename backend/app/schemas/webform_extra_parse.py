# SPDX-License-Identifier: Apache-2.0
"""「网申资料」粘贴识别的请求/响应结构（项 12 / D20 / D21 / D32）。

单独成文件而不是塞进 ``schemas/webform.py``：那份已经接近单文件 500 行预算，而这三张表
只服务一个端点（``POST /api/webform/extra-profile/parse-text``）。``webform.py`` 仍然
re-export 它们，调用方不需要知道搬家这件事。

**只回草稿，不写库**（D20）：用户此刻还没校对，写库等于"点了识别就改了数据"。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .extraction import (
    MAX_EXTRACTION_DOCUMENT_COUNT,
    MAX_EXTRACTION_IMAGE_COUNT,
    MAX_RECOGNIZED_TEXT_CHARS,
    ExtractionDocumentInput,
    ExtractionImageInput,
)


class WebFormExtraProfileParsedItem(BaseModel):
    """一条**目录外**的待确认字段。

    ``key`` 由后端 ``custom_key(label)`` 生成（D32：前端不得自己拼 key）。读取端把 ``label``
    当显示名、**明确不从 key 倒推**（见 ``services/webform/extra_profile.py`` 的注释），
    所以 label 必须与 key 一起回传。
    """

    key: str
    label: str
    value: str


class WebFormExtraProfileParseIn(BaseModel):
    """粘贴文本 +（可选的）截图与文档。三者可同时给。"""

    text: str = Field(default="", max_length=MAX_RECOGNIZED_TEXT_CHARS)
    images: list[ExtractionImageInput] = Field(
        default_factory=list, max_length=MAX_EXTRACTION_IMAGE_COUNT
    )
    documents: list[ExtractionDocumentInput] = Field(
        default_factory=list, max_length=MAX_EXTRACTION_DOCUMENT_COUNT
    )


class WebFormExtraProfileParseOut(BaseModel):
    """草稿：``values`` 可直接填，``custom`` 必须逐条勾选后才填。"""

    values: dict[str, str] = Field(default_factory=dict)
    custom: list[WebFormExtraProfileParsedItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    # ``local`` = 本地规则（没配模型或模型失败）；``ai`` = 模型参与。
    parse_engine: Literal["ai", "local"] = "local"
    # 识别用到的原文（文档文字会并进来），供界面"对照原文核对"。
    recognized_text: str = ""


__all__ = [
    "WebFormExtraProfileParseIn",
    "WebFormExtraProfileParseOut",
    "WebFormExtraProfileParsedItem",
]
