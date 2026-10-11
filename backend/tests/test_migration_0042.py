"""0042：岗位「来源」从备注拆成独立列 ``job.origin_source``。"""

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0041_track_channel_and_events"
HEAD_REVISION = "0042_job_origin_source"
COLUMN = "origin_source"


def _columns(engine, table: str) -> set[str]:
    return {item["name"] for item in inspect(engine).get_columns(table)}


def _seed_job(connection, *, title: str, note: str, recognition: str = "") -> None:
    connection.execute(
        text(
            "INSERT INTO job (title, company, location, salary, job_type, description, "
            "requirements, keywords, source, source_url, posted_at, status, note, favorite, "
            "recognition_source, created_at, updated_at) "
            "VALUES (:title, '', '', '', '校招', '', '', '[]', '手动添加', '', '', '开放中', "
            ":note, 0, :recognition, '2026-10-11', '2026-10-11')"
        ),
        {"title": title, "note": note, "recognition": recognition},
    )


def test_upgrade_moves_trailing_marker_into_the_new_column(tmp_path):
    """备注末尾的「来源：…」行迁进新列，正文不再含标记；用户正文原样保留。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'origin.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        _seed_job(
            connection,
            title="带标记的岗位",
            note="猎头推荐，先聊聊\n来源：岗位采集",
            recognition="岗位采集",
        )
        _seed_job(connection, title="空备注岗位", note="", recognition="手动填写")
        _seed_job(connection, title="自然语句岗位", note="来源是朋友转发的招聘信息")
        _seed_job(connection, title="已有正文标记", note="来源：官网采集\n来源：官网采集")
        _seed_job(
            connection, title="纯标记无正文", note="来源：粘贴文本识别", recognition="粘贴文本识别"
        )

    command.upgrade(config, HEAD_REVISION)
    assert COLUMN in _columns(engine, "job")

    with engine.connect() as connection:
        rows = connection.execute(
            text(f"SELECT title, note, {COLUMN} FROM job ORDER BY id")
        ).fetchall()
    by_title = {row[0]: (row[1], row[2]) for row in rows}

    # 末尾标记行被迁走：来源进新列，备注只剩用户正文。
    assert by_title["带标记的岗位"] == ("猎头推荐，先聊聊", "岗位采集")
    # 空备注：没有标记可迁，来源列保持空（create 路径此后自动继承，迁移不猜）。
    assert by_title["空备注岗位"] == ("", "")
    # 用户自己写的自然语句不是标记，不动。
    assert by_title["自然语句岗位"] == ("来源是朋友转发的招聘信息", "")
    # 只有**末尾**一行算自动追加的形态：正文中间的历史标记保留在备注里，不越权改写。
    body, origin = by_title["已有正文标记"]
    assert origin == "官网采集"
    assert body == "来源：官网采集"
    # 空备注保存时的历史形态：整条备注就是单独一行标记——来源迁走，备注清空。
    assert by_title["纯标记无正文"] == ("", "粘贴文本识别")


def test_upgrade_is_idempotent_when_column_already_exists(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idem.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    # 再跑一遍（列已存在）不该抛，也不该重复改数据。
    command.upgrade(config, HEAD_REVISION)
    assert COLUMN in _columns(engine, "job")


def test_downgrade_drops_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'origin-down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)
    assert COLUMN not in _columns(engine, "job")
