# SPDX-License-Identifier: Apache-2.0
"""外部简历：用户在别处生成的简历原件 + 上传时本地提取的正文（迁移 0010）。

**只读快照**：与 `resume_record`（结构化文档模型 v2）完全隔离，故意不共用一张表。
PDF / docx 没有条目 / 字段 / 纸面位置这些语义，用模型还原必然错位，而用户会期待
"能编辑"；同时 `resume_record.content` 有近 90 处读取路径（导出、版式、风险检查、
助手工具……），往里面塞非文档内容等于给每条路径各加一道守卫，漏一个就是 500。
所以外部简历独立成表：进不了制作台、不参与导出与版式。

**为什么文件仍走 `user_file`**：复用 sha256 去重、磁盘命名安全化与自愈补写；
`user_files/` 已经是备份的资产类别（按 `user_file` 整表收集），不新增类别。
`file_id` 用外键指向 `user_file.id`，但删除一律只写 `deleted_at`：同一份内容
可能被资料照片 / 聊天附件等其它入口引用，**绝不删物理文件**（彻底删除也一样）。

**正文存两列**：`text` 是上传时本地提取的正文（与 `MAX_MATERIAL_TEXT_CHARS`
同口径截断），`text_chars` 是冗余字数——列表排序 / 展示不必反复算。扫描件 PDF
不调用视觉模型：行照建、`text=""`，接口用警告如实告知"没有文字层"。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class ExternalResume(Base):
    """一份上传的外部简历（只读快照）。"""

    __tablename__ = "external_resume"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 物理文件登记（user_file）。**没有 ondelete**：副本行不随外部简历删除而消失。
    file_id: Mapped[int] = mapped_column(ForeignKey("user_file.id"), nullable=False, index=True)
    # 用户可改名；默认取原文件名（服务端安全化后的名字）。
    name: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    # 上传时本地提取的正文；扫描件 / 无文字层文件为空串（接口返回 warning）。
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # 冗余字数：列表展示与排序不必对 text 反复求长度。
    text_chars: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 可选关联岗位：便于表达"这份简历是投这个岗的"；岗位彻底删除时置空。
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    # NULL 表示未删；软删进回收站（**只写这一列，不动物理文件**）。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


__all__ = ["ExternalResume"]
