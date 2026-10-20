# SPDX-License-Identifier: Apache-2.0
"""0046：全局搜索接入 FTS5（trigram）——新增七张外部内容虚拟表 ``search_fts_*``。

只加表、不动任何业务表：``search_fts_<table>`` 是 external content 模式的 FTS5
虚拟表，指向 ``app/services/search_fts.SEARCH_FTS_SPECS`` 登记的各业务表检索列
（rowid 对齐 ``id``），由每表三个 AFTER 触发器（INSERT / UPDATE / DELETE）保持
增量同步，迁移收尾逐表做一次全量 rebuild。覆盖七个数据域：岗位、简历记录、
内推、提醒、面经、台账、资料——它们此前在 ``/api/search`` 里是 ``LIKE '%kw%'``
线性扫描（perf-evidence 实测 p95 23.3ms 且随数据量线性增长）。技能表
（``skill``）刻意不 FTS 化：个人资料硬删子表，至多几十行，负优化。

探测与跳过（迁移可跳过是硬规则，历史残缺库也要能跑；**逐表**判定而不是整体
跳过——某个域的表缺失不应拖累其它域享受索引）：

- 某业务表不存在，或缺少登记的检索列（极端残缺形态）→ 只跳过该域；
- 当前 SQLite 不支持 FTS5 trigram（< 3.34.0）→ 全部跳过。检索侧
  （``services/search_fts``）用 ``fts_available`` 逐表探测，不可用时保持原
  LIKE 路径，行为与迁移前完全一致。

选 trigram 而不是默认 unicode61 的原因与 0044 相同：unicode61 不切中文，
trigram 的 ``MATCH '"关键词"'`` 与 ``LIKE '%关键词%'`` 对 ≥3 字符的子串语义
一致（ASCII 大小写折叠也与 LIKE 相同），短于 3 字符的关键词由检索侧回退 LIKE。

Revision ID: 0046_search_fts
Revises: 0045_delivery_ledger
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046_search_fts"
down_revision: str | Sequence[str] | None = "0045_delivery_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 各域 FTS 表与其被索引列。与 app/services/search_fts.SEARCH_FTS_SPECS 保持一致
# （tests/test_migration_0046.py 钉住两边相等）；迁移文件刻意不 import 应用代码，
# 因为迁移链要能在残缺/历史库上独立运行。
SEARCH_FTS_SPECS: dict[str, tuple[str, ...]] = {
    "job": ("title", "company", "location", "description", "additional_info", "note"),
    "resume_record": ("title", "job_title", "company", "content"),
    "referral": ("job_title", "company", "referrer_name", "position", "note"),
    "reminder": ("title", "note"),
    "interview_experience": ("title", "company", "position", "content"),
    "claim_record": ("title", "category", "subject", "source_fact", "candidate_wording"),
    "material": ("title", "category", "content", "note", "url"),
}

# 探测用临时虚拟表名（temp schema，连接结束自动消失，不需要清理）。
_PROBE_TABLE = "temp.rf_fts_probe_0046"

_TRIGRAM_DDL = "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING fts5(\n    {columns},\n    content='{base}', content_rowid='id',\n    tokenize='trigram'\n)"


def _fts_table(base: str) -> str:
    return f"search_fts_{base}"


def _create_fts_sql(base: str, columns: tuple[str, ...]) -> str:
    return _TRIGRAM_DDL.format(table=_fts_table(base), columns=", ".join(columns), base=base)


def _create_trigger_sqls(base: str, columns: tuple[str, ...]) -> tuple[str, ...]:
    """与 0044 相同的三触发器模式：external content 表的增/删/改同步。"""
    table = _fts_table(base)
    column_list = ", ".join(columns)
    new_values = ", ".join(f"new.{column}" for column in columns)
    old_values = ", ".join(f"old.{column}" for column in columns)
    return (
        f"CREATE TRIGGER IF NOT EXISTS {table}_ai AFTER INSERT ON {base} BEGIN\n"
        f"    INSERT INTO {table}(rowid, {column_list})\n"
        f"    VALUES (new.id, {new_values});\n"
        f"END",
        f"CREATE TRIGGER IF NOT EXISTS {table}_ad AFTER DELETE ON {base} BEGIN\n"
        f"    INSERT INTO {table}({table}, rowid, {column_list})\n"
        f"    VALUES ('delete', old.id, {old_values});\n"
        f"END",
        f"CREATE TRIGGER IF NOT EXISTS {table}_au AFTER UPDATE ON {base} BEGIN\n"
        f"    INSERT INTO {table}({table}, rowid, {column_list})\n"
        f"    VALUES ('delete', old.id, {old_values});\n"
        f"    INSERT INTO {table}(rowid, {column_list})\n"
        f"    VALUES (new.id, {new_values});\n"
        f"END",
    )


def _trigram_available(bind) -> bool:
    """试建一个 temp FTS5 trigram 虚拟表来探测能力（失败 = SQLite 太旧或无 FTS5）。"""
    try:
        bind.execute(
            sa.text(f"CREATE VIRTUAL TABLE {_PROBE_TABLE} USING fts5(a, tokenize='trigram')")
        )
        bind.execute(sa.text(f"DROP TABLE {_PROBE_TABLE}"))
        return True
    except Exception:  # noqa: BLE001 - 任何探测失败都意味着"不可用"，整体跳过
        return False


def _columns_of(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _trigram_available(bind):
        return
    for base, columns in SEARCH_FTS_SPECS.items():
        tables = set(sa.inspect(bind).get_table_names())
        if base not in tables:
            continue  # 历史残缺库：该域整体跳过，不影响其它域
        if not {"id", *columns} <= _columns_of(bind, base):
            continue  # 极端残缺形态：表在但检索列不齐，rebuild 会引用不存在的列
        op.execute(sa.text(_create_fts_sql(base, columns)))
        for statement in _create_trigger_sqls(base, columns):
            op.execute(sa.text(statement))
        # 全量 rebuild：既有数据入索引。external content 表本身不存文本，
        # rebuild 只是把现有行按 rowid 建倒排，幂等且可重跑。
        op.execute(sa.text(f"INSERT INTO {_fts_table(base)}({_fts_table(base)}) VALUES('rebuild')"))


def downgrade() -> None:
    for base in SEARCH_FTS_SPECS:
        table = _fts_table(base)
        for suffix in ("au", "ad", "ai"):
            op.execute(sa.text(f"DROP TRIGGER IF EXISTS {table}_{suffix}"))
        # 虚拟表用 DROP TABLE 即可（不进 sqlite_master 的常规表清单，但 DROP 仍有效）。
        op.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))
