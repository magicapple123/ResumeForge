# SPDX-License-Identifier: Apache-2.0
"""迁移 0023/0024 的升级/降级往返：进度「关联链接」加列 + 回读凭据清理。

在**真实 alembic 迁移出来的库**上验，而不是 ``create_all``：后者只能证明"模型长这样"，
证明不了"列能被加出来、能被删干净、升回来还一致"，也证明不了"那些 Cookie 行真的没了"。

钉五件事：

1. 升级后 ``application_track.link`` 在、非空、默认空串，且**历史行被回填成空串**
   （不是 NULL——否则前端拿到 ``null`` 会把 ``href`` 拼成字符串 "null"）；
2. 降级把列删掉，再升回来仍然一致（不是单向门）；
3. 升级删掉 ``tracker.probe.*`` 与两条 ``login_status.*track_cookie``，**不动**别的键；
4. ``app_setting`` 表不存在时升级是空操作（迁移会跑在"只有部分业务表"的库上）；
5. 降级是 no-op：**凭据不可恢复**，不回填空行假装恢复。

**不写 revision 字面量**：head 从 ``tests.migration_refs.head_revision()`` 取，
"退到某条迁移之前"用 ``prior_revision("_add_application_track_link")`` 按名字找父版本。
"""

from __future__ import annotations

import pytest
from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect, text
from tests.migration_refs import head_revision, prior_revision

TABLE = "application_track"
COLUMN = "link"
SETTING_TABLE = "app_setting"


@pytest.fixture
def database_url(tmp_path):
    return f"sqlite:///{(tmp_path / 'track_link.db').as_posix()}"


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _setting_keys(engine) -> set[str]:
    with engine.connect() as connection:
        return {row[0] for row in connection.execute(text(f"SELECT key FROM {SETTING_TABLE}"))}  # noqa: S608


def test_upgrade_adds_the_link_column_and_backfills_existing_rows(database_url):
    """历史行必须拿到空串而不是 NULL：``link`` 从第一天起就是"空 = 没填"。"""
    engine = build_engine(database_url)
    try:
        config = build_alembic_config(engine)
        # 先退到加列之前，插一条"历史记录"，再升上来，验证回填。
        command.upgrade(config, "head")
        command.downgrade(config, prior_revision("_add_application_track_link"))
        assert COLUMN not in _columns(engine, TABLE)

        with engine.begin() as connection:
            connection.execute(
                text(
                    f"INSERT INTO {TABLE} (company, title, company_key, title_key, status, "  # noqa: S608
                    "stage_note, applied_at, status_date, next_action, next_action_date, note, "
                    "evidence, resume_title, channel, source, created_at, updated_at) VALUES "
                    "('历史公司', '历史岗位', '历史公司', '历史岗位', 'applied', '', '', '', '', "
                    "'', '', '', '', 'unknown', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )

        command.upgrade(config, "head")
        columns = _columns(engine, TABLE)
        assert COLUMN in columns, "迁移漏了 link 列"
        assert columns[COLUMN]["nullable"] is False
        with engine.connect() as connection:
            values = [row[0] for row in connection.execute(text(f"SELECT {COLUMN} FROM {TABLE}"))]  # noqa: S608
        assert values == [""], "历史行的 link 必须回填成空串"
    finally:
        engine.dispose()


def test_downgrade_drops_the_column_and_upgrade_recreates_it(database_url):
    engine = build_engine(database_url)
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        command.downgrade(config, prior_revision("_add_application_track_link"))
        assert COLUMN not in _columns(engine, TABLE)

        command.upgrade(config, "head")
        assert COLUMN in _columns(engine, TABLE)
    finally:
        engine.dispose()


def test_upgrade_removes_the_readback_credentials_and_nothing_else(database_url):
    """六个键全删，一个不相干的键都不许动（那是别人的设置）。"""
    engine = build_engine(database_url)
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, head_revision())
        # 手动退回清理迁移之前，塞进"回读时代"留下的设置行。
        command.downgrade(config, prior_revision("_remove_tracker_probe_settings"))
        with engine.begin() as connection:
            connection.execute(
                text(
                    f"INSERT INTO {SETTING_TABLE} (key, value) VALUES "  # noqa: S608
                    "('tracker.probe.enabled', 'true'),"
                    "('tracker.probe.page_url', 'https://portal.example.com/my'),"
                    "('tracker.probe.cookie', 'sessionid=SECRET'),"
                    "('tracker.probe.last_run', '2026-11-01T10:00:00'),"
                    "('login_status.track_cookie', '{\"status\":\"ok\"}'),"
                    "('login_status.probe_url.track_cookie', 'https://portal.example.com/my'),"
                    "('webform_relaxed_mode', 'true')"
                )
            )

        command.upgrade(config, head_revision())

        assert _setting_keys(engine) == {"webform_relaxed_mode"}
    finally:
        engine.dispose()


def test_upgrade_is_a_no_op_when_the_setting_table_is_missing(database_url):
    """迁移会跑在"只有部分业务表"的库上：``app_setting`` 不在时要跳过而不是报错。"""
    engine = build_engine(database_url)
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, prior_revision("_remove_tracker_probe_settings"))
        with engine.begin() as connection:
            connection.execute(text(f"DROP TABLE {SETTING_TABLE}"))  # noqa: S608

        command.upgrade(config, head_revision())  # 不抛就算过

        assert SETTING_TABLE not in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_downgrade_of_the_cleanup_is_a_no_op(database_url):
    """**凭据不可恢复**：降级不回填空行，也不试图还原任何值。"""
    engine = build_engine(database_url)
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, head_revision())
        before = _setting_keys(engine)

        command.downgrade(config, prior_revision("_remove_tracker_probe_settings"))

        assert _setting_keys(engine) == before
        assert not any(key.startswith("tracker.probe.") for key in _setting_keys(engine))
    finally:
        engine.dispose()


def test_head_is_at_least_this_migration():
    """链尾至少到本迁移（防"迁移没被 alembic 认到"这种静默失效）。

    后续迁移接在它后面是正常的（T6 的 ``0025_track_external_resume`` 就排在它之后），
    所以判据是"要么它就是 head，要么 head 的序号已经更大"——与
    ``test_migration_0022_company_research_run`` 同一写法。
    """
    assert head_revision().endswith("_remove_tracker_probe_settings") or head_revision() > "0024"
