# SPDX-License-Identifier: Apache-2.0
"""「模型窗口参考」列表的响应结构（只读，不下发密钥/配置细节）。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ModelWindowEntry(BaseModel):
    """表里的一条：型号名、窗口大小、官方文档。"""

    label: str = Field(description="给人看的型号名（可含多个同窗口的型号）")
    tokens: int = Field(ge=1, description="上下文窗口（token）")
    reference: str = Field(description="官方文档链接，供核对")


class CurrentModelWindow(BaseModel):
    """当前生效模型解析出来的窗口；`label` 为空表示表里没有、按保守值估算。"""

    model: str = ""
    label: str | None = None
    tokens: int = Field(ge=1)
    source: Literal["manual", "reference", "fallback"]


class ModelWindowReferenceOut(BaseModel):
    """整张表 + 当前模型的位置。"""

    default_tokens: int = Field(ge=1, description="表里没有的型号使用的保守值")
    entries: list[ModelWindowEntry]
    current: CurrentModelWindow
