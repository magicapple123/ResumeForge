"""``0029_education_cet_scores`` 迁移：给教育经历加四六级分数两列。

这两列放教育经历而不是基本信息，是因为成绩是**某段学历期间**考出来的（用户的要求也是
"把四六级分数放到教育经历里面"）。网申表单普遍问具体分数——不少系统按分数自动筛，
只填"已通过"过不了。

**只加列**，所以要点与 ``0026`` 同：幂等、可降级、能跑在"只有部分列"的历史库上，
存量行靠 ``server_default`` 拿到空串。
"""
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0028_web_form_profile"
HEAD_REVISION = "0029_education_cet_scores"

TABLE = "education"
NEW_COLUMNS: tuple[str, ...] = ("cet4_score", "cet6_score")


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _default_of(column: dict) -> str | None:
    raw = column.get("default")
    if raw is None:
        return None
    text_value = str(raw).strip()
    if text_value.startswith("'") and text_value.endswith("'"):
        text_value = text_value[1:-1]
    return text_value


def test_upgrade_adds_the_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'add.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, PREVIOUS_REVISION)
    for column in NEW_COLUMNS:
        assert column not in _columns(engine, TABLE), f"前置条件：还不该有 {column}"

    command.upgrade(config, HEAD_REVISION)

    columns = _columns(engine, TABLE)
    for column in NEW_COLUMNS:
        assert column in columns, f"{TABLE}.{column} 没有被建出来"
        # 非空 + 空串默认：存量行要有值，否则旧备份升级时读不出来。
        assert columns[column]["nullable"] is False
        assert _default_of(columns[column]) == ""


def test_upgrade_is_idempotent_when_already_applied(tmp_path):
    """重复跑不该报错——迁移链会跑在已经到 head 的库上。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'again.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)

    columns = _columns(engine, TABLE)
    for column in NEW_COLUMNS:
        assert column in columns


def test_upgrade_works_when_the_columns_already_exist(tmp_path):
    """列已经存在时也必须安然通过。

    真实来历：开发机上手工补过列之后，迁移再跑一次撞上"重复列"会直接炸——这正是
    ``0025``/``0026`` 那两次事故的形态（见 ``test_migration_0026`` 的说明）。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE education ADD COLUMN cet4_score VARCHAR(16)"))
        connection.execute(text("ALTER TABLE education ADD COLUMN cet6_score VARCHAR(16)"))

    command.upgrade(config, HEAD_REVISION)

    columns = _columns(engine, TABLE)
    for column in NEW_COLUMNS:
        assert column in columns


def test_existing_rows_are_readable_after_upgrade(tmp_path):
    """存量行升级后能原样读出来，且新列是空串——旧备份升到 head 的形态。

    用 SQL 插一行、跑升级、再用 SQL 读（不走 ORM：ORM 认的是**当前** schema，
    而这里要验的正是"旧 schema 的行升上来之后长什么样"）。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'rows.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    # 旧 schema 下的最小一行：列清单从实际表结构取，避免手写遗漏 NOT NULL 列。
    with engine.begin() as connection:
        existing = [c["name"] for c in inspect(engine).get_columns(TABLE) if c["name"] != "id"]
        fillable = sorted(existing)
        placeholders = ", ".join("?" for _ in fillable)
        values = [1 if name == "profile_id" else "" for name in fillable]
        connection.exec_driver_sql(
            f"INSERT INTO {TABLE} ({', '.join(fillable)}) VALUES ({placeholders})",
            tuple(values),
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.connect() as connection:
        row = connection.execute(text("SELECT school, cet4_score, cet6_score FROM education")).one()
    assert row[0] == ""
    assert row[1] == "" and row[2] == ""
    assert row[1] is not None and row[2] is not None


def test_downgrade_removes_both_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    columns = _columns(engine, TABLE)
    for column in NEW_COLUMNS:
        assert column not in columns


def test_head_table_set_matches_the_models(tmp_path):
    """head 的表集合必须与 ``Base.metadata`` 完全一致。"""
    from app import models  # noqa: F401 - 确保全部模型注册到 Base.metadata
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'head.db'}")
    command.upgrade(build_alembic_config(engine), "head")

    tables = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert tables == set(Base.metadata.tables)
