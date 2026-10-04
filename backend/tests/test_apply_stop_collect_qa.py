"""对抗性测试（采集路径）：翻页之间停止与无条目批次的提前停止收尾
（从 test_apply_stop_semantics_qa.py 拆出）。

apply 路径的停止语义 fakes/helpers 留在主文件（test_apply_stop_semantics_qa.py）。
"""
from __future__ import annotations

import threading
import time

from app.models.apply import ApplyTask, ApplyTaskItem
from app.services.apply.task_runner import TaskRunner
from app.services.sites.base import (
    CollectQuery,
    RiskProfile,
    SearchPage,
    SearchResult,
    SiteAdapter,
)

from test_apply_stop_semantics_qa import (
    FakeCdp,
    _runner,
    GatedAdapter,
    _FastClock,
    _leftover_threads,
    _registry,
    _wait_no_leftover,
    _wait_thread_exit,
)


# ===== 采集：翻页之间停止 =====


class _PagingAdapter(SiteAdapter):
    key = "paging"
    display_name = "示例采集站"
    hosts = ("zhipin.com",)

    def __init__(self, gate: threading.Event) -> None:
        self._gate = gate
        self.pages_requested = 0

    def matches(self, url_or_source: str) -> bool:
        return True

    def risk_profile(self) -> RiskProfile:
        return RiskProfile(key=self.key)

    def collect_search(self, client, query: CollectQuery, page: int) -> SearchPage:
        self.pages_requested += 1
        if page == 1:
            self._gate.wait(timeout=10)  # 第一页抓好后卡住，给"翻页之间停止"留出窗口
        results = [
            SearchResult(
                title=f"岗位{page}-{i}",
                company=f"公司{page}",
                url=f"https://www.zhipin.com/job/{page}/{i}",
                source=self.display_name,
            )
            for i in range(3)
        ]
        return SearchPage(results=results, page=page, has_next=True)

    def open_apply(self, client, job) -> None:  # pragma: no cover
        raise AssertionError("采集不应触发投递")

    def fill_and_submit(self, client, data, greeting):  # pragma: no cover
        raise AssertionError("采集不应触发投递")


def test_collect_stop_between_pages_exits_cleanly(db_session):
    from app.schemas.apply import CollectConfigIn

    gate = threading.Event()
    adapter = _PagingAdapter(gate)
    task = ApplyTask(
        kind="collect",
        status="pending",
        total=20,
        config=CollectConfigIn(keywords=["后端"], per_task_limit=20).model_dump(),
    )
    db_session.add(task)
    db_session.commit()

    runner = TaskRunner(
        registry=_registry(adapter),
        client_factory=lambda _config: FakeCdp(),
        sleeper=lambda _seconds: None,
        clock=_FastClock(),
        poll_interval=0.01,
    )
    runner.start(task.id)
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        db_session.expire_all()
        if db_session.get(ApplyTask, task.id).status == "running":
            break
        time.sleep(0.01)

    runner.stop(task.id)
    gate.set()
    assert _wait_thread_exit(runner), "采集中途停止后线程没有退出"

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "stopped"
    assert stored.stop_reason == "user"
    assert _wait_no_leftover(), f"残留线程：{_leftover_threads()}"


# ===== 采集：无条目批次的提前停止收尾（对应工程师修复 3 的采集路径） =====


def _collect_task(db_session, *, total: int = 20) -> ApplyTask:
    from app.schemas.apply import CollectConfigIn

    task = ApplyTask(
        kind="collect",
        status="pending",
        total=total,
        config=CollectConfigIn(keywords=["后端"], per_task_limit=20).model_dump(),
    )
    db_session.add(task)
    db_session.commit()
    return task


def test_early_stop_on_a_collect_task_records_a_finish_time(db_session):
    """采集批次没有 apply_task_item；刚启动就被停止时也必须正常收尾。

    无论停止信号被早停分支还是中途检查点读到，最终都应落 ``stopped / user`` 且有结束时间。
    """
    gate = threading.Event()
    adapter = _PagingAdapter(gate)
    task = _collect_task(db_session)
    runner = TaskRunner(
        registry=_registry(adapter),
        client_factory=lambda _config: FakeCdp(),
        sleeper=lambda _seconds: None,
        clock=_FastClock(),
        poll_interval=0.01,
    )

    runner.start(task.id)
    runner.stop(task.id)
    gate.set()
    assert _wait_thread_exit(runner), "采集任务点停止后线程没有退出"

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "stopped"
    assert stored.stop_reason == "user"
    assert stored.finished_at is not None, "采集任务提前停止也必须写入结束时间"
    assert _wait_no_leftover(), f"残留线程：{_leftover_threads()}"


def test_finalize_early_stop_handles_a_collect_task_without_items(db_session):
    """直击 ``_finalize_early_stop`` 在采集（无条目）路径：items=[] 只收尾任务、不抛异常。"""
    task = _collect_task(db_session)
    runner = _runner(GatedAdapter(threading.Event()))

    runner._finalize_early_stop(db_session, task)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "stopped"
    assert stored.stop_reason == "user"
    assert stored.finished_at is not None
    assert db_session.query(ApplyTaskItem).filter_by(task_id=task.id).count() == 0
