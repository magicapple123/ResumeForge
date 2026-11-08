# SPDX-License-Identifier: Apache-2.0
"""投递交付单的响应 schema（T08）：一张「停在手交线前」的可验收单据。

三态是**单据结论**，不是漏斗状态：``waiting_human``（还有人工步骤没做完，正常终态、
不是失败）/ ``has_doubts``（能验收，但先看疑点）/ ``ready``（一页看完就能确认）。
优先级 ``waiting_human > has_doubts > ready`` 由服务层 ``judge_receipt`` 唯一实现，
schema 只描述形状，不重复判定。

约定：

- ``state`` / ``state_reasons`` / ``human_steps`` 里全是**稳定码**（不是展示文案），
  展示名走前端语言包——可测、不猜，也避免后端把中文写进协议。
- 指纹不同（投出后简历改过）只体现在 ``delivery.resume_changed_since_delivery``，
  **不参与三态**：投完再改简历是常态，算疑点会让单子常年黄灯（计划 §6.2.3）。
- 证据缺失一律如实呈现（``delivery=None`` / ``fill.unknown=True`` /
  ``artifact_sha256=None``），不补造、不反推。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# 三态（与 services/delivery_receipt 的 STATE_* 常量由测试钉成同一份取值）。
ReceiptState = Literal["waiting_human", "has_doubts", "ready"]


class ReceiptDeliveryOut(BaseModel):
    """投递快照（``resume_delivery_record``）的只读投影。

    目的地/标题/指纹都取快照自持列——原简历、岗位、进度被删后单据仍完整可读
    （三条外键都是 ``SET NULL``，见 ADR-0002）。``pages`` / ``export_format`` /
    ``request_params`` / ``artifact_sha256`` 只有导出路径的快照才有值；apply/track
    路径如实为 ``None``/空，不重算、不 live 导出（计划 §6.2.5）。
    """

    track_id: int | None = None
    resume_title: str = ""
    company: str = ""
    job_title: str = ""
    pages: int | None = None
    page_limit: int | None = None
    export_format: str = ""
    request_params: dict | None = None
    content_sha256: str = ""
    artifact_sha256: str | None = None
    created_at: datetime
    # 投出后简历又改过：只展示，不参与三态（计划 §6.2.3）。
    resume_changed_since_delivery: bool = False


class ReceiptFillOut(BaseModel):
    """网申填充记录的旁挂摘要：按 URL 精确匹配（计划 §6.2.2 / §12 决策 2）。

    ``unknown=True`` 表示**匹配不上**（可能是一键投递 / 岗位已删 / 没走网申填表），
    不是"缺件"——不因此把单据判成卡在人手上。
    """

    matched: bool
    unknown: bool
    url: str = ""
    filled_count: int = 0
    total_count: int = 0
    failed_count: int = 0


class ReceiptDoubtsOut(BaseModel):
    """事实台账疑点数（复用 ``resume_risk`` 本地规则里能回指台账条目的风险点）。"""

    count: int = 0


class ReceiptFollowupOut(BaseModel):
    """跟进计划：该进度记录上待办的 hr_reply 提醒。"""

    reminder_id: int
    due_at: datetime


class DeliveryReceiptOut(BaseModel):
    """交付单读视图（``GET /api/apply/records/{record_id}/receipt`` 的响应）。

    ``record_id`` 是 ``apply_task_item.id``（投递记录），不是简历/进度 id。
    """

    record_id: int
    state: ReceiptState
    state_reasons: list[str] = Field(default_factory=list)
    delivery: ReceiptDeliveryOut | None = None
    fill: ReceiptFillOut | None = None
    doubts: ReceiptDoubtsOut = Field(default_factory=ReceiptDoubtsOut)
    human_steps: list[str] = Field(default_factory=list)
    followup: ReceiptFollowupOut | None = None
    receipt_acked_at: datetime | None = None


class ReceiptAckOut(BaseModel):
    """验收（``POST /api/apply/records/{record_id}/receipt/ack``）的响应。

    刻意只回两个字段（CONTRACTS C）：验收单据不等于推进流程，响应里没有 track / status，
    免得调用方误以为这动了漏斗。
    """

    receipt_acked_at: datetime
    acked: bool = True


__all__ = [
    "DeliveryReceiptOut",
    "ReceiptAckOut",
    "ReceiptDeliveryOut",
    "ReceiptDoubtsOut",
    "ReceiptFillOut",
    "ReceiptFollowupOut",
    "ReceiptState",
]
