# SPDX-License-Identifier: Apache-2.0
"""0042：岗位「来源」从备注拆成独立列 ``job.origin_source``。

历史行为：保存岗位时把「来源：{recognition_source}」一行自动追加在备注末尾
（``services/job/job_service.py::note_with_source``）。两个用户反馈的痛点都源于此——
来源行删不掉（更新时会补回来），编辑一条空备注的岗位也会被自动加上来源。

- 新列 ``origin_source``：用户可见、可编辑、可清空的来源字段；备注从此只存用户写的内容。
- 历史数据回填：备注**末尾**恰有一行「来源：…」的（正是自动追加的形态），
  把该行的值迁进 ``origin_source`` 并从备注里删掉这一行。只认行首 `来源：` 且整行
  就是这个标记的形态，用户正文里的自然语句（如"来源是朋友转发的"）不动。
  回填在新列上做幂等保护（已有值不覆盖）；downgrade 丢弃新列，备注不还原——
  降级是结构性回退，不把已经拆出来的数据再拼回去制造二次漂移。

只加列 + 可跳过（列已存在时跳过）+ 完整 downgrade。

Revision ID: 0042_job_origin_source
Revises: 0041_track_channel_and_events
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042_job_origin_source"
down_revision: str | Sequence[str] | None = "0041_track_channel_and_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMN = "origin_source"
MARKER_PREFIX = "来源："


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {item["name"] for item in sa.inspect(bind).get_columns(table)}


def _split_note_marker(note: str) -> tuple[str, str]:
    """把备注末尾的「来源：…」行拆出来，返回 (正文, 来源值)；没有则原样返回。

    两种历史形态都要认：空备注保存时 note 就是单独一行「来源：x」（无换行）；
    有正文时标记是最后一行。
    """
    stripped = (note or "").rstrip()
    if not stripped:
        return note, ""
    lines = stripped.split("\n")
    value = lines[-1].strip()
    if not value.startswith(MARKER_PREFIX):
        return note, ""
    origin = value[len(MARKER_PREFIX) :].strip()
    if not origin:
        return note, ""
    return "\n".join(lines[:-1]).rstrip(), origin


def upgrade() -> None:
    bind = op.get_bind()
    # 迁移链也会跑在"只有部分业务表"的历史库上（备份演练就这么干）：
    # job 表不在时无事可做，直接跳过。
    if not _table_exists(bind, "job"):
        return
    if not _column_exists(bind, "job", COLUMN):
        op.add_column(
            "job",
            sa.Column(COLUMN, sa.String(length=64), nullable=False, server_default=""),
        )
    # 历史备注回填：把自动追加的「来源：…」行迁到新列（回收站里的行也一并处理）。
    # 幂等：新列已有值的行不动。极端老库可能还没有 note 列（极简历史 schema）——
    # 没有 note 就不可能有标记行，直接跳过回填。
    if not _column_exists(bind, "job", "note"):
        return
    rows = bind.execute(sa.text(f"SELECT id, note, {COLUMN} FROM job")).fetchall()
    for job_id, note, current_origin in rows:
        if current_origin:
            continue
        body, origin = _split_note_marker(note or "")
        if not origin:
            continue
        bind.execute(
            sa.text("UPDATE job SET note = :note, origin_source = :origin WHERE id = :id"),
            {"note": body, "origin": origin, "id": job_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "job") and _column_exists(bind, "job", COLUMN):
        op.drop_column("job", COLUMN)
