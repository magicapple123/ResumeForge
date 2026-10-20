# SPDX-License-Identifier: Apache-2.0
"""投递快照记录（RF-17）：一份简历在投递/导出那一刻的不可变证据。

为什么单独一张表：简历记录（``resume_record``）保持**原地更新**语义（PUT/revise
直接改 ``content``），投递之后用户再润色，改的是正经历程里的"当前版"——而当时
真的投出去的是什么，只能靠这份冻结快照回答。所有岗位/公司/标题字段都是**冗余快照**，
外键全部 ``SET NULL``：岗位、简历、投递记录被删（含回收站彻底清除）后证据仍可读。

刻意**不设 ``deleted_at``**：证据不可删、不进回收站、不参与任何删除链路，
``tests/test_trash.py::test_every_deleted_at_table_is_registered`` 会钉住这一点。

监控点：``content`` 快照含照片 base64，单条体积大。当前是本地单用户 SQLite，
量级可控、接受；将来数据量上来后再考虑照片置空降级，不在本批做。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# source 取值：这条快照是哪条路径冻结的。
DELIVERY_SOURCE_APPLY = "apply"  # 投递台成功回写（task_apply → record_applied）
DELIVERY_SOURCE_TRACK = "track"  # 手工/表单把进度记录显式关联到一份简历
DELIVERY_SOURCE_EXPORT = "export"  # 导出时显式要求落交付快照（?record_delivery=true）
DELIVERY_SOURCES = (DELIVERY_SOURCE_APPLY, DELIVERY_SOURCE_TRACK, DELIVERY_SOURCE_EXPORT)


class ResumeDeliveryRecord(Base):
    """一次投递/显式关联/导出的冻结快照：内容、渲染配置与双指纹。"""

    __tablename__ = "resume_delivery_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 三条外键全部 SET NULL：被引用行删除后，本表的冗余快照列仍完整可读。
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True, index=True
    )
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True, index=True
    )
    track_id: Mapped[int | None] = mapped_column(
        ForeignKey("application_track.id", ondelete="SET NULL"), nullable=True
    )
    # apply / track / export（取值见模块顶部常量）。
    source: Mapped[str] = mapped_column(String(16), default=DELIVERY_SOURCE_APPLY, nullable=False)
    # 快照列：投出去时的公司/岗位/简历标题，与外键解耦。
    resume_title: Mapped[str] = mapped_column(String(256), default="")
    job_title: Mapped[str] = mapped_column(String(128), default="")
    company: Mapped[str] = mapped_column(String(128), default="")
    # 冻结的结构化简历正文（ResumeContent dump，含照片 base64——见模块 docstring 监控点）。
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # 重导出确定性最小集：template/template_html/style_config/format_config/page_limit/
    # font_scale。凭这份上下文可以按当时的版式重新渲染出同一份简历。
    render_context: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # 双指纹：内容指纹（apply/track 路径对规范化 JSON 的 sha256；export 路径与
    # ExportDelivery 一致，即导出产物字节的 sha256）+ 渲染配置指纹
    # （render_config_fingerprint 的同口径产物）。
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    rendered_config_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # 导出路径才有：格式、文件名与实际页数；apply/track 路径留默认空值。
    export_format: Mapped[str] = mapped_column(String(16), default="")
    filename: Mapped[str] = mapped_column(String(256), default="")
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 生成该简历的模型（从 resume_record.model 冗余），便于回答"当时用什么生成的"。
    model: Mapped[str] = mapped_column(String(64), default="")

    # ===== 可信交付账本（0045，全部可空：旧行/旧备份 NULL = 不可还原，不编造）=====

    # 导出前源内容的 sha256（脱敏导出 = 脱敏后内容的规范化哈希；apply/track 路径 =
    # 冻结内容本身的规范化哈希，与 content_sha256 同值）。与 artifact_sha256 分开，
    # 回答"存档里是哪份内容"，而不是把它和"产出的文件是哪份"混为一谈。
    source_content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 导出产物字节的 sha256：仅 export 路径有值（apply/track 没有产物）。
    # 注意：它是**当初那次导出**的指纹，重放不一定逐字节复现（HTML 的 CSP nonce
    # 每次不同），所以下载响应头用 X-Artifact-Sha256 报它，X-Content-Sha256 报
    # 本次真实字节（ADR-0002 §4.1，RR-04）。
    artifact_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 实际生效的导出请求参数（page_limit/watermark/redact/redact_options/margin_mm/
    # font_scale/include_photo，覆盖值已按生效规则折算）：凭它 + render_context 可
    # 重放导出。仅 export 路径有值；NULL = 无导出请求（apply/track）或旧快照不可还原。
    request_params: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 幂等键：代表"哪一次真实投递动作"。apply 路径用天然动作 ID
    # （apply_task_item:{id}——同一条目重放不重复记账），export 路径用
    # export:{resume_id}:{artifact_sha256}（同一份产物只留一份存档）。NULL =
    # 无天然动作 ID 的旧路径。普通索引、服务层按键去重：约束化会让历史脏数据
    # 直接炸迁移，也不挡并发竞态（见 ADR-0002）。
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


__all__ = [
    "DELIVERY_SOURCES",
    "DELIVERY_SOURCE_APPLY",
    "DELIVERY_SOURCE_EXPORT",
    "DELIVERY_SOURCE_TRACK",
    "ResumeDeliveryRecord",
]
