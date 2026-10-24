# SPDX-License-Identifier: Apache-2.0
"""W12 持久来源与事实锁（迁移 0053）。

三个问题分开解决（这也是三组表的原因）：

1. **来源是什么**（`resume_source`）：用户资料库里的可核对对象——事实台账条目、
   资料箱文件、岗位、个人资料块，或用户手工登记的一条外部资料。`external_ref`
   存"哪张业务表的哪一行"（例如 `claim_record:12`），**不建外键**：来源可以是多种
   业务表，硬连任一张都会把另外几种挡在门外；删除来源时也不该级联删掉用户的关联历史。
2. **来源何时变过**（`resume_source_revision`）：每次内容指纹变化追加一版。指纹是
   规范化 JSON 的 SHA-256（不含时间戳），所以"保存了但内容没变"不会制造假修订。
3. **哪份简历的哪个块引用了它**（`resume_block_source`）：块用 W01 的稳定身份
   （`object_id`/`point_id`）+ 当时路径。**没有行 = 未关联**，绝不按文本相似度
   补一条——「旧记录不猜关系」是这项能力的硬约束。

事实锁（`resume_fact_lock`）是另一件事：它锁的是"简历里这个位置上的值不许被 AI
改"，与来源关联无关。锁同时记 `object_id` 与 `path`：有身份时按身份解析（排序
后仍跟得住），只有路径的旧数据按路径比对，两者都不命中即视为"锁定对象已不存在"。

数据集隔离**结构上成立**：每份数据集是一个独立 SQLite 库，本文件不存 dataset_id。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# ===== 来源类型：外部引用前缀必须与这里一一对应 =====
SOURCE_KIND_CLAIM = "claim"
SOURCE_KIND_MATERIAL = "material"
SOURCE_KIND_JOB = "job"
SOURCE_KIND_PROFILE = "profile"
SOURCE_KIND_MANUAL = "manual"
# W17：收藏的表达资产也是简历块的来源（external_ref = resume_phrase:<id>），复用同一套结构。
SOURCE_KIND_PHRASE = "phrase"
SOURCE_KINDS = (
    SOURCE_KIND_CLAIM,
    SOURCE_KIND_MATERIAL,
    SOURCE_KIND_JOB,
    SOURCE_KIND_PROFILE,
    SOURCE_KIND_MANUAL,
    SOURCE_KIND_PHRASE,
)

# ===== 事实锁类型 =====
FACT_LOCK_NAME = "name"
FACT_LOCK_INSTITUTION = "institution"
FACT_LOCK_TIME = "time"
FACT_LOCK_NUMBER = "number"
FACT_LOCK_RESPONSIBILITY = "responsibility_boundary"
# W14 科研字段（事实锁清单扩展）：状态 / 标识符 / 作者顺序。
FACT_LOCK_STATUS = "status"
FACT_LOCK_IDENTIFIER = "identifier"
FACT_LOCK_AUTHORSHIP = "authorship"
FACT_LOCK_KINDS = (
    FACT_LOCK_NAME,
    FACT_LOCK_INSTITUTION,
    FACT_LOCK_TIME,
    FACT_LOCK_NUMBER,
    FACT_LOCK_RESPONSIBILITY,
    FACT_LOCK_STATUS,
    FACT_LOCK_IDENTIFIER,
    FACT_LOCK_AUTHORSHIP,
)


class ResumeSource(Base):
    """一条可核对的来源实体（事实台账/资料/岗位/个人资料/手工登记）。"""

    __tablename__ = "resume_source"
    __table_args__ = (
        # 同一业务行只应该有一个来源实体。external_ref 可空：手工来源允许重复登记，
        # SQLite 里 NULL 互不相等，因此这条唯一约束不会拦住它们。
        UniqueConstraint("kind", "external_ref", name="uq_resume_source_kind_ref"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), default=SOURCE_KIND_MANUAL, index=True)
    # 指向业务表的稳定引用（claim_record:12）；手工来源为空。
    external_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    # 最近一次内容指纹（规范化 JSON 的 SHA-256）；空串表示"还没算过"。
    current_fingerprint: Mapped[str] = mapped_column(String(64), default="", server_default="")
    # 只放展示用摘要（类别/主体/预览文字），不复制完整用户资料。
    metadata_json: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSON, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class ResumeSourceRevision(Base):
    """来源的一次内容修订：指纹变了才追加，修订号只增不减。"""

    __tablename__ = "resume_source_revision"
    __table_args__ = (
        UniqueConstraint("source_id", "revision_no", name="uq_resume_source_revision_no"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("resume_source.id", ondelete="CASCADE"), index=True
    )
    revision_no: Mapped[int] = mapped_column(Integer, default=1)
    fingerprint: Mapped[str] = mapped_column(String(64), default="")
    # 简短说明（例如主体名），供界面列出"来源第 2 版"；不存正文。
    summary: Mapped[str] = mapped_column(String(300), default="", server_default="")
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ResumeBlockSource(Base):
    """简历里某个块 → 来源实体的显式关联（用户建立，绝不自动猜）。"""

    __tablename__ = "resume_block_source"

    id: Mapped[int] = mapped_column(primary_key=True)
    resume_id: Mapped[int] = mapped_column(
        ForeignKey("resume_record.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[int] = mapped_column(
        ForeignKey("resume_source.id", ondelete="CASCADE"), index=True
    )
    # 关联建立时对应的来源修订；来源被清理时置空，但关联本身保留（历史可解释）。
    source_revision_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_source_revision.id", ondelete="SET NULL"), nullable=True
    )
    # W01 稳定身份；旧数据可能只有 path（"这是明确退化，不猜"）。
    object_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    point_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    path: Mapped[str] = mapped_column(String(256), default="")
    field: Mapped[str] = mapped_column(String(64), default="")
    # 建立关联时的来源指纹：与来源当前指纹不同 = "来源已更新，这个块可能受影响"。
    source_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class ResumeFactLock(Base):
    """一条事实锁：简历某个位置的值（姓名/机构/时间/数字/职责边界）AI 不得改动。"""

    __tablename__ = "resume_fact_lock"

    id: Mapped[int] = mapped_column(primary_key=True)
    resume_id: Mapped[int] = mapped_column(
        ForeignKey("resume_record.id", ondelete="CASCADE"), index=True
    )
    object_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    point_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    path: Mapped[str] = mapped_column(String(256), default="")
    # 对象身份解析到条目/要点后的**相对字段路径**（例如 company）。有它才能让
    # "锁住实习条目的公司名"在条目排序后仍跟住同一条目，而不是退回旧下标。
    relative_path: Mapped[str] = mapped_column(String(64), default="", server_default="")
    field: Mapped[str] = mapped_column(String(64), default="")
    lock_kind: Mapped[str] = mapped_column(String(32), default=FACT_LOCK_NAME, index=True)
    # 锁定时的值（用户自己的简历内容，同一份库内已有同等敏感度）；用于比对与解释差异。
    locked_value: Mapped[str] = mapped_column(Text, default="")
    label: Mapped[str] = mapped_column(String(64), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


__all__ = [
    "FACT_LOCK_INSTITUTION",
    "FACT_LOCK_KINDS",
    "FACT_LOCK_NAME",
    "FACT_LOCK_NUMBER",
    "FACT_LOCK_RESPONSIBILITY",
    "FACT_LOCK_AUTHORSHIP",
    "FACT_LOCK_IDENTIFIER",
    "FACT_LOCK_STATUS",
    "FACT_LOCK_TIME",
    "SOURCE_KINDS",
    "SOURCE_KIND_CLAIM",
    "SOURCE_KIND_JOB",
    "SOURCE_KIND_MANUAL",
    "SOURCE_KIND_MATERIAL",
    "SOURCE_KIND_PHRASE",
    "SOURCE_KIND_PROFILE",
    "ResumeBlockSource",
    "ResumeFactLock",
    "ResumeSource",
    "ResumeSourceRevision",
]
