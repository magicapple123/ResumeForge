# SPDX-License-Identifier: Apache-2.0
"""任务运行器：暂停/停止/熔断/单岗位异常隔离与 ``_set_status`` 终态守卫
（从 test_apply_task_runner.py 拆出）。

fakes 与 helpers（``FakeAdapter``/``_setup_task``/``_runner``/``_wait``/``_wait_db``/
``_task_status``/``_item_statuses``/``_poll``/``_config``）留在主文件。
"""

import threading
import time

import pytest
from app.models.apply import STEP_FILLING, ApplyTask, ApplyTaskItem
from test_apply_task_runner import (
    FakeAdapter,
    _config,
    _item_statuses,
    _poll,
    _runner,
    _setup_task,
    _task_status,
    _wait,
    _wait_db,
)


def test_runner_pause_and_resume(db_session):
    gate = threading.Event()
    task = _setup_task(db_session, 1)
    runner = _runner(FakeAdapter(gate=gate))

    runner.start(task.id)
    _poll(db_session, lambda: db_session.get(ApplyTask, task.id).current_step == STEP_FILLING)
    runner.pause(task.id)
    db_session.expire_all()
    assert db_session.get(ApplyTask, task.id).status == "paused"

    gate.set()
    time.sleep(0.05)
    db_session.expire_all()
    assert db_session.get(ApplyTask, task.id).status == "paused"  # 暂停确实卡住了

    runner.resume(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "恢复后任务状态")
    db_session.expire_all()
    assert db_session.get(ApplyTask, task.id).status == "completed"
    assert db_session.query(ApplyTaskItem).filter_by(task_id=task.id).one().status == "success"


def test_runner_stop_marks_remaining_items_skipped(db_session):
    gate = threading.Event()
    task = _setup_task(db_session, 2)
    runner = _runner(FakeAdapter(gate=gate))

    runner.start(task.id)
    _poll(db_session, lambda: db_session.get(ApplyTask, task.id).current_step == STEP_FILLING)
    runner.stop(task.id)
    gate.set()
    _wait(runner)
    _wait_db(
        db_session,
        lambda: (_task_status(db_session, task.id), _item_statuses(db_session, task.id)),
        ("stopped", ["skipped", "skipped"]),
        "停止后任务与剩余条目状态",
    )

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    items = (
        db_session.query(ApplyTaskItem)
        .filter_by(task_id=task.id)
        .order_by(ApplyTaskItem.sort_order)
        .all()
    )
    assert stored.status == "stopped"
    assert stored.stop_reason == "user"
    assert items[0].status == "skipped"
    assert items[1].status == "skipped"


def test_stop_returns_after_lease_released(db_session):
    """stop 返回时，runner 线程必须已归还 apply-task 租约（resume 运行器同款修复）。

    终态先于租约释放可见的话：stop 后立刻发起的数据集切换会在 _wait_for_idle
    排空窗内等待/409（datasets.py），stop 后立刻 start 下一批也会撞"已有任务正在
    进行中"。复现钉法：工作线程被 adapter 的 gate 卡住（gate 不响应 _stop），
    放行点由后台线程延迟 0.3s 控制——修复前 stop() 不 join、立即返回，此刻线程
    必然还活着且持有租约（确定性红）；修复后 stop 先 join（≤2s），放行后的线程
    在 join 窗口内退出并归还租约（确定性绿）。
    """
    gate = threading.Event()
    task = _setup_task(db_session, 1)
    runner = _runner(FakeAdapter(gate=gate))

    runner.start(task.id)
    _poll(db_session, lambda: db_session.get(ApplyTask, task.id).current_step == STEP_FILLING)

    def _release_later():
        time.sleep(0.3)
        gate.set()

    threading.Thread(target=_release_later, daemon=True).start()
    runner.stop(task.id)

    assert not runner.is_running(), "stop 返回时工作线程仍在运行"
    from app.runtime import dataset_scope

    owners = dataset_scope.lease_owners()
    assert "apply-task" not in owners, f"lease still held after stop: {owners}"


def test_runner_breaker_pauses_after_consecutive_failures(db_session):
    task = _setup_task(db_session, 2, breaker_threshold=1)
    runner = _runner(FakeAdapter(fail_categories=["selector_invalid"]))

    runner.start(task.id)
    _poll(db_session, lambda: db_session.get(ApplyTask, task.id).status == "breaker_paused")
    runner.stop(task.id)
    _wait(runner)
    _wait_db(
        db_session,
        lambda: (_task_status(db_session, task.id), _item_statuses(db_session, task.id)),
        ("stopped", ["failed", "skipped"]),
        "熔断后停止的任务与条目状态",
    )

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    first = (
        db_session.query(ApplyTaskItem)
        .filter_by(task_id=task.id)
        .order_by(ApplyTaskItem.sort_order)
        .first()
    )
    assert stored.status == "stopped"
    assert first.status == "failed"
    assert first.failure_category == "selector_invalid"
    assert "自动暂停" in stored.message or stored.stop_reason == "user"


def test_runner_isolates_single_item_exception(db_session):
    task = _setup_task(db_session, 2, breaker_threshold=3)
    runner = _runner(FakeAdapter(raise_first_error=True))

    runner.start(task.id)
    _wait(runner)
    _wait_db(
        db_session,
        lambda: (_task_status(db_session, task.id), _item_statuses(db_session, task.id)),
        ("completed", ["failed", "success"]),
        "单岗位异常被隔离后的任务与条目状态",
    )

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    items = (
        db_session.query(ApplyTaskItem)
        .filter_by(task_id=task.id)
        .order_by(ApplyTaskItem.sort_order)
        .all()
    )
    # 单岗位内部异常不打死线程，后续岗位继续；整体仍跑完。
    assert stored.status == "completed"
    assert items[0].status == "failed"
    assert items[1].status == "success"


# ===== 修复 A：控制接口回写不得覆盖工作线程提交的终态（pause/resume 竞态根因）=====


def _bare_task(db_session, status: str = "running") -> ApplyTask:
    """直接造一条指定状态的任务行，用于白盒直测 ``_set_status`` 的终态守卫。"""
    task = ApplyTask(kind="apply", status=status, total=0, config=_config().model_dump())
    db_session.add(task)
    db_session.commit()
    return task


@pytest.mark.parametrize("terminal", ["completed", "stopped", "failed"])
def test_set_status_refuses_to_overwrite_a_terminal_status(db_session, terminal):
    """白盒直击 ``_set_status``：任务已落终态后，任何活动态回写都必须被拒绝。

    竞态链路——工作线程抢先提交 ``completed`` 后，``resume()`` 会调到
    ``_set_status(RUNNING)``；若此处无条件回写，终态就会被盖成 ``running`` 且再无人修正，
    任务永久卡住。三种终态逐一验证：running / paused / stopped 都无法覆盖。
    """
    runner = _runner(FakeAdapter())
    task = _bare_task(db_session, status=terminal)

    for target in ("running", "paused", "stopped"):
        runner._set_status(task.id, target)

    db_session.expire_all()
    assert _task_status(db_session, task.id) == terminal


def test_set_status_still_applies_active_transitions(db_session):
    """终态守卫只拦"终态→活动态"，不能误伤运行中的暂停 / 恢复 / 停止。"""
    runner = _runner(FakeAdapter())
    task = _bare_task(db_session, status="running")

    runner._set_status(task.id, "paused")
    db_session.expire_all()
    assert _task_status(db_session, task.id) == "paused"

    runner._set_status(task.id, "running")
    db_session.expire_all()
    assert _task_status(db_session, task.id) == "running"

    # 运行中停止仍应生效（当前是活动态，允许写入 stopped 与原因）。
    runner._set_status(task.id, "stopped", "user")
    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "stopped"
    assert stored.stop_reason == "user"


def test_resume_after_worker_completed_keeps_the_terminal_status(db_session):
    """端到端复现：任务已 completed，控制线程再补一次 running 回写必须被拒绝。"""
    runner = _runner(FakeAdapter())
    task = _bare_task(db_session, status="completed")

    # 模拟 resume() 在 worker 抢先提交 completed 之后才执行的那一次回写。
    runner._set_status(task.id, "running")

    db_session.expire_all()
    assert _task_status(db_session, task.id) == "completed"


def test_pause_resume_cycle_never_strands_a_task_in_running(db_session):
    """真实 worker + 控制接口并发：pause→resume 收尾后必须停在终态，绝不残留 running。

    这是竞态的最强回归：``resume()`` 的 ``_set_status(RUNNING)`` 必须在**数据库层**原子地
    让位于工作线程已提交的终态。只要回写是"先读后盲写"，工作线程的 completed 就有机会落在
    读与写之间被盖掉，任务永久卡在 running——本用例对该时序做端到端把关。
    """
    gate = threading.Event()
    task = _setup_task(db_session, 1)
    runner = _runner(FakeAdapter(gate=gate))

    runner.start(task.id)
    _poll(db_session, lambda: db_session.get(ApplyTask, task.id).current_step == STEP_FILLING)
    runner.pause(task.id)
    gate.set()
    time.sleep(0.05)
    runner.resume(task.id)

    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "恢复后任务状态")
    # pause/resume 的控制回写不得把 worker 已提交的终态改回 running。
    assert _task_status(db_session, task.id) == "completed"
    assert db_session.query(ApplyTaskItem).filter_by(task_id=task.id).one().status == "success"
