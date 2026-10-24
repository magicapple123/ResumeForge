# SPDX-License-Identifier: Apache-2.0
"""W18 离线对象批注（迁移 0057）。

一张 resume_review_annotation = 收件人回传的一条对象锚定批注。设计要点（wave3 §4）：

- **锚点是对象身份**（object_id/point_id）而不是数组下标：对象被移动/改名后仍能定位；
  找不到时标 stale，**绝不下标回退**（plan §D17）。
- **版本绑定**：snapshot_sha256 记导入时分享包快照指纹，document_version_id 可绑定
  W13 命名版本；版本不再匹配时由导入流程标 stale。
- **去重键** (share_package_id, external_id)：重复导入不覆盖用户已经 resolved/dismissed
  的状态（避免收件人重发把已处理项打回未读）。
- **不进回收站**：用 status=dismissed 表达"不要了"（避免第 18 类回收站噪音，
  wave3 §4.6 已选定单一语义）。
- 批注文本按不可信输入处理：长度上限在导入侧 fail-closed，渲染由前端转义。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 状态机（wave3 §4.3）：open → resolved / dismissed；resolved ↔ open；
# stale 只能 reattach（回 open）或 dismissed。
ANNOTATION_STATUS_OPEN = "open"
ANNOTATION_STATUS_RESOLVED = "resolved"
ANNOTATION_STATUS_STALE = "stale"
ANNOTATION_STATUS_DISMISSED = "dismissed"
ANNOTATION_STATUSES = (
    ANNOTATION_STATUS_OPEN,
    ANNOTATION_STATUS_RESOLVED,
    ANNOTATION_STATUS_STALE,
    ANNOTATION_STATUS_DISMISSED,
)

# 包格式常量（批注包 v1）。
REVIEW_FORMAT_VERSION = 1
REVIEW_KIND = "resumeforge.review"
MAX_ANNOTATIONS_PER_FILE = 500
MAX_ANNOTATION_FILE_BYTES = 512 * 1024
MAX_ANNOTATION_TEXT = 2000
MAX_ANNOTATION_QUOTED = 200
MAX_ANNOTATION_EXTERNAL_ID = 64
MAX_ANNOTATION_REVIEWER = 64


class ResumeReviewAnnotation(Base):
    """一条离线对象批注。"""

    __tablename__ = "resume_review_annotation"
    __table_args__ = (
        UniqueConstraint("share_package_id", "external_id", name="uq_annotation_pkg_external"),
        Index("ix_annotation_resume_status", "resume_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 包/简历被删后批注仍可读（SET NULL），不级联删除收件人的劳动成果。
    share_package_id: Mapped[int | None] = mapped_column(
        ForeignKey("share_package.id", ondelete="SET NULL"), nullable=True
    )
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True
    )
    # W13 命名版本（可选）；NULL = 未绑定版本。
    document_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_version.id", ondelete="SET NULL"), nullable=True
    )
    snapshot_sha256: Mapped[str] = mapped_column(String(64), default="", server_default="")
    external_id: Mapped[str] = mapped_column(String(64), default="")
    object_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    point_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 兼容锚点：旧包/无 id 时用路径；**只作为兜底，不用下标猜关系**。
    path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    field: Mapped[str | None] = mapped_column(String(64), nullable=True)
    quoted_text: Mapped[str] = mapped_column(String(200), default="", server_default="")
    text: Mapped[str] = mapped_column(Text, default="")
    reviewer: Mapped[str] = mapped_column(String(64), default="", server_default="")
    status: Mapped[str] = mapped_column(
        String(16), default=ANNOTATION_STATUS_OPEN, server_default=ANNOTATION_STATUS_OPEN
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


__all__ = [
    "ANNOTATION_STATUSES",
    "ANNOTATION_STATUS_DISMISSED",
    "ANNOTATION_STATUS_OPEN",
    "ANNOTATION_STATUS_RESOLVED",
    "ANNOTATION_STATUS_STALE",
    "MAX_ANNOTATIONS_PER_FILE",
    "MAX_ANNOTATION_EXTERNAL_ID",
    "MAX_ANNOTATION_FILE_BYTES",
    "MAX_ANNOTATION_QUOTED",
    "MAX_ANNOTATION_REVIEWER",
    "MAX_ANNOTATION_TEXT",
    "REVIEW_FORMAT_VERSION",
    "REVIEW_KIND",
    "ResumeReviewAnnotation",
]
