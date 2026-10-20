# SPDX-License-Identifier: Apache-2.0
"""RF-19 失败分类收紧与投递链路诊断事件的离线测试。

覆盖三件事：
1. ``profile_insufficient`` / ``unconfirmed`` 两个新分类的落库与熔断语义
   （都**不计入**连续失败——前者是软跳过，后者页面可能已投出去，重试反而重复投递）；
2. 前端 ``failures.ts`` 是后端 ``FAILURE_CATEGORY_LABELS`` 的手工镜像，加守卫防它落后；
3. ``apply.step`` 诊断事件：带 task_id 串联、字段收敛、绝无资料值。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from app.models.apply import ApplyTask, ApplyTaskItem
from app.services.apply import task_apply, task_config
from app.services.sites.base import ApplyOutcome
from app.services.sites.boss import BossAdapter
from test_apply_task_runner import (
    FakeAdapter,
    _config,
    _item_statuses,
    _runner,
    _setup_task,
    _task_status,
    _wait,
    _wait_db,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FAILURES_TS = REPO_ROOT / "frontend" / "src" / "types" / "apply" / "failures.ts"


class UnconfirmingAdapter(FakeAdapter):
    """动手了但读不到成功凭据的适配器：outcome.success=False，不抛异常。"""

    def fill_and_submit(self, client, data, greeting) -> ApplyOutcome:
        self.calls += 1
        return ApplyOutcome(success=False, greeting_sent=greeting)


# ===== profile_insufficient：软跳过，不计失败、不触发熔断 =====


def test_missing_resume_is_skipped_with_the_profile_insufficient_category(db_session):
    task = _setup_task(db_session, 2, with_resume=False)
    adapter = FakeAdapter()
    runner = _runner(adapter)

    runner.start(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "任务状态")

    db_session.expire_all()
    assert _item_statuses(db_session, task.id) == ["skipped", "skipped"]
    for item in db_session.query(ApplyTaskItem).filter_by(task_id=task.id).all():
        assert item.failure_category == "profile_insufficient"
    stored = db_session.get(ApplyTask, task.id)
    assert stored.failed == 0
    assert stored.skipped == 2
    assert adapter.calls == 0


# ===== unconfirmed：记失败但不计入连续失败熔断 =====


def test_unconfirmed_never_claims_success_and_never_trips_the_breaker(db_session):
    """连续 3 次「无法确认」超过默认熔断阈值（3）也不暂停：重试可能重复投递。"""
    task = _setup_task(db_session, 3)
    runner = _runner(UnconfirmingAdapter())

    runner.start(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "任务状态")

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "completed", "unconfirmed 不触发熔断，批次应跑完而不是暂停"
    assert _item_statuses(db_session, task.id) == ["failed", "failed", "failed"]
    for item in db_session.query(ApplyTaskItem).filter_by(task_id=task.id).all():
        assert item.failure_category == "unconfirmed"


def test_unconfirmed_still_counts_as_a_failed_item(db_session):
    """不计熔断 ≠ 记成功：条目必须是 failed + 分类 unconfirmed。"""
    task = _setup_task(db_session, 1)
    runner = _runner(UnconfirmingAdapter())

    runner.start(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "任务状态")

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.failed == 1
    assert stored.succeeded == 0


def test_a_real_site_failure_still_counts_toward_the_breaker(db_session):
    """收紧不能顺手放宽：selector_invalid 连续 3 次仍要熔断（既有语义钉住）。"""
    task = _setup_task(db_session, 3)
    runner = _runner(FakeAdapter(fail_categories=["selector_invalid"]))

    runner.start(task.id)
    _wait(runner)
    _wait_db(
        db_session,
        lambda: _task_status(db_session, task.id),
        "breaker_paused",
        "任务状态",
    )
    # 熔断暂停后工作线程还阻塞在「等恢复」里，dataset 租约也未归还——必须显式
    # stop 并等线程退出，否则这份泄漏的租约会把本文件之后的所有 dataset_scope /
    # runner 用例打成 409（全量串行下 26 个连带失败，隔离跑却全绿）。
    runner.stop(task.id)
    _wait(runner)


# ===== 前端镜像守卫（failures.ts 是手工镜像，落后即红） =====


def test_frontend_failures_mirror_contains_the_new_categories():
    text = FAILURES_TS.read_text(encoding="utf-8")
    assert '"profile_insufficient"' in text
    assert '"unconfirmed"' in text
    assert "资料不足，需要先补充简历/网申资料" in text
    assert "无法确认投递结果，请到浏览器核对" in text


def test_frontend_failures_mirror_covers_every_backend_category():
    from app.models.apply import FAILURE_CATEGORY_LABELS

    text = FAILURES_TS.read_text(encoding="utf-8")
    for category in FAILURE_CATEGORY_LABELS:
        assert f'"{category}"' in text, f"failures.ts 缺少后端分类 {category}"


# ===== 适配器版本与 task.config 快照 =====


def test_boss_adapter_declares_version_one():
    assert BossAdapter.version == "1"


def test_adapter_base_defaults_to_unversioned():
    assert FakeAdapter.version == "0"


def test_run_apply_snapshots_the_adapter_into_task_config(db_session):
    task = _setup_task(db_session, 1)
    runner = _runner(FakeAdapter())

    runner.start(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "任务状态")

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.config["adapter"] == {"key": "fake", "version": "0"}


def test_load_config_ignores_the_runtime_adapter_snapshot():
    """adapter 快照不是用户配置：extra="forbid" 的 ApplyConfigIn 必须忽略它而不是退回默认。"""
    from app.schemas.apply import ApplyConfigIn

    task = ApplyTask(
        kind="apply",
        status="pending",
        total=0,
        config={**_config(breaker_threshold=5).model_dump(), "adapter": {"key": "boss", "version": "1"}},
    )
    loaded = task_config.load_config(task, ApplyConfigIn, ignore=("adapter",))
    assert loaded.breaker_threshold == 5


# ===== apply.step 诊断事件 =====


@pytest.fixture
def step_events(monkeypatch):
    from app.services import diagnostics

    events: list[dict] = []
    original = diagnostics.record_event
    monkeypatch.setattr(
        diagnostics, "record_event", lambda event, **details: events.append({"event": event, **details})
    )
    yield events
    monkeypatch.setattr(diagnostics, "record_event", original)


def test_apply_step_events_are_recorded_with_task_and_item_ids(db_session, step_events):
    task = _setup_task(db_session, 1)
    runner = _runner(FakeAdapter())

    runner.start(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "任务状态")

    db_session.expire_all()
    item = db_session.query(ApplyTaskItem).filter_by(task_id=task.id).one()
    steps = [event for event in step_events if event["event"] == "apply.step"]
    assert [event["step"] for event in steps] == ["opening", "filling", "submitting", "verifying"]
    for event in steps:
        assert event["task_id"] == task.id
        assert event["item_id"] == item.id
        assert event["site_key"] == "fake"
        assert event["adapter_version"] == "0"
        assert isinstance(event["elapsed_ms"], int)


def test_apply_step_events_never_carry_profile_values(db_session, step_events):
    """仿 test_prompt_never_contains_any_profile_value：事件里不得出现招呼语或资料值。"""
    from app.models.profile import UserProfile

    GREETING_SENTINEL = "SENTINEL_GREETING_请勿外传"
    task = _setup_task(db_session, 1)
    item = db_session.query(ApplyTaskItem).filter_by(task_id=task.id).one()
    item.greeting = GREETING_SENTINEL
    db_session.add(
        UserProfile(
            name="SENTINEL_NAME",
            phone="13800000000",
            email="sentinel@example.com",
            summary="SENTINEL_SUMMARY",
        )
    )
    db_session.commit()
    runner = _runner(FakeAdapter())

    runner.start(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "任务状态")

    serialized = json.dumps(step_events, ensure_ascii=False, default=str)
    for sentinel in (GREETING_SENTINEL, "SENTINEL_NAME", "SENTINEL_SUMMARY", "13800000000", "sentinel@example.com"):
        assert sentinel not in serialized, f"诊断事件泄漏了资料值：{sentinel}"
    assert all(event["event"] != "greeting" for event in step_events)


def test_record_step_helper_has_a_closed_field_set():
    """钉住事件字段：加字段可以，但必须是有意的——不允许顺手把 payload 塞进来。"""
    import inspect

    params = list(inspect.signature(task_apply.record_step).parameters)
    assert params == ["task", "item", "step", "site_key", "adapter_version", "since"]


def test_unconfirmed_failure_detail_is_actionable(db_session):
    """记录里的 detail 要告诉用户下一步：去浏览器核对，而不是含糊的内部错误。"""
    task = _setup_task(db_session, 1)
    runner = _runner(UnconfirmingAdapter())

    runner.start(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "任务状态")

    db_session.expire_all()
    item = db_session.query(ApplyTaskItem).filter_by(task_id=task.id).one()
    assert "浏览器" in item.failure_detail
    assert item.finished_at is not None
