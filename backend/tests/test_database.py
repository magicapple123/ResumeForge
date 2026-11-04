# SPDX-License-Identifier: Apache-2.0
"""SQLite 兼容升级测试。"""

from alembic import command
from app.database import Base, build_engine, ensure_sqlite_columns
from app.database_migrations import application_tables, build_alembic_config
from app.main import SQLITE_REQUIRED_COLUMNS
from sqlalchemy import create_engine, inspect
from tests.migration_refs import alembic_version_of, head_revision

# 从模型注册表取，而不是手写清单：手写清单会漏掉新表，让"迁移后的表集合"这条
# 断言悄悄变成过时的期望值（而真出问题时是用户先发现）。
_APPLICATION_TABLES = set(application_tables())
# 基线迁移的 FTS5 派生索引（虚拟表 + 四张影子表）：不在 Base.metadata 里，但迁移
# head 之后的库里必然存在；它们可由 rebuild 重建，不算业务表。
_FTS_DERIVED_TABLES = {
    "knowledge_fts",
    "knowledge_fts_data",
    "knowledge_fts_idx",
    "knowledge_fts_docsize",
    "knowledge_fts_config",
} | {
    f"search_fts_{base}{suffix}"
    for base in (
        "job",
        "resume_record",
        "referral",
        "reminder",
        "interview_experience",
        "claim_record",
        "material",
    )
    for suffix in ("", "_data", "_idx", "_docsize", "_config")
}


def _assert_head_schema(bind) -> None:
    inspector = inspect(bind)
    assert set(inspector.get_table_names()) == (
        _APPLICATION_TABLES | {"alembic_version"} | _FTS_DERIVED_TABLES
    )
    for table_name in _APPLICATION_TABLES:
        expected_columns = {column.name for column in Base.metadata.tables[table_name].columns}
        actual_columns = {column["name"] for column in inspector.get_columns(table_name)}
        assert actual_columns == expected_columns

    assert {"ix_job_status", "ix_job_created_at"} <= {
        item["name"] for item in inspector.get_indexes("job")
    }
    assert {"ix_resume_record_job_id", "ix_resume_record_created_at"} <= {
        item["name"] for item in inspector.get_indexes("resume_record")
    }
    assert any(
        item["referred_table"] == "job" and item["constrained_columns"] == ["job_id"]
        for item in inspector.get_foreign_keys("resume_record")
    )
    assert "ix_chat_conversation_updated_at" in {
        item["name"] for item in inspector.get_indexes("chat_conversation")
    }
    assert "ix_chat_conversation_surface" in {
        item["name"] for item in inspector.get_indexes("chat_conversation")
    }
    assert {"ix_chat_message_conversation_id", "ix_chat_message_created_at"} <= {
        item["name"] for item in inspector.get_indexes("chat_message")
    }
    assert any(
        item["referred_table"] == "chat_conversation"
        and item["constrained_columns"] == ["conversation_id"]
        for item in inspector.get_foreign_keys("chat_message")
    )
    assert alembic_version_of(bind) == head_revision()


def test_sqlite_engine_enables_wal_and_busy_timeout(tmp_path):
    """基于文件的引擎每个新连接都应启用 WAL 与 busy_timeout。

    conftest 的测试库本身就是文件库，但这里按生产同一路径自建引擎，
    避免依赖 conftest 的环境设置。内存库不支持 WAL，故不用内存库测。
    """
    engine = build_engine(f"sqlite:///{tmp_path / 'pragma.db'}")
    try:
        with engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
            assert connection.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
    finally:
        engine.dispose()


def test_ensure_sqlite_columns_preserves_legacy_rows(tmp_path):
    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    try:
        with legacy_engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE job (id INTEGER PRIMARY KEY, title VARCHAR(128) NOT NULL)"
            )
            connection.exec_driver_sql("INSERT INTO job (id, title) VALUES (1, '算法工程师')")
            connection.exec_driver_sql(
                "CREATE TABLE user_profile (id INTEGER PRIMARY KEY, name VARCHAR(64) NOT NULL)"
            )
            connection.exec_driver_sql("INSERT INTO user_profile (id, name) VALUES (1, '张三')")
            connection.exec_driver_sql(
                "CREATE TABLE education "
                "(id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, school VARCHAR(128) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO education (id, profile_id, school) VALUES (1, 1, '示例大学')"
            )
            connection.exec_driver_sql(
                "CREATE TABLE experience "
                "(id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, company VARCHAR(128) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO experience (id, profile_id, company) VALUES (1, 1, '示例科技')"
            )
            connection.exec_driver_sql(
                "CREATE TABLE campus_experience "
                "(id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, "
                "organization VARCHAR(128) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO campus_experience (id, profile_id, organization) "
                "VALUES (1, 1, '学生会')"
            )
            connection.exec_driver_sql(
                "CREATE TABLE project "
                "(id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, name VARCHAR(128) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO project (id, profile_id, name) VALUES (1, 1, '简历通')"
            )
            connection.exec_driver_sql(
                "CREATE TABLE resume_record (id INTEGER PRIMARY KEY, title VARCHAR(256) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO resume_record (id, title) VALUES (1, '后端岗位简历')"
            )

        ensure_sqlite_columns(legacy_engine, SQLITE_REQUIRED_COLUMNS)
        ensure_sqlite_columns(legacy_engine, SQLITE_REQUIRED_COLUMNS)

        inspector = inspect(legacy_engine)
        assert "note" in {column["name"] for column in inspector.get_columns("job")}
        assert "photo" in {column["name"] for column in inspector.get_columns("user_profile")}
        for table_name in ("education", "experience", "campus_experience", "project"):
            column_names = {column["name"] for column in inspector.get_columns(table_name)}
            assert {"reference_file_name", "reference_content"} <= column_names
        assert {"enhancement_enabled", "enhancement_level"} <= {
            column["name"] for column in inspector.get_columns("resume_record")
        }
        with legacy_engine.connect() as connection:
            job = (
                connection.exec_driver_sql("SELECT title, note, favorite FROM job WHERE id = 1")
                .mappings()
                .one()
            )
            profile = (
                connection.exec_driver_sql(
                    "SELECT name, photo, section_order FROM user_profile WHERE id = 1"
                )
                .mappings()
                .one()
            )
            education = (
                connection.exec_driver_sql(
                    "SELECT school, reference_file_name, reference_content "
                    "FROM education WHERE id = 1"
                )
                .mappings()
                .one()
            )
            experience = (
                connection.exec_driver_sql(
                    "SELECT company, reference_file_name, reference_content "
                    "FROM experience WHERE id = 1"
                )
                .mappings()
                .one()
            )
            campus = (
                connection.exec_driver_sql(
                    "SELECT organization, reference_file_name, reference_content "
                    "FROM campus_experience WHERE id = 1"
                )
                .mappings()
                .one()
            )
            project = (
                connection.exec_driver_sql(
                    "SELECT name, reference_file_name, reference_content FROM project WHERE id = 1"
                )
                .mappings()
                .one()
            )
            resume = (
                connection.exec_driver_sql(
                    "SELECT title, enhancement_enabled, enhancement_level "
                    "FROM resume_record WHERE id = 1"
                )
                .mappings()
                .one()
            )
        assert dict(job) == {"title": "算法工程师", "note": "", "favorite": 0}
        assert dict(profile) == {"name": "张三", "photo": "", "section_order": "[]"}
        assert dict(education) == {
            "school": "示例大学",
            "reference_file_name": "",
            "reference_content": "",
        }
        assert dict(experience) == {
            "company": "示例科技",
            "reference_file_name": "",
            "reference_content": "",
        }
        assert dict(campus) == {
            "organization": "学生会",
            "reference_file_name": "",
            "reference_content": "",
        }
        assert dict(project) == {
            "name": "简历通",
            "reference_file_name": "",
            "reference_content": "",
        }
        assert dict(resume) == {
            "title": "后端岗位简历",
            "enhancement_enabled": 0,
            "enhancement_level": "balanced",
        }
    finally:
        legacy_engine.dispose()


def test_alembic_upgrade_head_builds_schema_from_empty_database(tmp_path):
    empty_engine = create_engine(f"sqlite:///{tmp_path / 'alembic-empty.db'}")
    try:
        command.upgrade(build_alembic_config(empty_engine), "head")

        _assert_head_schema(empty_engine)
    finally:
        empty_engine.dispose()



