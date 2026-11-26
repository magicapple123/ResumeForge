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

**编辑另存新版本（#5）**：在线改字**绝不覆盖原件**——`user_file` 是内容寻址的共享登记，
同一份 sha256 可能被资料照片 / 聊天附件引用，覆盖会连累别的入口。所以每次编辑都写一个
新 `user_file`，`file_id` 指向最新那份，`original_file_id` 留**首次上传**那份（"回到原件"），
历史逐条记在 `external_resume_revision`。列表仍是一行 = 一份外部简历，版本只在详情抽屉里看。

**收藏与备注（#R10 续 · 迁移 0031）**：外部简历此前只能"上传 / 删除"，留不住"这份先留着"
和"这份是给甲方的版本"。`favorite` / `favorited_at` / `note` 三列把能力补齐到与内部简历
齐平。**写入必须走 `services/favorites.py`**（Core `update()` + 显式写回 `updated_at`）：
`updated_at` 带 `onupdate=utcnow`，一次 ORM 赋值收藏就会把行顶到"最近更新"的头上并重演
R2 的"行跳位"。
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .profile import utcnow

# 历史版本的来源：上传 / 编辑 / 恢复到某个旧版本。
# `restore` 也**写新版本**而不是删历史：回溯链因此只增不减，谁在什么时候恢复了哪一版都留痕。
SOURCE_UPLOAD = "upload"
SOURCE_EDIT = "edit"
SOURCE_RESTORE = "restore"
REVISION_SOURCES = (SOURCE_UPLOAD, SOURCE_EDIT, SOURCE_RESTORE)


class ExternalResume(Base):
    """一份上传的外部简历（原件 + 可改字的历史版本链）。"""

    __tablename__ = "external_resume"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 物理文件登记（user_file）。**没有 ondelete**：副本行不随外部简历删除而消失。
    # 这一列永远指向**最新**那份（上传的原件，或最近一次编辑 / 恢复的产物）。
    file_id: Mapped[int] = mapped_column(ForeignKey("user_file.id"), nullable=False, index=True)
    # 首次上传的那份（"回到原件"用）。迁移会把老数据回填成 file_id；允许 NULL 只是因为
    # 新建列这一瞬间索引里可能还有老行（服务层对"文件登记丢了"的情况按缺失处理）。
    original_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("user_file.id"), nullable=True, index=True
    )
    # 用户可改名；默认取原文件名（服务端安全化后的名字）。
    name: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    # 上传时本地提取的正文；扫描件 / 无文字层文件为空串（接口返回 warning）。
    # **每次编辑后重新提取并回写**，否则"用于面试"和文本检查用的还是旧正文。
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # 冗余字数：列表展示与排序不必对 text 反复求长度。
    text_chars: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # ===== 收藏与备注（迁移 0031，R10 续 · P0）=====
    # 是否收藏。**不给它 index=True**：收藏页的候选集是"用户自己上传的几十份"，全表扫足够，
    # 建索引要跟迁移双向对齐却没有查询收益。
    favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 收藏时刻；NULL = 从没收藏过（取消收藏时清回 NULL）。收藏页按它倒序排"最近收藏的在前"。
    favorited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 用户备注（"这份是给甲方的那版"）。空串 = 没写，与内部简历同口径，读侧不必再判 NULL。
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
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

    revisions: Mapped[list["ExternalResumeRevision"]] = relationship(
        back_populates="resume",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ExternalResumeRevision.created_at.desc(), ExternalResumeRevision.id.desc()",
    )


class ExternalResumeRevision(Base):
    """一次版本快照：某时刻这份外部简历对应哪个文件、正文多长、有没有文字。

    版本语义是**只增不改**：编辑写 `source=edit`，恢复写 `source=restore`，谁都不删历史。
    快照只记"指向哪个 user_file" + 字数，不复制正文——正文本体在 `external_resume.text`
    （当前版本）与各 `user_file`（历史版本的字节）里，复制一份必然与原件不一致。
    """

    __tablename__ = "external_resume_revision"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 简历被**彻底删除**（清空回收站）时历史一起走：快照离开简历没有任何意义。
    resume_id: Mapped[int] = mapped_column(
        ForeignKey("external_resume.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 这一版对应的文件。**没有 ondelete**：与 file_id 同口径，user_file 行被别处共享。
    file_id: Mapped[int] = mapped_column(ForeignKey("user_file.id"), nullable=False, index=True)
    # 这一版提取到的正文字数 / 有没有文字（列表展示"第 3 版 · 837 字"）。
    text_chars: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    has_text: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    # upload / edit / restore（见模块顶部的三个常量）。
    source: Mapped[str] = mapped_column(String(16), default=SOURCE_UPLOAD, nullable=False)

    resume: Mapped[ExternalResume] = relationship(back_populates="revisions")


__all__ = [
    "REVISION_SOURCES",
    "SOURCE_EDIT",
    "SOURCE_RESTORE",
    "SOURCE_UPLOAD",
    "ExternalResume",
    "ExternalResumeRevision",
]
