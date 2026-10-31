# SPDX-License-Identifier: Apache-2.0
"""A5：按职业场景派生已有简历变体的请求/响应形状。

流程（计划 §12 A5）：

1. POST /{resume_id}/scenario-variants：**先派生独立变体**（内容/排版从当前简历
   或指定命名版本复制，context_snapshot 由服务端 resolver 冻结）；源简历零写入。
2. POST /{resume_id}/variants/{variant_id}/scenario-preview：用**受控修订服务**
   按场景表达指南生成候选内容，返回候选与两份哈希（原有内容 / 本次采用的场景），
   **不落库**——用户先看差异。
3. POST /{resume_id}/variants/{variant_id}/scenario-adopt：用户确认后把候选写进
   **这条变体**（条件写：变体内容指纹 + 场景上下文哈希都必须仍是预览时的那一份），
   源简历不动。

边界：请求只传场景**引用**（scenario_id/expected_revision 或 preset_key/catalog_version）
与用户指令；禁止上传快照本体、系统指南或哈希作为信任来源——快照与哈希一律服务端解析。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .generation_context import CareerContextRequest
from .resume_generation import MAX_CUSTOM_INSTRUCTION_CHARS
from .resume_writing import ResumeDiffOut
from .versions import VariantOut

MAX_SCENARIO_VARIANT_NAME = 256
SHA256_LENGTH = 64


class ScenarioVariantCreateRequest(BaseModel):
    """派生一条场景变体：名称 + 显式场景引用（+ 可选命名版本作为基底）。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_SCENARIO_VARIANT_NAME)
    career_context: CareerContextRequest
    base_version_id: int | None = Field(default=None, ge=1)


class ScenarioVariantPreviewRequest(BaseModel):
    """生成场景变体候选（不落库）。instructions 为空 = 按场景表达偏好整体改写表达。"""

    model_config = ConfigDict(extra="forbid")

    career_context: CareerContextRequest
    instructions: str = Field(default="", max_length=MAX_CUSTOM_INSTRUCTION_CHARS)


class ScenarioVariantPreviewOut(BaseModel):
    """候选内容与预检哈希；采纳时回传两个哈希做条件写。"""

    variant: VariantOut
    candidate_content: dict[str, Any]
    # 预览时这条变体的内容指纹；采纳请求必须原样带回（变体在别处被改过 → 409）。
    base_content_sha256: str
    candidate_content_sha256: str
    # 本次解析出的场景快照（只读展示用了什么场景；采纳时用哈希校验场景未变）。
    context_snapshot: dict[str, Any]
    context_sha256: str
    # 复用唯一的三态差异实现（与版本对比同源），前端直接渲染，不另算一套 diff。
    content_diff: ResumeDiffOut


class ScenarioVariantAdoptRequest(BaseModel):
    """采纳候选：内容整份写入变体（条件写），场景引用用于校验上下文未变。"""

    model_config = ConfigDict(extra="forbid")

    # v2 文档 JSON（兼容旧 v1：采纳路由统一 ensure_document_version 后落库）。
    content: dict
    expected_content_sha256: str = Field(min_length=SHA256_LENGTH, max_length=SHA256_LENGTH)
    expected_context_sha256: str = Field(min_length=SHA256_LENGTH, max_length=SHA256_LENGTH)
    career_context: CareerContextRequest


__all__ = [
    "MAX_SCENARIO_VARIANT_NAME",
    "ScenarioVariantAdoptRequest",
    "ScenarioVariantCreateRequest",
    "ScenarioVariantPreviewOut",
    "ScenarioVariantPreviewRequest",
]
