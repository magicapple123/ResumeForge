# SPDX-License-Identifier: Apache-2.0
"""本期三条增量迁移的 round-trip 与约束语义（T01 / T08 / T10 数据层）。

覆盖三件事，全部在**真实 alembic 迁移出来的库**上验，而不是 ``create_all``：

1. **往返可用**：空库 ``upgrade head`` → ``downgrade -1`` × 5（0006–0010，
   波次 2 的 0009/0010 也在链上）→ ``upgrade head``，两次都成功；中间态三处新结构确实
   消失，复原后列/表/索引都在。
2. **旧语义零破坏**：agent_task 既有的提醒去重键仍生效；新去重键按
   (source, source_ref, occurrence_key) 生效，且两列为 NULL 的旧行照旧并存。
3. **新表约束**：job_preference 的活动行 partial unique index / CHECK / pref_id 唯一；
   application_follow_up 的 decision CHECK 与 track 外键级联。

**测试里不写 revision 字面量**（迁移链再长一条就会集体过期）：head 从
``tests.migration_refs.head_revision()`` 取，降级只数步数，不点名具体版本。
"""

from __future__ import annotations

from datetime import datetime

import pytest
from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from app.models.agent_task import (
    AGENT_TASK_SOURCE_FOLLOWUP,
    AGENT_TASK_SOURCE_REMINDER,
    AgentTask,
)
from app.models.followup import FOLLOWUP_DECISION_CONTACTED, ApplicationFollowUp
from app.models.job_preference import (
    PREF_SOURCE_USER_EDITED,
    PREF_STATE_ACTIVE,
    PREF_STATE_SUPERSEDED,
    JobPreference,
)
from app.models.profile import utcnow
from app.models.tracker import ApplicationTrack
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from tests.migration_refs import alembic_version_of, head_revision


@pytest.fixture
def migrated(tmp_path):
    """空库升到 head 的引擎；每个用例一个独立库文件。

    用 ``build_engine`` 而不是裸 ``create_engine``：生产连接会开 **foreign_keys=ON**，
    级联删除用例必须在同一条 PRAGMA 下验，否则测试通过而真实库不级联。
    """
    engine = build_engine(f"sqlite:///{(tmp_path / 'migrated.db').as_posix()}")
    command.upgrade(build_alembic_config(engine), "head")
    try:
        yield engine
    finally:
        engine.dispose()


def _table_names(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _column_names(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def _index_names(engine, table: str) -> set[str]:
    return {index["name"] for index in inspect(engine).get_indexes(table)}


def _assert_new_structures(engine) -> None:
    """三处新结构逐个点名：agent_task 两列 + 唯一索引 / 决策表 + 索引 / 偏好表。"""
    assert {"source_ref", "occurrence_key"} <= _column_names(engine, "agent_task")
    assert "uq_agent_task_source_occurrence" in _index_names(engine, "agent_task")

    assert "application_follow_up" in _table_names(engine)
    assert {
        "id",
        "track_id",
        "decided_at",
        "decision",
        "draft_text",
        "note",
        "task_id",
        "created_at",
    } <= _column_names(engine, "application_follow_up")
    assert "ix_application_follow_up_track_decided" in _index_names(engine, "application_follow_up")

    assert "receipt_acked_at" in _column_names(engine, "apply_task_item")

    assert "job_preference" in _table_names(engine)
    assert {
        "id",
        "pref_id",
        "dataset_key",
        "kind",
        "value_kind",
        "value",
        "value_digest",
        "value_schema",
        "source",
        "source_proposal_id",
        "source_message_id",
        "note",
        "state",
        "deleted_at",
        "created_at",
        "updated_at",
    } <= _column_names(engine, "job_preference")
    assert {
        "ix_job_preference_dataset_key",
        "ix_job_preference_kind_state",
        "ux_job_preference_active_kind",
    } <= _index_names(engine, "job_preference")


def test_upgrade_downgrade_round_trip(tmp_path):
    """空库往返：升到 head、连退到 0005（0006–0010 五条）、再升回 head，两次都成功。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'roundtrip.db').as_posix()}")
    config = build_alembic_config(engine)
    head = head_revision()
    try:
        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head
        _assert_new_structures(engine)

        # 等价于 downgrade -1 五次：0006–0010 五条迁移都真的能退。
        for _ in range(5):
            command.downgrade(config, "-1")
        assert alembic_version_of(engine) != head
        assert {"source_ref", "occurrence_key"}.isdisjoint(_column_names(engine, "agent_task"))
        assert "application_follow_up" not in _table_names(engine)
        assert "receipt_acked_at" not in _column_names(engine, "apply_task_item")
        assert "job_preference" not in _table_names(engine)

        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head
        _assert_new_structures(engine)
    finally:
        engine.dispose()


def test_partial_unique_index_really_carries_its_where_clause(migrated):
    """活动行唯一性确实来自 partial index（WHERE ...），不是一张普通唯一索引。

    只断言索引名存在证明不了条件；``sqlite_master`` 里的原始 SQL 才说明"软删/历史版本
    行不占位"这条语义真的落了库。
    """
    with migrated.connect() as connection:
        sql = connection.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type = 'index' "
            "AND name = 'ux_job_preference_active_kind'"
        ).scalar_one()
    assert "WHERE" in sql
    assert "state = 'active'" in sql
    assert "deleted_at IS NULL" in sql


def _task(**overrides) -> AgentTask:
    defaults = {
        "title": "跟进卡",
        "source": AGENT_TASK_SOURCE_FOLLOWUP,
        "source_ref": "stalled_followup",
        "occurrence_key": "2026-W45",
    }
    defaults.update(overrides)
    return AgentTask(**defaults)


def test_reminder_occurrence_dedupe_is_unchanged(migrated):
    """旧去重键仍生效：同一提醒同一到期时刻重复插必须报 IntegrityError。"""
    with Session(migrated) as session:
        session.add(
            AgentTask(
                title="提醒卡",
                source=AGENT_TASK_SOURCE_REMINDER,
                reminder_id=7,
                occurrence_due_at=datetime(2026, 11, 9, 8, 0),
            )
        )
        session.commit()
        session.add(
            AgentTask(
                title="重复的提醒卡",
                source=AGENT_TASK_SOURCE_REMINDER,
                reminder_id=7,
                occurrence_due_at=datetime(2026, 11, 9, 8, 0),
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_source_occurrence_dedupe_is_per_bucket_and_week(migrated):
    """新去重键：同桶同周冲突；换桶或换周都允许；两列为 NULL 的多行并存。"""
    with Session(migrated) as session:
        session.add_all(
            [
                _task(source_ref="stalled_followup", occurrence_key="2026-W45"),
                _task(source_ref="stalled_confirm", occurrence_key="2026-W45"),
                _task(source_ref="stalled_followup", occurrence_key="2026-W46"),
                AgentTask(title="手动卡一"),
                AgentTask(title="手动卡二"),
            ]
        )
        session.commit()
        assert session.query(AgentTask).count() == 5

        session.add(_task(source_ref="stalled_followup", occurrence_key="2026-W45"))
        with pytest.raises(IntegrityError):
            session.commit()


def _pref(**overrides) -> JobPreference:
    defaults = {
        "pref_id": "p1",
        "dataset_key": "main",
        "kind": "target_city",
        "value_kind": "list",
        "value": ["杭州"],
        "value_digest": "d1",
        "source": PREF_SOURCE_USER_EDITED,
        "state": PREF_STATE_ACTIVE,
    }
    defaults.update(overrides)
    return JobPreference(**defaults)


def test_only_one_active_preference_per_dataset_and_kind(migrated):
    """同 dataset_key + kind 的活动行只能有一条（partial unique index 生效）。"""
    with Session(migrated) as session:
        session.add(_pref())
        session.commit()
        session.add(_pref(pref_id="p2", value_digest="d2"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_superseded_and_deleted_rows_do_not_occupy_the_active_slot(migrated):
    """历史版本（superseded）与回收站行（deleted_at 非空）都能与活动行并存。"""
    with Session(migrated) as session:
        session.add(_pref(pref_id="p-active"))
        session.commit()
        session.add(_pref(pref_id="p-old", state=PREF_STATE_SUPERSEDED))
        session.add(_pref(pref_id="p-trashed", deleted_at=utcnow()))
        session.commit()
        assert session.query(JobPreference).count() == 3


@pytest.mark.parametrize(
    ("field", "value"),
    [("state", "deleted"), ("source", "assistant"), ("value_kind", "object")],
)
def test_check_constraints_reject_protocol_values(migrated, field, value):
    """三个 CHECK 都在数据库层拒绝闭集外的值（绕过服务层直接写库也拦得住）。"""
    with Session(migrated) as session:
        session.add(_pref(**{field: value}))
        with pytest.raises(IntegrityError):
            session.commit()


def test_pref_id_is_unique(migrated):
    """pref_id 是外部稳定 id：换 kind 也不能重复（unique constraint）。"""
    with Session(migrated) as session:
        session.add(_pref())
        session.commit()
        session.add(_pref(kind="work_mode", value_kind="scalar", value={"mode": "remote"}))
        with pytest.raises(IntegrityError):
            session.commit()


def test_follow_up_decision_check_rejects_unknown_value(migrated):
    """decision 是封闭三值集，库层 CHECK 拒绝自造的第四种决策。"""
    with Session(migrated) as session:
        track = ApplicationTrack(company="某公司", title="后端工程师")
        session.add(track)
        session.flush()
        session.add(
            ApplicationFollowUp(
                track_id=track.id,
                decided_at=datetime(2026, 11, 9, 8, 0),
                decision="maybe",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_follow_up_is_cascaded_when_its_track_is_purged(migrated):
    """track 彻底删除 → 决策行跟着删（ON DELETE CASCADE，真实外键开启）。"""
    with Session(migrated) as session:
        track = ApplicationTrack(company="某公司", title="后端工程师")
        session.add(track)
        session.flush()
        session.add(
            ApplicationFollowUp(
                track_id=track.id,
                decided_at=datetime(2026, 11, 9, 8, 0),
                decision=FOLLOWUP_DECISION_CONTACTED,
                note="电话聊过",
            )
        )
        session.commit()
        assert session.query(ApplicationFollowUp).count() == 1

        session.delete(track)
        session.commit()
        assert session.query(ApplicationFollowUp).count() == 0
