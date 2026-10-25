# SPDX-License-Identifier: Apache-2.0
"""W13 命名版本与岗位变体（迁移 0055）。

两类对象刻意分开（计划书 P2-01）：

- **命名版本**（resume_version）：某个时刻的**不可变快照**——名称、内容、排版上下文、
  目标岗位、父版本关系、冻结标记。之后怎么改当前简历都不会回头改快照；"已投递/已冻结"
  因此是结构性的，而不是靠某处判断。恢复历史版本 = 用快照内容写出一份**新的当前版本**
  （resume_record.revision +1），不修改任何历史版本行。
- **岗位变体**（resume_variant）：同一份资料面向不同岗位的独立表达。它有自己的当前
  内容与排版上下文（render_context），与母版/当前简历互不影响，只有用户显式"选择性
  同步"时才会被改动指定路径。

W16 会在这张变体表上补 language / variant_group_id 两列（0058）与 layout 独立排版覆盖
（0060），所以本迁移**不预置**它们：一张表只由引入它的迁移建列，扩展列由对应迁移加，
责任链清晰。

数据集隔离结构上成立：每份数据集独立 SQLite 库，表里不存 dataset_id。版本与变体都会
随数据集备份走（表在 Base.metadata 中，清单自动推导）。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 版本的来源：用户手动命名 / 从历史版本恢复 / 导出前自动留档（W19 预留）。
VERSION_SOURCE_MANUAL = "manual"
VERSION_SOURCE_RESTORE = "restore"
VERSION_SOURCES = (VERSION_SOURCE_MANUAL, VERSION_SOURCE_RESTORE)


class ResumeVersion(Base):
    """一条命名版本：不可变的内容+排版快照。"""

    __tablename__ = "resume_version"

    id: Mapped[int] = mapped_column(primary_key=True)
    resume_id: Mapped[int] = mapped_column(
        ForeignKey("resume_record.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(256), default="")
    # 用户可见的"这次改了什么"；为空时接口按与父版本的差异摘要生成（不落库）。
    change_summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    # 目标岗位快照（岗位被删/改名后版本仍可解释清楚）。
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True
    )
    job_title: Mapped[str] = mapped_column(String(128), default="", server_default="")
    company: Mapped[str] = mapped_column(String(128), default="", server_default="")
    # 快照本身的不可变内容：structured content 与渲染上下文（模板/格式/页数/字号/语言）。
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    render_context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}")
    content_sha256: Mapped[str] = mapped_column(String(64), default="", server_default="")
    params_sha256: Mapped[str] = mapped_column(String(64), default="", server_default="")
    # 快照来自第几版当前简历（只作说明，不是外键：resume_record.revision 不是实体）。
    source_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    parent_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_version.id", ondelete="SET NULL"), nullable=True
    )
    # 冻结 = 已投递/已定稿：不会再产生任何修改（本表也没有更新内容的 API）。
    frozen: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    source: Mapped[str] = mapped_column(
        String(16), default=VERSION_SOURCE_MANUAL, server_default=VERSION_SOURCE_MANUAL
    )
    # 这份命名版本生成时的职业场景上下文快照（0061）：与内容一起不可变；NULL = 未记录。
    # 从版本恢复时把内容、排版与上下文一起写成新的当前修订，历史版本本身不动。
    context_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ResumeVariant(Base):
    """一条岗位变体：独立内容 + 独立排版上下文（不与当前简历互相覆盖）。"""

    __tablename__ = "resume_variant"

    id: Mapped[int] = mapped_column(primary_key=True)
    resume_id: Mapped[int] = mapped_column(
        ForeignKey("resume_record.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(256), default="")
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True
    )
    job_title: Mapped[str] = mapped_column(String(128), default="", server_default="")
    company: Mapped[str] = mapped_column(String(128), default="", server_default="")
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    render_context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}")
    # W16 独立排版覆盖（0060）：NULL = 继承（旧变体零影响）；非空 = 这条变体自己的排版
    # 上下文（结构同 layout_snapshot：template/format_name/format_config/page_limit/…）。
    # 与 render_context 的分工：render_context 是派生时的基底快照，layout 是用户显式改过
    # 的独立排版；resolve_variant_export 用 layout 作为导出/预览的生效排版。
    layout: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    content_sha256: Mapped[str] = mapped_column(String(64), default="", server_default="")
    # 派生自哪个命名版本（可选）；null = 从创建时的当前简历派生。
    base_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_version.id", ondelete="SET NULL"), nullable=True
    )
    # 最近一次"选择性同步"用了哪份来源版本、什么时候（UI 能说清"上次同步基于哪版"）。
    last_synced_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_version.id", ondelete="SET NULL"), nullable=True
    )
    synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # W16 语言变体（0058）：空串 = 未标注语言（旧变体），variant_group_id 把同一母版的
    # 多语言变体分组（NULL = 独立变体）。两列 nullable 语义 + server_default，旧数据零影响。
    language: Mapped[str] = mapped_column(String(16), default="", server_default="")
    variant_group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 派生变体继承来源记录/版本的场景上下文快照（0061）；为变体另选场景时新建变体并写
    # 新的来源元数据，不回写旧快照。
    context_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


__all__ = [
    "VERSION_SOURCES",
    "VERSION_SOURCE_MANUAL",
    "VERSION_SOURCE_RESTORE",
    "ResumeVariant",
    "ResumeVersion",
]
