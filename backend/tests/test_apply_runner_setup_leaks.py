"""装配段故障注入：run_apply/run_collect 拿到 client 后、进入 try 前的失败也必须关闭 CDP 连接。

从 test_apply_runner_robustness_qa 拆出（该文件触 500 行预算），共享夹具经测试模块导入
（仓库既有惯例，见 test_apply_boss_adapter_submit 等）。
"""

from app.models.apply import ApplyTask
from app.services.apply.task_runner import TaskRunner
from app.services.sites.registry import SiteRegistry
from test_apply_runner_robustness_qa import (
    FakeCdp,
    ScriptedAdapter,
    _FastClock,
    _leftover_threads,
    _registry,
    _setup_task,
    _wait,
    _wait_no_leftover,
)


class _ExplodingRegistry(SiteRegistry):
    """``resolve_for_job`` 直接抛异常：逼出 run_apply 装配段（适配器快照）的失败。"""

    def resolve_for_job(self, job):  # noqa: D401 - 测试替身
        raise RuntimeError("模拟注册表异常")


def _counting_client_factory(created: list):
    def factory(_config):
        client = FakeCdp()
        created.append(client)
        return client

    return factory


def test_apply_client_is_closed_when_setup_after_make_client_fails(db_session):
    """run_apply 拿到 client 后、进入 try 前的装配段抛异常，client 也必须被关闭。"""
    created: list[FakeCdp] = []
    task = _setup_task(db_session, 1)
    runner = TaskRunner(
        registry=_ExplodingRegistry(),
        client_factory=_counting_client_factory(created),
        sleeper=lambda _seconds: None,
        clock=_FastClock(),
        poll_interval=0.01,
    )

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    assert db_session.get(ApplyTask, task.id).status == "failed"
    assert _wait_no_leftover(), f"残留线程：{_leftover_threads()}"
    assert created, "client 工厂未被调用（用例自检）"
    assert created[0].closed, "client 未被关闭（CDP 连接泄漏）"


def test_collect_client_is_closed_when_recorder_setup_fails(db_session, monkeypatch):
    """run_collect 的样例录制装配（走文件系统）抛异常，client 也必须被关闭。"""
    created: list[FakeCdp] = []

    class _MarkedAdapter(ScriptedAdapter):
        sample_markers = (("search", ("api", "search")),)

    task = ApplyTask(
        kind="collect",
        status="pending",
        total=0,
        config={"keywords": ["后端"], "save_site_samples": True},
    )
    db_session.add(task)
    db_session.commit()

    def _boom():
        raise OSError("模拟 captures 目录创建失败")

    monkeypatch.setattr("app.services.apply.task_runner.captures_dir", _boom)
    runner = TaskRunner(
        registry=_registry(_MarkedAdapter([])),
        client_factory=_counting_client_factory(created),
        sleeper=lambda _seconds: None,
        clock=_FastClock(),
        poll_interval=0.01,
    )

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    assert db_session.get(ApplyTask, task.id).status == "failed"
    assert _wait_no_leftover(), f"残留线程：{_leftover_threads()}"
    assert created, "client 工厂未被调用（用例自检）"
    assert created[0].closed, "client 未被关闭（CDP 连接泄漏）"
