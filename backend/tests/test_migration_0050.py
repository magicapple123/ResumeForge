# SPDX-License-Identifier: Apache-2.0
"""0050：``candidate_job.deleted_at`` —— 备选岗位进入回收站范围。

覆盖硬规则：**只加列**（表集合前后不变，"旧备份仍可导入"的前提）、可空且无服务端默认
（旧行一律 NULL = 没删，与此前的可见性逐字一致）、不加索引、完整 downgrade、以及残缺库
（没有 ``candidate_job`` 表）跳过而不报错。

**本文件刻意不写死 revision 字面量**：一旦有新迁移排在 0050 之后，"head 的字面量"就变成
了"中间某个版本"，而这个用例关心的是"0050 这一步做了什么"，不是"head 是谁"（head 由
``test_database.py`` / ``test_apply_migration_qa.py`` 等处钉住）。按前缀在迁移脚本目录里找
0050，既不会随新迁移失效，也不会在别处留下第二份 head 字面量。
"""

from __future__ import annotations

from alembic import command
from alembic.script import ScriptDirectory
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

_REVISION_PREFIX = "0050"
# 0044 / 0046 两代 FTS 派生索引（虚拟表及影子表）：不算业务 schema，表集合口径要排除。
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _revisions(config) -> tuple[str, str]:
    """取（父 revision, 本迁移 revision）。"""
    script = ScriptDirectory.from_config(config)
    for entry in script.walk_revisions():
        if entry.revision.startswith(_REVISION_PREFIX):
            previous = entry.down_revision
            assert isinstance(previous, str), "0050 的父 revision 应当是单个标识"
            return previous, entry.revision
    raise AssertionError(f"迁移脚本目录里找不到 {_REVISION_PREFIX} 开头的 revision")


def _upgrade_to_previous(config) -> str:
    """升到 0050 的父 revision（"升级前"的现场），返回 0050 的 revision。"""
    previous, head = _revisions(config)
    command.upgrade(config, previous)
    return head


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_a_nullable_column_and_keeps_tables_untouched(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'candidate-soft-delete.db'}")
    config = build_alembic_config(engine)
    head = _upgrade_to_previous(config)
    before = _business_tables(engine)
    assert "deleted_at" not in _columns(engine, "candidate_job")

    command.upgrade(config, head)

    # 只加列：表集合不变（旧备份导入依赖这一点）。
    assert _business_tables(engine) == before
    column = _columns(engine, "candidate_job")["deleted_at"]
    # 可空且不带服务端默认：旧行一律 NULL = "没删"，与升级前可见性逐字一致。
    assert column["nullable"] is True
    assert column["default"] is None
    # deleted_at 不是查询条件（列表只过滤 IS NULL，不走索引）：不建索引。
    assert "ix_candidate_job_deleted_at" not in {
        index["name"] for index in inspect(engine).get_indexes("candidate_job")
    }


def test_existing_rows_stay_visible_after_upgrade(tmp_path):
    """升级不能让用户已有的候选"消失"：旧行必须落到 NULL（= 没删）。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'backfill.db'}")
    config = build_alembic_config(engine)
    head = _upgrade_to_previous(config)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO candidate_job "
                "(title, company, raw_text, images, note, source, created_at, updated_at, status) "
                "VALUES ('旧候选', '某公司', '', '[]', '', '手动添加', "
                "'2026-01-02 03:04:05', '2026-01-02 03:04:05', 'pending')"
            )
        )

    command.upgrade(config, head)

    with engine.connect() as connection:
        deleted_at = connection.execute(
            text("SELECT deleted_at FROM candidate_job WHERE title = '旧候选'")
        ).scalar_one()
    assert deleted_at is None


def test_downgrade_removes_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    previous, head = _revisions(config)
    command.upgrade(config, head)

    command.downgrade(config, previous)

    assert "deleted_at" not in _columns(engine, "candidate_job")


def test_missing_table_is_skipped_instead_of_failing(tmp_path):
    """迁移链也会跑在"只有部分业务表"的历史库上：缺表就跳过，不能整条链失败。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    head = _upgrade_to_previous(config)

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE candidate_job"))

    command.upgrade(config, head)
    # 降级同理：缺表的库上跑 downgrade 也不能报错（回退演练会走到这一步）。
    previous, _ = _revisions(config)
    command.downgrade(config, previous)

    assert "candidate_job" not in inspect(engine).get_table_names()


# ===========================================================================
# 以下三条是 QA 补充的边界：升级→降级→再升级的完整往返、列已存在时的幂等、
# 以及"只加列"这件事在**数据**维度上的确认（不是只看列名）。
# ===========================================================================


def _insert_candidate(engine, title: str, source_url: str) -> None:
    """按迁移 0050 之前那一版 schema 插一条候选（只给非空列，其余走默认）。"""
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO candidate_job "
                "(title, company, source_url, raw_text, images, note, source, "
                " created_at, updated_at, status) "
                "VALUES (:title, '某公司', :url, '', '[]', '', '手动添加', "
                "'2026-01-02 03:04:05', '2026-01-02 03:04:05', 'pending')"
            ),
            {"title": title, "url": source_url},
        )


def _row(engine, title: str) -> dict:
    """读"迁移前就有的那些列"（不碰 ``deleted_at``，降级后它不存在）。"""
    with engine.connect() as connection:
        row = (
            connection.execute(
                text(
                    "SELECT title, company, source_url, status FROM candidate_job WHERE title = :title"
                ),
                {"title": title},
            )
            .mappings()
            .one()
        )
    return dict(row)


def _deleted_at(engine, title: str):
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT deleted_at FROM candidate_job WHERE title = :title"),
            {"title": title},
        ).scalar_one()


def test_upgrade_downgrade_upgrade_round_trip_keeps_the_data(tmp_path):
    """升级 → 降级 → 再升级**三次都成功**，且数据与其它列一字未动。

    只测"降级后列没了"不够：真正会咬人的是**回退演练之后还能不能回到新版**——
    降级如果顺手重建了表（SQLite 上 ``drop_column`` 走 batch 模式时会重建），
    列名对得上但数据可能已经掉了，而那时候用户看到的只是"候选不见了"。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'round-trip.db'}")
    config = build_alembic_config(engine)
    previous, head = _revisions(config)

    command.upgrade(config, previous)
    _insert_candidate(engine, "往返候选", "https://example.com/round-trip")
    before = _row(engine, "往返候选")
    assert "deleted_at" not in _columns(engine, "candidate_job")

    command.upgrade(config, head)  # ① 升级
    assert _deleted_at(engine, "往返候选") is None

    command.downgrade(config, previous)  # ② 降级
    assert "deleted_at" not in _columns(engine, "candidate_job")
    assert _row(engine, "往返候选") == before, "降级不能把这条候选弄丢，也不能改掉其它列"

    command.upgrade(config, head)  # ③ 再升级
    assert _deleted_at(engine, "往返候选") is None, "再升级后已有的候选必须仍是'没删'"
    assert _row(engine, "往返候选") == before


def test_upgrade_is_a_no_op_when_the_column_already_exists(tmp_path):
    """列已经被 ``ensure_sqlite_columns`` 补过（legacy 库常见）：跳过，不重复加列。

    这条路径真的会走到：``create_all`` + ``ensure_sqlite_columns`` 先给老库补上列，
    随后整条迁移链又要从 0001 跑到 head。此处若直接 ``add_column`` 会抛
    ``duplicate column name``，整条链失败——而且失败信息指向 0050，看起来像本迁移写坏了。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'already.db'}")
    config = build_alembic_config(engine)
    previous, head = _revisions(config)
    command.upgrade(config, previous)

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE candidate_job ADD COLUMN deleted_at DATETIME"))
    _insert_candidate(engine, "legacy 候选", "https://example.com/legacy")
    # 这一行在"补列"时就已经被标成删除了：迁移不许把它当成新加的清回 NULL。
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE candidate_job SET deleted_at = '2026-02-03 04:05:06' WHERE title = 'legacy 候选'"
            )
        )

    command.upgrade(config, head)

    column = _columns(engine, "candidate_job")["deleted_at"]
    assert column["nullable"] is True
    assert _deleted_at(engine, "legacy 候选") == "2026-02-03 04:05:06"


# ===========================================================================
# QA 补充（第二轮）：把"只加列"和"降级不丢数据"钉到**列/索引/整行**的粒度。
# 上面的用例只比表名集合与四个字段，那足以发现"多加了一张表"，但发现不了
# "batch 重建后某列的类型/可空性/默认值变了"或"第 15 个列的数据掉了"。
# ===========================================================================

# 这些列得填成"看起来真"的值：SQLite 是动态类型，直接按列名给字符串也能插进去，
# 但用真日期/真 JSON 才能保证"值与列语义对得上"，不会因为写错类型而误判成迁移丢数据。
_SAMPLE_VALUES = {
    "created_at": "2026-01-02 03:04:05",
    "updated_at": "2026-01-02 03:04:05.123456",
    "status": "pending",
    "source": "手动添加",
    "images": '["a.png"]',
    "job_type": "社招",
    "salary": "30k",
    "location": "北京",
    "source_url": "https://example.com/full",
    "description": "职责：写代码",
    "requirements": "要求：会写代码",
    "additional_info": "补充",
    "note": "备注",
    "raw_text": "JD 原文",
    "company": "某公司",
    "imported_job_id": 7,
    "collect_task_id": 3,
}
# 表格列（不含主键）：用于"整行逐列比对"。
_PRIMARY_KEY = "id"


def _column_signature(engine, table: str) -> list[tuple]:
    """列签名（名字/类型/可空/默认值），顺序即物理顺序。"""
    return [
        (column["name"], str(column["type"]), column["nullable"], column["default"])
        for column in inspect(engine).get_columns(table)
    ]


def _index_signature(engine, table: str) -> list[tuple]:
    return sorted(
        (index["name"], tuple(index["column_names"] or ()), bool(index.get("unique")))
        for index in inspect(engine).get_indexes(table)
    )


def _insert_complete_candidate(engine, title: str) -> None:
    """按**当前**列集合插一条"每一列都有值"的候选。

    动态取列名而不是写死 INSERT：以后这张表再加列时，这条用例会自动把新列也覆盖到，
    不会因为"INSERT 少了字段"而变成一条只验证旧列的假绿灯。
    """
    columns = [
        column["name"]
        for column in inspect(engine).get_columns("candidate_job")
        if column["name"] != _PRIMARY_KEY
    ]
    values = {name: _SAMPLE_VALUES.get(name, "x") for name in columns}
    # 标题由调用方决定（下面几条用例要按标题回查这一行）。
    if "title" in values:
        values["title"] = title
    placeholders = ", ".join(f":{name}" for name in columns)
    with engine.begin() as connection:
        connection.execute(
            text(f"INSERT INTO candidate_job ({', '.join(columns)}) VALUES ({placeholders})"),
            values,
        )


def _full_row(engine) -> dict:
    with engine.connect() as connection:
        return dict(connection.execute(text("SELECT * FROM candidate_job")).mappings().one())


def test_upgrade_adds_exactly_one_column_and_no_index(tmp_path):
    """ "只加列"的**列级**证明：列签名 = 升级前 + ``deleted_at``，且没有其它列被改动。

    只比表名集合不够：一次"顺手把某列的 nullable 改成 False"或"给 varchar 换长度"
    在表名集合上完全看不出来，却会让旧备份导入在越界那一行上失败。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'one-column.db'}")
    config = build_alembic_config(engine)
    previous, head = _revisions(config)
    command.upgrade(config, previous)

    before_columns = _column_signature(engine, "candidate_job")
    before_indexes = _index_signature(engine, "candidate_job")

    command.upgrade(config, head)

    after_columns = _column_signature(engine, "candidate_job")
    added = [signature for signature in after_columns if signature not in before_columns]
    assert [signature[0] for signature in added] == ["deleted_at"], (
        f"0050 只该加一列，实际新增：{[signature[0] for signature in added]}"
    )
    assert added[0][1:] == ("DATETIME", True, None), "新列必须是可空、无服务端默认的 DATETIME"
    # 其余列一字未改（顺序也一致：SQLite 的 ADD COLUMN 只追加到末尾）。
    assert after_columns == [*before_columns, added[0]]
    # 不加索引：这是"只加列"的另一半（旧备份导入依赖表结构尽量不动）。
    assert _index_signature(engine, "candidate_job") == before_indexes


def test_downgrade_restores_the_old_schema_and_every_column_of_the_row(tmp_path):
    """降到 0049 后：列签名与索引集合**逐项等于**升级前，且 19 个列的数据都在。

    SQLite 的 ``drop_column`` 走 batch 模式（建新表 → 拷数据 → 改名）。拷数据那段
    是按**反射出来的列**做的，一旦某列反射不出来（JSON 列、带默认值的列都可能）就会
    静默落成默认值——那种丢数据在"只看 title/company"的断言下完全看不出来。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'schema-restore.db'}")
    config = build_alembic_config(engine)
    previous, head = _revisions(config)
    command.upgrade(config, previous)
    _insert_complete_candidate(engine, "全列候选")

    before_columns = _column_signature(engine, "candidate_job")
    before_indexes = _index_signature(engine, "candidate_job")
    before_row = _full_row(engine)
    assert before_row["images"] == '["a.png"]' and before_row["imported_job_id"] == 7

    command.upgrade(config, head)
    command.downgrade(config, previous)

    assert _column_signature(engine, "candidate_job") == before_columns
    assert _index_signature(engine, "candidate_job") == before_indexes
    assert _full_row(engine) == before_row, "降级把某一列的数据弄丢/改掉了"


def test_downgrade_keeps_a_trashed_row_instead_of_dropping_it(tmp_path):
    """降级前已在回收站里的候选：列没了，**行和其它列必须还在**。

    这是"降级要不要删掉回收站里的数据"这个问题的答案：不删。它的语义只是"旧版本不认识
    '已删除'这个状态"（于是它重新出现在列表里，见迁移的 downgrade 注释），不是"这些
    数据该被销毁"。真删了的话，用户做一次版本回退就永久损失了一批候选。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'trashed-downgrade.db'}")
    config = build_alembic_config(engine)
    previous, head = _revisions(config)
    command.upgrade(config, previous)
    _insert_complete_candidate(engine, "回收站里的候选")
    before_row = _full_row(engine)

    command.upgrade(config, head)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE candidate_job SET deleted_at = '2026-03-04 05:06:07' WHERE title = :t"),
            {"t": "回收站里的候选"},
        )
    assert _deleted_at(engine, "回收站里的候选") == "2026-03-04 05:06:07"

    command.downgrade(config, previous)

    assert "deleted_at" not in _columns(engine, "candidate_job")
    assert _full_row(engine) == before_row, "降级把已软删那一行的数据弄丢了"
