# SPDX-License-Identifier: Apache-2.0
"""W12 持久来源与事实锁的接口形状（后端契约，供后续 fe-content 消费）。

约定：

- **未关联 = 没有 link 对象**，不是一种"猜测成功"的状态。旧记录/旧块在 objects 里以
  link=None 出现，界面据此显示「未关联」。
- status 只有两种派生值：linked（来源指纹与关联时一致）与 stale（来源已更新，这个块
  可能受影响，等用户逐条采纳或保持原稿）。它是**算出来的**，不落库。
- 事实锁冲突返回 409 + code=fact_lock_conflict + violations[]；values 是用户自己的
  简历内容，只回给本机界面。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SourceKind = Literal["claim", "material", "job", "profile", "manual", "phrase"]
FactLockKind = Literal[
    "name",
    "institution",
    "time",
    "number",
    "responsibility_boundary",
    # W14 科研字段（事实锁清单扩展，不新增迁移/表）。
    "status",
    "identifier",
    "authorship",
]
LinkStatus = Literal["linked", "stale"]

FACT_LOCK_CONFLICT_CODE = "fact_lock_conflict"


class SourceInput(BaseModel):
    """建立关联时对来源的描述；同 kind + external_ref 复用同一个来源实体。"""

    model_config = ConfigDict(extra="forbid")

    kind: SourceKind
    external_ref: str | None = Field(default=None, max_length=64)
    title: str = Field(default="", max_length=256)
    # 参与内容指纹计算的原始资料（字符串/对象均可）。**不落库全文**，只存摘要与指纹。
    payload: Any = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LinkCreateRequest(BaseModel):
    """把一个目标块（条目或要点）关联到一条来源。"""

    model_config = ConfigDict(extra="forbid")

    source: SourceInput
    object_id: str | None = Field(default=None, max_length=32)
    point_id: str | None = Field(default=None, max_length=32)
    # 旧块可能没有 object_id：允许显式 path；两者都没有则 422。
    path: str | None = Field(default=None, max_length=256)
    field: str | None = Field(default=None, max_length=64)


class SourceRevisionOut(BaseModel):
    revision_no: int
    fingerprint: str
    summary: str = ""
    captured_at: datetime | None = None


class BlockLinkOut(BaseModel):
    link_id: int
    source_id: int
    object_id: str | None = None
    point_id: str | None = None
    path: str
    field: str
    source_fingerprint: str
    status: LinkStatus


class SourceOut(BaseModel):
    id: int
    kind: str
    external_ref: str | None = None
    title: str = ""
    current_fingerprint: str = ""
    latest_revision_no: int = 0
    revisions: list[SourceRevisionOut] = Field(default_factory=list)
    blocks: list[BlockLinkOut] = Field(default_factory=list)


class DocumentObjectOut(BaseModel):
    """简历里的一个可关联目标块；link=None 表示**未关联**（不猜）。"""

    path: str
    field: str
    object_id: str | None = None
    point_id: str | None = None
    label: str = ""
    link: BlockLinkOut | None = None


class ProvenanceCoverage(BaseModel):
    total: int = 0
    linked: int = 0
    unlinked: int = 0


class ResumeProvenanceOut(BaseModel):
    resume_id: int
    revision: int
    sources: list[SourceOut] = Field(default_factory=list)
    objects: list[DocumentObjectOut] = Field(default_factory=list)
    coverage: ProvenanceCoverage = Field(default_factory=ProvenanceCoverage)


class ImpactEntryOut(BaseModel):
    resume_id: int
    resume_title: str = ""
    link_id: int
    source_id: int
    object_id: str | None = None
    point_id: str | None = None
    path: str
    field: str
    linked_fingerprint: str = ""
    current_fingerprint: str = ""
    stale: bool = False
    resume_deleted: bool = False


class SourceImpactOut(BaseModel):
    source_id: int
    kind: str
    title: str = ""
    current_fingerprint: str = ""
    affected: list[ImpactEntryOut] = Field(default_factory=list)
    stale_count: int = 0


class SourceChainOut(BaseModel):
    resume_id: int
    object_id: str | None = None
    point_id: str | None = None
    path: str
    sources: list[SourceOut] = Field(default_factory=list)


class FactLockCreateRequest(BaseModel):
    """锁住简历里某个位置的值；至少给 object_id 或 path。"""

    model_config = ConfigDict(extra="forbid")

    # kind 可省略：服务端按路径识别（W14 科研字段纳入同一份事实锁清单）。
    kind: FactLockKind | None = None
    object_id: str | None = Field(default=None, max_length=32)
    point_id: str | None = Field(default=None, max_length=32)
    path: str | None = Field(default=None, max_length=256)
    label: str = Field(default="", max_length=64)


class FactLockOut(BaseModel):
    id: int
    resume_id: int
    kind: str
    object_id: str | None = None
    point_id: str | None = None
    path: str
    field: str
    locked_value: str
    label: str = ""
    created_at: datetime | None = None


class FactLockListOut(BaseModel):
    resume_id: int
    revision: int
    locks: list[FactLockOut] = Field(default_factory=list)


class FactLockViolationOut(BaseModel):
    lock_id: int
    kind: str
    label: str = ""
    path: str
    field: str
    reason: str
    locked_value: str = ""
    current_value: str = ""


class FactLockConflictOut(BaseModel):
    detail: str = "本次 AI 修改会改动已锁定的事实，已拒绝写入"
    code: str = FACT_LOCK_CONFLICT_CODE
    violations: list[FactLockViolationOut] = Field(default_factory=list)
