# SPDX-License-Identifier: Apache-2.0
"""#31C 助手记忆（设置页「助手记忆」）的请求/响应结构。

记忆是**用户可见可改**的数据：列表要给来源（可点回对话）与置信度；创建允许手填
（#18D 结构化画像 source=manual）；编辑只允许改内容/键/置信度，kind 与来源不可变。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AssistantMemoryOut(BaseModel):
    """一条记忆的设置页视图（kind_label 是展示名，后端不翻译）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    kind_label: str = ""
    key: str = ""
    value: str
    confidence: float = 0.5
    # active / superseded / deleted（取值见 models/assistant_memory.py）。
    status: str = "active"
    # manual / extracted（#18D 手填与 #31A 自动抽取共用同一模型）。
    source: str = "manual"
    source_conversation_id: int | None = None
    source_message_id: int | None = None
    created_at: datetime
    updated_at: datetime


class AssistantMemoryCreate(BaseModel):
    """手填一条记忆（#18D）。value/kind 由服务层做白名单与敏感信息校验。"""

    kind: str = Field(min_length=1, max_length=32)
    value: str = Field(min_length=1, max_length=200)
    key: str = Field(default="", max_length=128)
    confidence: float | None = Field(default=None, ge=0, le=1)
    # 手填也可以记录"是在哪段对话里想到的"（可空，只用于溯源）。
    conversation_id: int | None = Field(default=None, ge=1)
    message_id: int | None = Field(default=None, ge=1)


class AssistantMemoryUpdate(BaseModel):
    """逐条编辑：只允许改内容/键/置信度（kind 由分类体系固定，不随编辑漂移）。"""

    value: str | None = Field(default=None, min_length=1, max_length=200)
    key: str | None = Field(default=None, max_length=128)
    confidence: float | None = Field(default=None, ge=0, le=1)


class AssistantMemorySettings(BaseModel):
    """自动抽取开关（#31A）。默认关：31C 可见可改之前不自动写入。"""

    auto_extract: bool = False


__all__ = [
    "AssistantMemoryCreate",
    "AssistantMemoryOut",
    "AssistantMemorySettings",
    "AssistantMemoryUpdate",
]
