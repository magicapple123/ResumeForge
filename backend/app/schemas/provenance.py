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
    # revision 行 id：采纳/关联到"某一版"时需要它（只读展示可忽略）。
    id: int | None = None
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


class UnresolvedLinkOut(BaseModel):
    """一条无法在当前正文里定位的旧关联（P5-2）。

    只读暴露：**不迁移、不改写、不按同下标猜目标**。用户据此前去删除或重新关联；
    旧客户端忽略这个只增字段即可（默认空列表）。
    """

    link_id: int
    source_id: int
    source_title: str = ""
    source_kind: str = ""
    object_id: str | None = None
    point_id: str | None = None
    path: str = ""
    field: str = ""
    # 稳定原因码：object_id_invalid / no_locator / target_missing。
    reason: str = ""


class ResumeProvenanceOut(BaseModel):
    resume_id: int
    revision: int
    sources: list[SourceOut] = Field(default_factory=list)
    objects: list[DocumentObjectOut] = Field(default_factory=list)
    # P5-2 只增字段：当前正文里定位不到的旧关联（旧客户端忽略即可）。
    unresolved_links: list[UnresolvedLinkOut] = Field(default_factory=list)
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
    detail: str = "本次修改会改动已锁定的事实或正文，已拒绝写入"
    code: str = FACT_LOCK_CONFLICT_CODE
    violations: list[FactLockViolationOut] = Field(default_factory=list)

# ===== W12 可达性补充：已有来源的列表 / 手工登记 / 修订列表 / 关联 / 采纳 =====


class SourceSummaryOut(BaseModel):
    """来源列表项：只给展示元信息（含 metadata 摘要），**不返回正文**。"""

    id: int
    kind: str
    external_ref: str | None = None
    title: str = ""
    current_fingerprint: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    latest_revision_no: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SourceListOut(BaseModel):
    items: list[SourceSummaryOut] = Field(default_factory=list)
    # 过滤后的总数（limit 只影响 items）。
    total: int = 0


class ManualSourceCreateRequest(BaseModel):
    """手工登记一条外部资料。

    兼容性红线（P5-1）：只传 title 的旧请求**行为逐字节不变**——kind 仍是 manual、
    external_ref 仍是 None、payload 仍按 {"title": title} 参与指纹，所以历史关联不会
    因为这次扩展集体变 stale。

    - 给 external_ref 时按 (kind, external_ref) 复用同一条来源（与内联关联共用同一套
      upsert_source 语义）；不给 external_ref 时仍是每次新建。
    - payload 只参与内容指纹与摘要，**不落全文**（来源表只存 summary/指纹）；
      类型与长度由路由校验（非法值 400），不放进 pydantic 的 422 校验里，
      这样历史调用方看到的错误码不会因扩展而漂移。
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=256)
    # 默认 manual：旧请求不带 kind 时语义不变；显式传其它类型表示用户自己登记的外部资料。
    kind: SourceKind = "manual"
    external_ref: str | None = Field(default=None, max_length=64)
    # 原文摘要（可选）：只参与指纹/摘要，不落库全文。路由按 _MANUAL_PAYLOAD_MAX_CHARS 校验。
    payload: Any = None


class SourceRevisionItemOut(BaseModel):
    id: int
    revision_no: int
    summary: str = ""
    captured_at: datetime | None = None


class ManualSourceOut(BaseModel):
    id: int
    kind: str
    # 可选回显（P5-1 只增字段）：带 external_ref 新建/复用时前端能直接核对来源身份。
    external_ref: str | None = None
    title: str
    revision: SourceRevisionItemOut


class SourceRevisionsOut(BaseModel):
    source_id: int
    revisions: list[SourceRevisionItemOut] = Field(default_factory=list)


class SourceRevisionTextOut(BaseModel):
    """来源修订的只读原文解析（不落库、不写日志；供采纳前预填文本）。

    - resolvable=True：text 是业务表里的当前正文，fingerprint 是所选修订的真实指纹；
      fingerprint_matched 说明这段正文是否就是算指纹用的那份（false 时前端应提示
      "原文与建立关联时的指纹不一致，请核对"）。
    - resolvable=False：reason 是稳定码（manual_source_has_no_body /
      external_ref_unresolvable / source_body_not_found / source_body_too_large /
      historical_revision_not_stored / no_revision），此时 text 为空。
    - is_latest=False（历史修订）时正文无法回溯，如实返回 unresolvable。
    """

    source_id: int
    kind: str = ""
    external_ref: str | None = None
    revision_no: int | None = None
    text: str = ""
    fingerprint: str = ""
    resolvable: bool = False
    fingerprint_matched: bool = False
    is_latest: bool = False
    reason: str = ""


class LinkFromSourceRequest(BaseModel):
    """把**已有的**来源（及可选修订）关联到简历块（W12 可达性：来源面板挑选已有来源）。"""

    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(ge=1)
    source_id: int = Field(ge=1)
    # 不给 = 关联来源的最新修订；给了必须是这条来源的修订。
    source_revision_id: int | None = Field(default=None, ge=1)
    object_id: str | None = Field(default=None, max_length=32)
    point_id: str | None = Field(default=None, max_length=32)
    path: str | None = Field(default=None, max_length=256)
    field: str | None = Field(default=None, max_length=64)


class LinkAdoptRequest(BaseModel):
    """来源更新 → 采纳写正文。

    text 是用户确认过的来源修订文本（来源表只存 summary/指纹，不存正文；前端从来源详情
    取得后由用户确认再提交）。source_revision_id 不给 = 与来源最新修订比对指纹。
    """

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=20_000)
    # 条件写：手里那一版过期 → 409 resume_revision_conflict，一个字节都不写。
    expected_revision: int | None = Field(default=None, ge=0)
    source_revision_id: int | None = Field(default=None, ge=1)
    # 条目级关联必填（如 experience.0.description.0）；point 级可省略。
    path: str | None = Field(default=None, max_length=256)


class LinkAdoptOut(BaseModel):
    resume_id: int
    revision: int
    content: dict[str, Any] = Field(default_factory=dict)
    applied_path: str
    source_revision_no: int = 0
    link: BlockLinkOut
