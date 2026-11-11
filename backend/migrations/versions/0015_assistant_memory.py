# SPDX-License-Identifier: Apache-2.0
"""0015：助手语义记忆 —— 新建 assistant_memory（#31A / #18D 合并模型）。

现状是三档记忆缺一档：情景记忆（chat_message 追加日志）与程序记忆（assistant_skill）
都有，**语义记忆**（关于用户/世界的稳定事实）完全没有——目标岗位、意向城市、薪资底线、
不去的公司，每次都要重新说一遍。

#31 与 #18D 是同一件事的两种表述（手填画像 / 自动记忆），**只建一个模型**：
手填 source=manual、自动抽取 source=extracted，避免出现两份「目标岗位」互相打架。

四类操作与生命周期的核心约定（写在这里是因为它们是数据不变量，不是 UI 细节）：

1. **按 kind 白名单去重**（target_role/city/salary_floor/avoid_company/work_mode/
   skill_tag/constraint，其余一律不记）：本地单用户几十条事实，用 kind + key 就够，
   不上知识图谱；
2. **冲突不删除**：新事实与旧事实同类不同值时，旧的置 superseded、新条 active，
   两条都留着——必须能回溯「当时说的是什么」（Mem0 v2 的教训：只留最新会丢掉历史）；
3. **可见可改**：status=deleted 是用户显式删除（软删），source 记录它从哪来，
   source_conversation_id / source_message_id 让列表能点回原对话；
4. **外键一律 SET NULL**：对话或消息被回收站清理后，记忆本身仍然是用户的资产，
   只是失去了回跳入口（不级联删）。

降级只删这张表；表不存在时跳过。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_assistant_memory"
down_revision: str | Sequence[str] | None = "0014_knowledge_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "assistant_memory"
_KIND_STATUS_INDEX = "ix_assistant_memory_kind_status"
_SOURCE_CONVERSATION_INDEX = "ix_assistant_memory_source_conversation_id"
_SOURCE_MESSAGE_INDEX = "ix_assistant_memory_source_message_id"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """建语义记忆表与三个索引；表已存在则跳过（幂等）。"""
    if _TABLE in _table_names():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        # 白名单取值见 services/assistant/memory.py 的 MEMORY_KINDS；
        # 服务端拒绝白名单之外的 kind（这里不建 CHECK，白名单在代码里单源）。
        sa.Column("kind", sa.String(length=32), nullable=False, server_default=""),
        # 事实的「维度内键」：例如 city 的 key 可为空、salary_floor 的 key 为城市；
        # 去重与更新以 (kind, key) 为单位，value 是给用户看的内容。
        sa.Column("key", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
        # 0–1 的置信度（自动抽取按轮次/明确程度给分，手填默认 1）。
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.5"),
        # 来源可点回对话：对话/消息被清理后置空，记忆本身保留。
        sa.Column(
            "source_conversation_id",
            sa.Integer(),
            sa.ForeignKey("chat_conversation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "source_message_id",
            sa.Integer(),
            sa.ForeignKey("chat_message.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # active / superseded / deleted（取值见 models/assistant_memory.py）。
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        # manual / extracted：手填画像（#18D）与自动抽取（#31A）共用同一模型。
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    # 注入时按 (kind, status) 取 active 记忆；列表页同样以 status 为筛选起点。
    op.create_index(_KIND_STATUS_INDEX, _TABLE, ["kind", "status"])
    # 列表「来源可点回对话」与按会话清理/回溯。
    op.create_index(_SOURCE_CONVERSATION_INDEX, _TABLE, ["source_conversation_id"])
    op.create_index(_SOURCE_MESSAGE_INDEX, _TABLE, ["source_message_id"])


def downgrade() -> None:
    """删表与索引；表不存在则跳过（不碰对话/消息）。"""
    if _TABLE not in _table_names():
        return
    # 索引随表一起消失，但仍显式删一遍：将来若有人把索引改成独立对象，
    # 这里不会留下一个指向已删表的孤儿索引。
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(_TABLE)}
    for index_name in (_SOURCE_MESSAGE_INDEX, _SOURCE_CONVERSATION_INDEX, _KIND_STATUS_INDEX):
        if index_name in indexes:
            op.drop_index(index_name, table_name=_TABLE)
    op.drop_table(_TABLE)
