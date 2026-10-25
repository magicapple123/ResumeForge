# SPDX-License-Identifier: Apache-2.0
"""0064：资料大字段/组模型的 8 张新表（F1，契约 §2）。

**只加表**：旧资料子表、profile_fact、profile_fact_field_pref 一个字节都不改、不搬旧数据
（R-46：旧数据不迁移但也不物理删除——旧表原样留在库里并继续进备份包，这是"用户自己
导出后重填"唯一可行的路径）。本迁移**没有 DROP / DELETE / UPDATE 任何既有表**，
也没有回填语句；表集合 = 迁移前集合 + 下面 8 张表。

8 张表（创建顺序即阅读顺序；全部**不建外键**——历史库可能缺父表、快照要能脱离父行存活）：

1. profile_custom_section：用户自建大字段定义（section_id / key 双稳定身份、软删）。
2. profile_custom_field：自建大字段下的自定义小字段定义（值类型三种文本、软删）。
3. profile_entry：条目 + 值（values JSON、field_snapshot 历史快照、软删、单例 CHECK）。
4. profile_group：组（名称 + 是否默认；默认组不可软删的 CHECK + 活动组唯一索引）。
5. profile_group_member：组 ↔ 大字段的参与关系（复合主键，无 deleted_at）。
6. profile_workspace_state：数据集级单行状态（当前组/默认组/全局顺序/待告知；CHECK id=1）。
7. profile_field_preference：字段偏好（hidden 与 collapsed_override 两列独立，无 deleted_at）。
8. profile_usage_snapshot：生成/任务的使用快照（不可变、无 updated_at、逻辑引用不建外键）。

**为什么逐表判断"已存在就跳过"**：迁移链也会跑在只有部分业务表的历史库上（旧库会先
被 stamp 到基线再升级），且运维/测试可能手工建过其中一张。逐表幂等保证"已存在的表不
重建、不清空"，未创建的表照常补建。downgrade 同样逐表判断后**反序**删除，只删本迁移
引入的 8 张表，不碰任何旧表。

Revision ID: 0064_profile_groups
Revises: 0063_profile_fact_field_pref
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0064_profile_groups"
down_revision: str | Sequence[str] | None = "0063_profile_fact_field_pref"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 创建顺序（downgrade 反序删除）。逐表"存在即跳过"，所以升级顺序对部分历史库也安全。
_TABLES: tuple[str, ...] = (
    "profile_custom_section",
    "profile_custom_field",
    "profile_entry",
    "profile_group",
    "profile_group_member",
    "profile_workspace_state",
    "profile_field_preference",
    "profile_usage_snapshot",
)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _create_partial_unique_index(name: str, table: str, columns: list[str], predicate: str) -> None:
    """部分唯一索引：只约束活动行（契约 §2）。SQLite 用 sqlite_where 表达 WHERE。"""
    op.create_index(name, table, columns, unique=True, sqlite_where=sa.text(predicate))


def upgrade() -> None:
    tables = _tables()
    if "profile_custom_section" not in tables:
        op.create_table(
            "profile_custom_section",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("section_id", sa.String(length=32), nullable=False),
            sa.Column("key", sa.String(length=48), nullable=False),
            sa.Column("name", sa.String(length=40), nullable=False),
            sa.Column("name_key", sa.String(length=40), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("primary_field_id", sa.String(length=32), nullable=True),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("section_id"),
            sa.UniqueConstraint("key"),
        )
        _create_partial_unique_index(
            "ux_profile_custom_section_active_name",
            "profile_custom_section",
            ["name_key"],
            "deleted_at IS NULL",
        )
        op.create_index(
            "ix_profile_custom_section_sort_order", "profile_custom_section", ["sort_order"]
        )

    if "profile_custom_field" not in tables:
        op.create_table(
            "profile_custom_field",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("field_id", sa.String(length=32), nullable=False),
            sa.Column("section_key", sa.String(length=48), nullable=False),
            sa.Column("label", sa.String(length=40), nullable=False),
            sa.Column("label_key", sa.String(length=40), nullable=False),
            sa.Column("field_type", sa.String(length=16), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("field_id"),
        )
        _create_partial_unique_index(
            "ux_profile_custom_field_active_label",
            "profile_custom_field",
            ["section_key", "label_key"],
            "deleted_at IS NULL",
        )
        op.create_index(
            "ix_profile_custom_field_section_key", "profile_custom_field", ["section_key"]
        )

    if "profile_entry" not in tables:
        op.create_table(
            "profile_entry",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("entry_id", sa.String(length=32), nullable=False),
            sa.Column("section_key", sa.String(length=48), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("values", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("field_snapshot", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("entry_id"),
            # 单例分区（basic_info / summary）只能有一条，排序位恒为 0（契约 §2.3）。
            sa.CheckConstraint(
                "section_key NOT IN ('basic_info', 'summary') OR sort_order = 0",
                name="ck_profile_entry_singleton_sort_order",
            ),
        )
        _create_partial_unique_index(
            "ux_profile_entry_active_section_sort",
            "profile_entry",
            ["section_key", "sort_order"],
            "deleted_at IS NULL",
        )
        op.create_index("ix_profile_entry_section_key", "profile_entry", ["section_key"])

    if "profile_group" not in tables:
        op.create_table(
            "profile_group",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("group_id", sa.String(length=32), nullable=False),
            sa.Column("name", sa.String(length=40), nullable=False),
            sa.Column("name_key", sa.String(length=40), nullable=False),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("group_id"),
            # 默认组不可软删（契约 §2.4 / R-20）。
            sa.CheckConstraint(
                "is_default = 0 OR deleted_at IS NULL",
                name="ck_profile_group_default_not_deleted",
            ),
        )
        _create_partial_unique_index(
            "ux_profile_group_active_name",
            "profile_group",
            ["name_key"],
            "deleted_at IS NULL",
        )
        _create_partial_unique_index(
            "ux_profile_group_single_default",
            "profile_group",
            ["is_default"],
            "is_default = 1 AND deleted_at IS NULL",
        )

    if "profile_group_member" not in tables:
        op.create_table(
            "profile_group_member",
            sa.Column("group_id", sa.String(length=32), nullable=False),
            sa.Column("section_key", sa.String(length=48), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("group_id", "section_key"),
        )

    if "profile_workspace_state" not in tables:
        op.create_table(
            "profile_workspace_state",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("current_group_id", sa.String(length=32), nullable=False),
            sa.Column("default_group_id", sa.String(length=32), nullable=False),
            sa.Column("section_order", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("pending_notice", sa.JSON(), nullable=True),
            sa.Column("notice_id", sa.String(length=32), nullable=True),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            # 数据集级单行状态：id 只能是 1（契约 §2.6 / §6 铁律 6）。
            sa.CheckConstraint("id = 1", name="ck_profile_workspace_state_single_row"),
        )

    if "profile_field_preference" not in tables:
        op.create_table(
            "profile_field_preference",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("section_key", sa.String(length=48), nullable=False),
            sa.Column("field_id", sa.String(length=32), nullable=False),
            sa.Column("hidden", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("collapsed_override", sa.Boolean(), nullable=True),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            # 一个字段一行偏好；hidden 与 collapsed_override 是两列独立状态（§6 铁律 11）。
            sa.UniqueConstraint(
                "section_key",
                "field_id",
                name="uq_profile_field_preference_section_field",
            ),
        )

    if "profile_usage_snapshot" not in tables:
        op.create_table(
            "profile_usage_snapshot",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("snapshot_id", sa.String(length=32), nullable=False),
            # 逻辑引用 resume_generate_task.id / resume_record.id，不建外键（契约 §10.1）。
            sa.Column("task_id", sa.Integer(), nullable=True),
            sa.Column("resume_id", sa.Integer(), nullable=True),
            sa.Column("group_id", sa.String(length=32), nullable=True),
            sa.Column("group_name", sa.String(length=40), nullable=False),
            sa.Column("participating", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("section_order", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("definition_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("data_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("layout", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("snapshot_id"),
            sa.UniqueConstraint("task_id"),
            sa.UniqueConstraint("resume_id"),
        )


def downgrade() -> None:
    tables = _tables()
    for table in reversed(_TABLES):
        if table in tables:
            op.drop_table(table)
