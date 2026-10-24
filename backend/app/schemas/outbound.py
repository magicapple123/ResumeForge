# SPDX-License-Identifier: Apache-2.0
"""R04 外发前预览的接口形状。

预览回答"这次要把什么发出去"：目标服务、资料类别、附件类型、已排除字段、是否抓取
网页正文，以及**将要发送的正文本身**。正文只随响应回到本机界面（内存），不落库、
不写日志、不进 localStorage（前端契约）。

服务端在此**只做展示与体检**：不替换正文（预览必须与实际发送一致），但会标记
疑似密钥泄露（secret_leak_detected），让上层在真正外发前有据可查。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# 预览正文与服务端"回显"上限：够看清整段外发内容，又不会把一个 8MB 的粘贴文本
# 原样搬进响应/内存两次。
MAX_PREVIEW_BODY_CHARS = 60_000


class OutboundPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_service: str = Field(min_length=1, max_length=64)
    material_categories: list[str] = Field(default_factory=list, max_length=20)
    attachment_types: list[str] = Field(default_factory=list, max_length=20)
    excluded_fields: list[str] = Field(default_factory=list, max_length=50)
    fetch_pages: bool = False
    # 将要外发到目标服务的正文（把用户资料/岗位描述拼进去之后的最终文本）。
    body: str = Field(default="", max_length=MAX_PREVIEW_BODY_CHARS * 4)


class OutboundPreviewOut(BaseModel):
    target_service: str
    material_categories: list[str] = Field(default_factory=list)
    attachment_types: list[str] = Field(default_factory=list)
    excluded_fields: list[str] = Field(default_factory=list)
    fetch_pages: bool = False
    body_preview: str = ""
    body_chars: int = 0
    body_truncated: bool = False
    body_sha256: str = ""
    secret_leak_detected: bool = False
    # 结构性承诺：正文只存在于本次响应（内存），不落库、不写日志。
    persistence: Literal["memory_only"] = "memory_only"
