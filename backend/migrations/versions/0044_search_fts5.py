"""0044：知识库检索接入 FTS5（trigram）——新增外部内容虚拟表 ``knowledge_fts``。

只加表、不动任何业务表：``knowledge_fts`` 是 external content 模式的 FTS5 虚拟表，
指向 ``knowledge_entry`` 的 ``title`` / ``content``（rowid 对齐 ``id``），由三个
AFTER 触发器（INSERT / UPDATE / DELETE）保持增量同步，迁移收尾做一次全量 rebuild。

探测与跳过（迁移可跳过是硬规则，历史残缺库也要能跑）：

- ``knowledge_entry`` 不存在 → 整体跳过（触发器建在不存在的表上会直接失败）；
- ``knowledge_entry`` 存在但缺 ``title`` / ``content`` 列（极端残缺形态，例如
  迁移演练构造的只有 id 的裸表）→ 同样整体跳过（rebuild 会引用这些列）；
- 当前 SQLite 不支持 FTS5 trigram（< 3.34.0）→ 整体跳过。检索侧
  （``services/knowledge_service``）用 ``_fts_available`` 探测表是否存在，
  不存在时保持原 LIKE 路径，行为与迁移前完全一致。

选 trigram 而不是默认 unicode61 的原因（2026-10-12 实测）：unicode61 不切中文，
整句成一个 token，中文子串检索（本项目知识库的主场景）基本匹配不到；trigram
把文本按三字滑窗索引，``MATCH '"面试技巧"'`` 与 ``LIKE '%面试技巧%'`` 对
≥3 字符的子串语义一致（ASCII 大小写折叠也与 LIKE 相同），短于 3 字符的
关键词由检索侧回退 LIKE。

Revision ID: 0044_search_fts5
Revises: 0043_interview_auto_rounds
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0044_search_fts5"
down_revision: str | Sequence[str] | None = "0043_interview_auto_rounds"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FTS_TABLE = "knowledge_fts"
# 探测用临时虚拟表名（temp schema，连接结束自动消失，不需要清理）。
_PROBE_TABLE = "temp.rf_fts_probe_0044"

_CREATE_FTS = f"""
CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5(
    title, content,
    content='knowledge_entry', content_rowid='id',
    tokenize='trigram'
)
"""

_CREATE_TRIGGERS = (
    f"""
CREATE TRIGGER IF NOT EXISTS {FTS_TABLE}_ai AFTER INSERT ON knowledge_entry BEGIN
    INSERT INTO {FTS_TABLE}(rowid, title, content)
    VALUES (new.id, new.title, new.content);
END
""",
    f"""
CREATE TRIGGER IF NOT EXISTS {FTS_TABLE}_ad AFTER DELETE ON knowledge_entry BEGIN
    INSERT INTO {FTS_TABLE}({FTS_TABLE}, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
END
""",
    f"""
CREATE TRIGGER IF NOT EXISTS {FTS_TABLE}_au AFTER UPDATE ON knowledge_entry BEGIN
    INSERT INTO {FTS_TABLE}({FTS_TABLE}, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO {FTS_TABLE}(rowid, title, content)
    VALUES (new.id, new.title, new.content);
END
""",
)

_REBUILD = f"INSERT INTO {FTS_TABLE}({FTS_TABLE}) VALUES('rebuild')"


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _trigram_available(bind) -> bool:
    """试建一个 temp FTS5 trigram 虚拟表来探测能力（失败 = SQLite 太旧或无 FTS5）。"""
    try:
        bind.execute(
            sa.text(f"CREATE VIRTUAL TABLE {_PROBE_TABLE} USING fts5(a, tokenize='trigram')")
        )
        bind.execute(sa.text(f"DROP TABLE {_PROBE_TABLE}"))
        return True
    except Exception:  # noqa: BLE001 - 任何探测失败都意味着"不可用"，迁移整体跳过
        return False


def upgrade() -> None:
    bind = op.get_bind()
    # 触发器建在不存在的表上会直接失败：历史残缺库（备份演练会跑迁移链）整体跳过。
    if not _table_exists(bind, "knowledge_entry"):
        return
    # 触发器与 rebuild 都引用 title/content：极端残缺形态下表可能在但列不齐
    # （例如只有 id 的裸表——run_database_migrations 对未打版本号的应用表是
    # "先 stamp 基线再升链"，knowledge_entry 不会经历 0019 的建列），列不齐
    # 同样整体跳过，检索侧探测不到 fts 表自然走原 LIKE 路径。
    columns = {column["name"] for column in sa.inspect(bind).get_columns("knowledge_entry")}
    if not {"id", "title", "content"} <= columns:
        return
    if not _trigram_available(bind):
        return
    op.execute(sa.text(_CREATE_FTS))
    for statement in _CREATE_TRIGGERS:
        op.execute(sa.text(statement))
    # 全量 rebuild：既有数据入索引。external content 表本身不存文本，
    # rebuild 只是把现有行按 rowid 建倒排，幂等且可重跑。
    op.execute(sa.text(_REBUILD))


def downgrade() -> None:
    for suffix in ("au", "ad", "ai"):
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS {FTS_TABLE}_{suffix}"))
    # 虚拟表用 DROP TABLE 即可（不进 sqlite_master 的常规表清单，但 DROP 仍有效）。
    op.execute(sa.text(f"DROP TABLE IF EXISTS {FTS_TABLE}"))
