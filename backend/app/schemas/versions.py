# SPDX-License-Identifier: Apache-2.0
"""W13 命名版本 / 岗位变体的接口形状（后端契约；前端消费方 fe-delivery/后续批次）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .resume import ResumeOut
from .resume_writing import ResumeDiffOut

LanguageTag = Literal["", "zh-CN", "en-US"]

MAX_VERSION_NAME = 256
MAX_CHANGE_SUMMARY = 2000
MAX_VARIANTS_PER_SYNC = 50
MAX_PATHS_PER_SYNC = 200


class VersionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_VERSION_NAME)
    change_summary: str = Field(default="", max_length=MAX_CHANGE_SUMMARY)
    # 可选：显式声明这份版本由哪个历史版本派生（只能指向同一简历的版本）。
    parent_version_id: int | None = Field(default=None, ge=1)


class VersionOut(BaseModel):
    id: int
    resume_id: int
    name: str
    change_summary: str = ""
    job_id: int | None = None
    job_title: str = ""
    company: str = ""
    content_sha256: str = ""
    params_sha256: str = ""
    source_revision: int = 0
    parent_version_id: int | None = None
    frozen: bool = False
    source: str = "manual"
    # A5：这份版本生成时的职业场景上下文快照（0061）。NULL = 未记录（旧版本/手写），
    # 读侧原样返回 null，**不按当前场景回填**；页面只做只读说明。
    context_snapshot: dict[str, Any] | None = None
    created_at: datetime | None = None


class VersionDetailOut(VersionOut):
    content: dict[str, Any] = Field(default_factory=dict)
    render_context: dict[str, Any] = Field(default_factory=dict)


class VersionListOut(BaseModel):
    items: list[VersionOut] = Field(default_factory=list)


class LayoutDiffOut(BaseModel):
    """排版上下文的差异：按顶层键报告增/删/改；键值不同的再列在 changed。"""

    added: list[str] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)
    changed: list[str] = Field(default_factory=list)
    equal: bool = True


class VersionCompareOut(BaseModel):
    base_id: int
    against_id: int
    base_name: str = ""
    against_name: str = ""
    # 0 表示"与当前简历比较"（伪 id，便于前端统一处理）。
    content: ResumeDiffOut
    layout: LayoutDiffOut


class VersionFreezeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frozen: bool = True


class VersionRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # 条件写：前端手里那一版过期时 409，不覆盖别人刚存的内容。
    # revision 可以合法为 0（旧记录/从未保存过），所以下界是 0 而不是 1。
    expected_revision: int | None = Field(default=None, ge=0)


class VersionRestoreOut(BaseModel):
    version: VersionOut
    resume: ResumeOut
    revision: int


class VariantCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_VERSION_NAME)
    job_id: int | None = Field(default=None, ge=1)
    # 从哪个命名版本派生；给空则用当前简历内容。
    base_version_id: int | None = Field(default=None, ge=1)
    # W16：语言标签与分组（空串 = 未标注；group 为空 = 独立变体）。
    language: LanguageTag = ""
    variant_group_id: int | None = Field(default=None, ge=1)
    # W16 独立排版覆盖（0060）：null = 继承（与旧版行为一致）。
    layout: dict[str, Any] | None = None


class VariantOut(BaseModel):
    id: int
    resume_id: int
    name: str
    job_id: int | None = None
    job_title: str = ""
    company: str = ""
    content_sha256: str = ""
    base_version_id: int | None = None
    last_synced_version_id: int | None = None
    synced_at: datetime | None = None
    # W16：语言变体字段（旧变体为 ""/None）与独立排版覆盖标记。
    language: str = ""
    variant_group_id: int | None = None
    has_layout: bool = False
    # A5：派生变体继承的生成上下文（命名版本优先，否则当前简历）；NULL = 未记录。
    context_snapshot: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class VariantDetailOut(VariantOut):
    content: dict[str, Any] = Field(default_factory=dict)
    render_context: dict[str, Any] = Field(default_factory=dict)
    # 原始独立排版覆盖；None = 继承（生效排版见 export-input）。
    layout: dict[str, Any] | None = None


class VariantExportInputOut(BaseModel):
    """导出/预览一条变体所需的快照：内容 + 生效排版（W16 唯一入口）。

    ``layout_source``：variant = 变体自己的独立排版；snapshot = 派生时的基底快照；
    resume = 旧变体没有排版快照时按当前简历排版兜底。
    """

    resume_id: int
    variant_id: int
    name: str = ""
    language: str = ""
    content: dict[str, Any] = Field(default_factory=dict)
    layout: dict[str, Any] = Field(default_factory=dict)
    layout_source: Literal["variant", "snapshot", "resume"] = "snapshot"
    content_sha256: str = ""
    variant_updated_at: datetime | None = None


class VariantListOut(BaseModel):
    items: list[VariantOut] = Field(default_factory=list)


class VariantSyncRequest(BaseModel):
    """选择性同步：只有列出的变体 + 列出的路径会被改动，其余内容原样保留。"""

    model_config = ConfigDict(extra="forbid")

    # null = 用当前简历内容作为来源；有值则用该命名版本快照（只能是同一简历的版本）。
    source_version_id: int | None = Field(default=None, ge=1)
    variant_ids: list[int] = Field(min_length=1, max_length=MAX_VARIANTS_PER_SYNC)
    paths: list[str] = Field(min_length=1, max_length=MAX_PATHS_PER_SYNC)


class VariantSyncItemOut(BaseModel):
    variant_id: int
    applied_paths: list[str] = Field(default_factory=list)
    content_sha256: str = ""


class VariantSyncOut(BaseModel):
    source_version_id: int | None = None
    items: list[VariantSyncItemOut] = Field(default_factory=list)


# ===== W16：语言变体的更新 / 翻译候选 / 逐项采纳 =====


class VariantPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=MAX_VERSION_NAME)
    language: LanguageTag | None = None
    variant_group_id: int | None = Field(default=None, ge=1)
    # 显式传 null = 清除独立排版、回到继承；不传 = 不修改（路由用 model_fields_set 区分）。
    layout: dict[str, Any] | None = None


class GlossaryHitOut(BaseModel):
    source: str
    target: str


class TranslateVariantRequest(BaseModel):
    """生成翻译候选：只返回候选与差异，**不写库**；用户逐项采纳才落库。"""

    model_config = ConfigDict(extra="forbid")

    target_language: Literal["zh-CN", "en-US"]
    glossary_locked_only: bool = True


class TranslateVariantOut(BaseModel):
    variant_id: int
    source_language: str
    target_language: str
    candidate: dict[str, Any] = Field(default_factory=dict)
    diff: ResumeDiffOut
    glossary_hits: list[GlossaryHitOut] = Field(default_factory=list)
    # 因术语锁定/事实锁而**保留原文**的路径（用户能看到"这些没翻"）。
    blocked_fields: list[str] = Field(default_factory=list)


class AdoptItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=256)
    text: str = Field(min_length=1, max_length=20_000)


class AdoptTranslationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AdoptItemIn] = Field(min_length=1, max_length=MAX_PATHS_PER_SYNC)


class AdoptTranslationOut(BaseModel):
    variant: VariantDetailOut
    applied_paths: list[str] = Field(default_factory=list)
    content_sha256: str = ""
