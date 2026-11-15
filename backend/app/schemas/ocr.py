# SPDX-License-Identifier: Apache-2.0
"""OCR 相关的对外数据结构：引擎设置与后台识别任务。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

OcrEngineLiteral = Literal["auto", "ocr", "vision"]


class OcrConfig(BaseModel):
    """扫描件识别引擎（全局设置，跨数据集共用）。

    ``auto`` 是默认值：配置了 DeepSeek Key 就用 OCR，否则保持改造前的视觉模型通路。
    """

    engine: OcrEngineLiteral = "auto"


class OcrEngineOption(BaseModel):
    value: str
    label: str


class OcrSettingsOut(BaseModel):
    """设置页读到的完整状态：档位 + Key 是否已配置 + 三档的可读说明。"""

    engine: OcrEngineLiteral = "auto"
    key_configured: bool = False
    engine_options: list[OcrEngineOption] = Field(default_factory=list)


class OcrTaskCreated(BaseModel):
    """创建后台识别任务后的即时响应：不等识别完成就返回（OCR 最长 180 秒）。"""

    task_id: str
    total_pages: int = 0
    # 服务端不做取消：断开连接不退费、还占着并发名额。前端只能"停止等待"。
    server_cancel_supported: bool = False


class OcrTaskStatus(BaseModel):
    task_id: str
    # running / succeeded / failed
    status: str = "running"
    total_pages: int = 0
    pages_done: int = 0
    elapsed_ms: int = 0
    text: str = ""
    warnings: list[str] = Field(default_factory=list)
    error_code: str = ""
    error_detail: str = ""
    server_cancel_supported: bool = False
