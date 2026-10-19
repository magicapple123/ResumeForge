"""v0.18.0 → 1.0.0 的整条升级链（0039～0046）在**一份合成旧库**上逐项验证。

发布标签 ``v0.18.0`` 的 schema 就是 ``0038_user_files``（八个新迁移全部在标签之后
加入，且没有改动任何已发布迁移——见 ``git diff --stat v0.18.0 HEAD -- backend/migrations``）。
单条迁移各自的测试（``test_migration_00XX.py``）只证明"这一步没坏"，证明不了
"从一个真实老库一路升上来还活着"：老库里有数据、有旧列、有旧版本的取值，
后续迁移的**回填**（0042 把 ``job.note`` 里尾部的「来源：x」拆到独立列）与**跳过**
（0044/0046 在缺表/缺列时按域跳过）只有连起来跑才会暴露问题。

本文件在一个临时 SQLite 文件上：

1. 升到 ``0038_user_files``（= v0.18.0 的形态），灌入合成数据（含 0042 要拆分的
   旧格式备注、0044 要索引的知识库条目、0040 会加列的简历与进度）；
2. 升到 head，逐项断言：**既有行的关键字段一字未改**、新列/新表就位、0042 的回填
   按预期发生、两代 FTS 派生索引建立且可检索；
3. 降级回 ``0038_user_files``（再升回来），确认可支持的降级路径可用、数据行仍在。

合成数据，不读任何真实库；引擎与文件都在 ``tmp_path`` 下。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

BASE_REVISION = "0038_user_files"
HEAD_REVISION = "0048_job_analysis_cache"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _business_tables(engine) -> set[str]:
    """业务表集合（派生索引不算 schema 变更，与 test_migration_0046 同一口径）。"""
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _count(engine, table: str) -> int:
    with engine.connect() as connection:
        return connection.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()


def _insert_row(connection, table: str, **values) -> None:
    """插一行，其余 NOT NULL 且无默认值的列按类型补中性值。

    合成旧库只需要一小撮列有真实取值；把"剩下的必填列"交给这里，用例不会因为某张
    表又加了一个 NOT NULL 列而变成"测试写错"，也不会悄悄漏插一行。
    """
    for _cid, name, column_type, notnull, default, primary_key in connection.execute(
        text(f'PRAGMA table_info("{table}")')
    ).all():
        if name in values or not notnull or default is not None or primary_key:
            continue
        values[name] = 0 if "INT" in (column_type or "").upper() else "2026-08-01 00:00:00"
    columns = ", ".join(f'"{name}"' for name in values)
    placeholders = ", ".join(f":{name}" for name in values)
    connection.execute(text(f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})'), values)


def _seed_v018_database(engine) -> None:
    """一份 v0.18.0 形态的合成旧库：旧格式备注、简历、知识库条目、进度、台账。"""
    with engine.begin() as connection:
        _insert_row(
            connection,
            "job",
            title="后端开发",
            company="示例科技",
            location="北京",
            description="负责服务端",
            # 旧版本把来源混写在备注里的格式：0042 要把它拆到独立列。
            note="内推的机会\n来源：BOSS直聘",
            created_at="2026-08-01 10:00:00",
        )
        _insert_row(
            connection,
            "job",
            title="前端开发",
            company="示例科技",
            note="无来源行",
            created_at="2026-08-02 10:00:00",
        )
        _insert_row(
            connection,
            "resume_record",
            title="后端简历",
            job_title="后端开发",
            company="示例科技",
            content='{"name": "张三"}',
            created_at="2026-08-03 10:00:00",
        )
        _insert_row(
            connection,
            "knowledge_entry",
            title="面试笔记",
            content="trigram 子串检索的样例正文",
            category="技术笔记",
            created_at="2026-08-04 10:00:00",
            updated_at="2026-08-04 10:00:00",
        )
        _insert_row(
            connection,
            "claim_record",
            title="主导检索平台",
            subject="简历通",
            category="项目经历",
            created_at="2026-08-05 10:00:00",
            updated_at="2026-08-05 10:00:00",
        )
        _insert_row(
            connection,
            "application_track",
            company="示例科技",
            title="后端开发",
            status="已投递",
            created_at="2026-08-06 10:00:00",
        )


def test_full_upgrade_chain_from_v018_keeps_data_and_adds_new_schema(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'chain.db'}")
    try:
        config = build_alembic_config(engine)
        command.upgrade(config, BASE_REVISION)
        _seed_v018_database(engine)

        tables_before = _business_tables(engine)
        counts_before = {
            table: _count(engine, table)
            for table in (
                "job",
                "resume_record",
                "knowledge_entry",
                "claim_record",
                "application_track",
            )
        }

        command.upgrade(config, HEAD_REVISION)

        # 1) 业务行一行不少（迁移只加表/加列，绝不搬业务行）。
        for table, expected in counts_before.items():
            assert _count(engine, table) == expected, f"{table} 的行数在升级后变了"

        # 2) 既有内容没被改写：升级前的两行岗位标题与描述原样可读。
        with engine.connect() as connection:
            rows = connection.execute(text("SELECT title, description FROM job ORDER BY id")).all()
        assert rows[0][0] == "后端开发" and rows[0][1] == "负责服务端"

        # 3) 0042 的回填按预期发生：旧格式备注里的「来源：x」被拆到 origin_source，
        #    note 里不再保留那一行；没有来源行的岗位保持原样、新列为空。
        with engine.connect() as connection:
            job_rows = connection.execute(
                text("SELECT title, note, origin_source FROM job ORDER BY id")
            ).all()
        assert job_rows[0][1].strip() == "内推的机会"
        assert job_rows[0][2] == "BOSS直聘"
        assert job_rows[1][1] == "无来源行"
        assert job_rows[1][2] in (None, "")

        # 4) 新表与新列就位（抽各迁移的代表项）。
        tables_after = _business_tables(engine)
        assert "resume_delivery_record" in tables_after - tables_before  # 0040
        assert "application_track_event" in tables_after - tables_before  # 0041
        columns = {column["name"] for column in inspect(engine).get_columns("resume_record")}
        assert "fact_annotations" in columns  # 0039
        assert "parent_revision_id" in columns  # 0040
        delivery_columns = {
            column["name"] for column in inspect(engine).get_columns("resume_delivery_record")
        }
        assert {
            "source_content_sha256",
            "artifact_sha256",
            "request_params",
            "idempotency_key",
        } <= (delivery_columns)  # 0045

        # 5) 两代 FTS 派生索引都建好了，且对**升级前就存在的行**可检索
        #    （rebuild 把历史行全部入索引——这正是"升级后搜不到老数据"的防线）。
        fts_tables = {
            name for name in inspect(engine).get_table_names() if name.startswith(_FTS_PREFIXES)
        }
        assert "knowledge_fts" in fts_tables  # 0044
        assert "search_fts_job" in fts_tables  # 0046
        with engine.connect() as connection:
            knowledge_hits = connection.execute(
                text("SELECT COUNT(*) FROM knowledge_fts WHERE knowledge_fts MATCH '\"子串检索\"'")
            ).scalar_one()
            job_hits = connection.execute(
                text(
                    "SELECT COUNT(*) FROM search_fts_job WHERE search_fts_job MATCH '\"示例科技\"'"
                )
            ).scalar_one()
        assert knowledge_hits == 1, "升级前写入的知识库条目必须能被 FTS 检索到"
        assert job_hits == 2, "升级前写入的岗位必须能被 FTS 检索到"

        # 6) 可支持的降级：一路降回 v0.18.0 的 revision，业务行仍在。
        command.downgrade(config, BASE_REVISION)
        for table, expected in counts_before.items():
            assert _count(engine, table) == expected, f"{table} 的行数在降级后变了"
        assert _business_tables(engine) == tables_before

        # 7) 再升一次（降级后重升是回滚演练的常见路径）。
        command.upgrade(config, HEAD_REVISION)
        for table, expected in counts_before.items():
            assert _count(engine, table) == expected
    finally:
        engine.dispose()
