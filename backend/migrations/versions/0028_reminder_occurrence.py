# SPDX-License-Identifier: Apache-2.0
"""0028：提醒 occurrence 模型（CR-28）——「稍后提醒 + 重复」的结构基础。

三件事同批，因为它们描述同一次语义变更：

1. **新表 ``reminder_occurrence``**：一行 = 一次到期。``status`` 是这一次的处理结果
   （pending/done/skipped），``due_at`` 是这一次的时刻，``snoozed_from`` 记录被推迟前的
   原始时刻，``notified_at`` 是投递幂等标记（替代 ``reminder.last_notified_at``，
   后者保留但不再写入）。
2. **``reminder`` 加两列**：``recurrence``（none/daily/weekly/monthly，server_default
   ``none``）与 ``recurrence_until``（结束条件，NULL = 一直重复）。
3. **``reminder.status`` 收窄为 active/archived**：旧三态里的 done/dismissed 是"这一次
   处理完了"，不是"这条计划不要了"，因此迁到 occurrence 上：done→done、dismissed→skipped、
   pending→pending；计划本身 pending→active、done/dismissed→archived（旧语义下单次完成
   就等于结束，收窄后归档与之等价）。

数据迁移：每个既有 ``reminder`` 行生成一条 occurrence（``due_at = remind_at``，
``notified_at = last_notified_at``），保证升级后"接下来要做什么"与升级前逐条一致。

幂等与部分库：表/列已存在则跳过；``reminder`` 表不存在（只有部分业务表的库）直接返回，
不建悬挂外键。降级把 status 值按 occurrence 还原、删两列、按原样删表。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_reminder_occurrence"
down_revision: str | Sequence[str] | None = "0027_notification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_REMINDER = "reminder"
_TABLE = "reminder_occurrence"
_REMINDER_ID_INDEX = f"ix_{_TABLE}_reminder_id"
_DUE_INDEX = f"ix_{_TABLE}_due_at"
_STATUS_INDEX = f"ix_{_TABLE}_status"

# 旧 status -> 计划状态 / 这一次的状态。
_PLAN_STATUS_BY_LEGACY = {"pending": "active", "done": "archived", "dismissed": "archived"}
_OCCURRENCE_STATUS_BY_LEGACY = {"pending": "pending", "done": "done", "dismissed": "skipped"}


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def _add_recurrence_columns() -> None:
    existing = _column_names(_REMINDER)
    if "recurrence" not in existing:
        op.add_column(
            _REMINDER,
            sa.Column("recurrence", sa.String(length=16), nullable=False, server_default="none"),
        )
    if "recurrence_until" not in existing:
        op.add_column(_REMINDER, sa.Column("recurrence_until", sa.DateTime(), nullable=True))


def _create_occurrence_table() -> None:
    if _TABLE in _table_names():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "reminder_id",
            sa.Integer(),
            sa.ForeignKey("reminder.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("due_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("notified_at", sa.DateTime(), nullable=True),
        sa.Column("snoozed_from", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(_REMINDER_ID_INDEX, _TABLE, ["reminder_id"])
    op.create_index(_DUE_INDEX, _TABLE, ["due_at"])
    op.create_index(_STATUS_INDEX, _TABLE, ["status"])


def _migrate_rows() -> None:
    """既有 reminder -> 一条 occurrence + status 收窄（可重复执行）。"""
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, remind_at, status, last_notified_at FROM reminder ORDER BY id"  # noqa: S608 - 表名是常量，无外部输入
        )
    ).fetchall()
    if not rows:
        return
    has_occurrences = bind.execute(
        sa.text("SELECT COUNT(*) FROM reminder_occurrence")  # noqa: S608
    ).scalar_one()
    if not has_occurrences:
        for reminder_id, remind_at, status, notified_at in rows:
            bind.execute(
                sa.text(
                    "INSERT INTO reminder_occurrence "
                    "(reminder_id, due_at, status, notified_at, snoozed_from, created_at, updated_at) "
                    "VALUES (:reminder_id, :due_at, :status, :notified_at, NULL, :due_at, :due_at)"
                ),
                {
                    "reminder_id": reminder_id,
                    "due_at": remind_at,
                    "status": _OCCURRENCE_STATUS_BY_LEGACY.get(status or "pending", "pending"),
                    "notified_at": notified_at,
                },
            )
    for reminder_id, _remind_at, status, _notified_at in rows:
        plan_status = _PLAN_STATUS_BY_LEGACY.get(status or "pending")
        if plan_status is None:
            # 已经是新取值（active/archived）：重复升级时不动。
            continue
        bind.execute(
            sa.text("UPDATE reminder SET status = :status WHERE id = :id"),  # noqa: S608
            {"status": plan_status, "id": reminder_id},
        )


def upgrade() -> None:
    """建 occurrence 表、加重复规则两列、把旧三态迁到两层状态。"""
    if _REMINDER not in _table_names():
        return
    _add_recurrence_columns()
    _create_occurrence_table()
    _migrate_rows()


def downgrade() -> None:
    """按 occurrence 还原 status 旧取值，删两列，按原样删表；不存在则跳过。"""
    if _REMINDER not in _table_names():
        return
    bind = op.get_bind()
    if _TABLE in _table_names():
        # 归档的计划在旧语义里是哪一态？取它最新一次 occurrence 的结果（done/skipped），
        # 没有 occurrence 的一律回 pending（旧语义下"待办"）。
        latest = {
            int(reminder_id): status
            for reminder_id, status in bind.execute(
                sa.text(
                    "SELECT o.reminder_id, o.status FROM reminder_occurrence o "
                    "JOIN (SELECT reminder_id, MAX(due_at) AS m FROM reminder_occurrence "
                    "GROUP BY reminder_id) t "
                    "ON t.reminder_id = o.reminder_id AND t.m = o.due_at"
                )
            ).fetchall()
        }
        for reminder_id, plan_status in bind.execute(
            sa.text("SELECT id, status FROM reminder")  # noqa: S608
        ).fetchall():
            if plan_status == "active":
                legacy = "pending"
            elif plan_status == "archived":
                legacy = "done" if latest.get(int(reminder_id)) == "done" else "dismissed"
            else:
                continue
            bind.execute(
                sa.text("UPDATE reminder SET status = :status WHERE id = :id"),  # noqa: S608
                {"status": legacy, "id": reminder_id},
            )
        for index_name in (_STATUS_INDEX, _DUE_INDEX, _REMINDER_ID_INDEX):
            if index_name in _index_names(_TABLE):
                op.drop_index(index_name, table_name=_TABLE)
        op.drop_table(_TABLE)
    existing = _column_names(_REMINDER)
    if "recurrence_until" in existing or "recurrence" in existing:
        with op.batch_alter_table(_REMINDER) as batch:
            if "recurrence_until" in existing:
                batch.drop_column("recurrence_until")
            if "recurrence" in existing:
                batch.drop_column("recurrence")
