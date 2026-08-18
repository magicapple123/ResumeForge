"""SQLite 兼容升级测试。"""
from sqlalchemy import create_engine, inspect

from app.database import ensure_sqlite_columns
from app.main import SQLITE_REQUIRED_COLUMNS


def test_ensure_sqlite_columns_preserves_legacy_rows(tmp_path):
    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    try:
        with legacy_engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE job (id INTEGER PRIMARY KEY, title VARCHAR(128) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO job (id, title) VALUES (1, '算法工程师')"
            )
            connection.exec_driver_sql(
                "CREATE TABLE user_profile (id INTEGER PRIMARY KEY, name VARCHAR(64) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO user_profile (id, name) VALUES (1, '张三')"
            )
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
                "CREATE TABLE resume_record "
                "(id INTEGER PRIMARY KEY, title VARCHAR(256) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO resume_record (id, title) VALUES (1, '后端岗位简历')"
            )

        ensure_sqlite_columns(legacy_engine, SQLITE_REQUIRED_COLUMNS)
        ensure_sqlite_columns(legacy_engine, SQLITE_REQUIRED_COLUMNS)

        inspector = inspect(legacy_engine)
        assert "note" in {column["name"] for column in inspector.get_columns("job")}
        assert "photo" in {
            column["name"] for column in inspector.get_columns("user_profile")
        }
        for table_name in ("education", "experience", "campus_experience", "project"):
            column_names = {
                column["name"] for column in inspector.get_columns(table_name)
            }
            assert {"reference_file_name", "reference_content"} <= column_names
        assert {"enhancement_enabled", "enhancement_level"} <= {
            column["name"] for column in inspector.get_columns("resume_record")
        }
        with legacy_engine.connect() as connection:
            job = connection.exec_driver_sql(
                "SELECT title, note, favorite FROM job WHERE id = 1"
            ).mappings().one()
            profile = connection.exec_driver_sql(
                "SELECT name, photo, section_order FROM user_profile WHERE id = 1"
            ).mappings().one()
            education = connection.exec_driver_sql(
                "SELECT school, reference_file_name, reference_content "
                "FROM education WHERE id = 1"
            ).mappings().one()
            experience = connection.exec_driver_sql(
                "SELECT company, reference_file_name, reference_content "
                "FROM experience WHERE id = 1"
            ).mappings().one()
            campus = connection.exec_driver_sql(
                "SELECT organization, reference_file_name, reference_content "
                "FROM campus_experience WHERE id = 1"
            ).mappings().one()
            project = connection.exec_driver_sql(
                "SELECT name, reference_file_name, reference_content "
                "FROM project WHERE id = 1"
            ).mappings().one()
            resume = connection.exec_driver_sql(
                "SELECT title, enhancement_enabled, enhancement_level "
                "FROM resume_record WHERE id = 1"
            ).mappings().one()
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
