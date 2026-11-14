# SPDX-License-Identifier: Apache-2.0
"""AI 求职助手会话与消息历史。"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .profile import utcnow


class ChatConversation(Base):
    __tablename__ = "chat_conversation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(120), default="新对话")
    # 对话入口作用域：主助手与投投悬浮球历史必须物理隔离。
    surface: Mapped[str] = mapped_column(
        String(16), default="page", nullable=False, server_default="page", index=True
    )
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 归档：默认从侧栏列表里收起来，可以切到「已归档」查看或恢复。
    archived: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    # 分组（"移动到项目"）：空串表示未分组。
    group_name: Mapped[str] = mapped_column(
        String(64), default="", nullable=False, server_default=""
    )
    # 临时对话（F34）：为真时这一段对话既不注入也不抽取记忆（0019 迁移）。
    # 关掉开关只是恢复后续读写，**不会删除**已经存下的记忆。
    memory_off: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    # 上下文压缩状态（问题清单 #10，迁移 0011）：可空 JSON。NULL = 没压缩过（默认）。
    # 只记"覆盖到哪条消息" + 结构化摘要 + 上次压缩的量化结果；**原文永不删除**，
    # 所以「还原」就是把它置回 NULL，而不是回滚任何消息。
    compaction: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True, default=None)

    # 软删除时间戳：NULL 表示「没删」。列表查询一律加 `deleted_at IS NULL`，
    # 回收站里则只看非 NULL 的行（见 ``services/trash.py``）。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ChatMessage.id",
    )


class ChatMessage(Base):
    __tablename__ = "chat_message"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("chat_conversation.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    # 「引用追问」指向被引用的那条消息。**刻意不加外键**：SQLite 不支持给已存在的表
    # ADD COLUMN 带外键约束（Alembic 会走 ALTER 约束路径直接报错），而删消息时置空
    # 由服务层负责——被引用的消息删掉后，引用它的那条要留下来，正文里的引用快照仍可读。
    quoted_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attachments: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="complete")
    error: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(
        String(16), default="normal", nullable=False, server_default="normal"
    )
    proposal_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    conversation: Mapped[ChatConversation] = relationship(back_populates="messages")

    __table_args__ = (
        Index("uq_chat_message_proposal_kind", "proposal_id", "kind", unique=True),
    )


class AssistantSkill(Base):
    """用户导入的技能：一份提示词，外加可选的知识文件。

    一个包里存在**两种信任级别**：``prompt`` 是用户主动导入的指令（可以进系统提示），
    ``files`` 里的内容是不可信资料（必须清洗后按资料呈现）。
    """

    __tablename__ = "assistant_skill"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    prompt: Mapped[str] = mapped_column(Text, default="")
    # deprecated（T14）：技能改为**按对话启用**（见 AssistantConversationSkill），这一列
    # 不再参与系统提示注入。保留列是为了避免破坏性迁移，也不回填历史值；新对话一律为空。
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_name: Mapped[str] = mapped_column(String(255), default="")
    # 0016（#31D）：四段内容的另外三段。手工导入的老技能为空串，行为不变。
    when_to_use: Mapped[str] = mapped_column(Text, default="", server_default="")
    steps: Mapped[str] = mapped_column(Text, default="", server_default="")
    pitfalls: Mapped[str] = mapped_column(Text, default="", server_default="")
    # 版本（#31E）：自动生成/更新时自增；对话启用行记引用版本，避免组合漂移。
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False, server_default="1")
    # 是否由对话自动生成（#31D）：生成的学习成果默认待验证，不自动生效。
    generated: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    # 验证状态（#31D/#31F）：'' = 无需验证（手工导入/手写）；pending = 待验证；validated = 已验证。
    validation_status: Mapped[str] = mapped_column(
        String(16), default="", nullable=False, server_default=""
    )
    # 最近一次被加载进系统提示的时间（#31E）：90 天未加载 → 提示归档，不自动删。
    last_loaded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    files: Mapped[list["AssistantSkillFile"]] = relationship(
        back_populates="skill",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="AssistantSkillFile.path",
    )


class AssistantSkillFile(Base):
    """技能包里的知识文件。内容视为不可信数据，读取前先清洗。"""

    __tablename__ = "assistant_skill_file"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_skill.id", ondelete="CASCADE"), index=True
    )
    path: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text, default="")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)

    skill: Mapped[AssistantSkill] = relationship(back_populates="files")


class AssistantConversationSkill(Base):
    """「这个对话启用了哪些技能」（T14）：技能从全局开关改成按会话启用。

    一行 = 一次启用。AssistantSkill.enabled 列已废弃、不读；新对话默认没有任何行
    （技能全关）。两个外键都 ON DELETE CASCADE：会话进回收站是软删除（行保留，恢复后
    技能还在），彻底删除会话或删除技能时关联行自动消失，不留幽灵引用。
    """

    __tablename__ = "assistant_conversation_skill"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "skill_id",
            name="uq_assistant_conversation_skill_conversation_id_skill_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("chat_conversation.id", ondelete="CASCADE"), index=True
    )
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_skill.id", ondelete="CASCADE"), index=True
    )
    # 0016（#31E）：启用时引用的技能版本快照（NULL = 0016 之前的老关联行，按当前版本读）。
    skill_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AssistantWriteProposal(Base):
    """助手写操作提案（T01 单一事实源）。

    为什么落库：提案状态必须能被「下一轮对话」与「重启后的下一轮对话」如实读到——
    状态只存内存，重启即丢，模型只能复述历史消息里的旧说法（P0 根因）。

    状态机：pending / approved / executed / failed / unknown / rejected / expired。

    三个刻意的设计：
    - **不持久化 token**：token 仍在批准时签发、同一请求内消费，只在服务端内存流转；
    - ``dataset_key`` 是**稳定**的数据集标识（main / 16 位 hex id），不是进程内代次；
      跨重启判定只认它。``dataset_generation`` 只用于同一进程内 A→B→A 的旧提案拦截，
      且启动时 pending/approved 一律置 expired，所以代次不会成为跨重启语义的一部分；
    - ``target_fingerprint`` 是创建时写入预览的摘要（预览里带着目标对象的版本证据，
      如简历 revision / 记录 updated_at）。批准前重算预览再比对，目标已变就 409，
      绝不用 30 分钟前的快照执行。
    """

    __tablename__ = "assistant_write_proposal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    proposal_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    # 提案归属的会话与触发它的助手消息。会话可能被删、消息也可能被删，所以不建外键，
    # 只保留线索；派生回写按 best-effort 处理（失败不影响状态正确性）。
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dataset_key: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    dataset_generation: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    arguments_digest: Mapped[str] = mapped_column(
        String(64), default="", nullable=False, server_default=""
    )
    preview: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    target_fingerprint: Mapped[str] = mapped_column(
        String(64), default="", nullable=False, server_default=""
    )
    status: Mapped[str] = mapped_column(
        String(16), default="pending", nullable=False, index=True, server_default="pending"
    )
    result_summary: Mapped[str] = mapped_column(
        Text, default="", nullable=False, server_default=""
    )
    error: Mapped[str] = mapped_column(Text, default="", nullable=False, server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
