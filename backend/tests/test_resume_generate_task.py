# SPDX-License-Identifier: Apache-2.0
"""简历生成后台任务：启动/轮询/取消、防重复、完成才落库。

这一组用例守的是"后台继续"改造后的三条数据一致性纪律：
- 取消标 cancelled 且**不落半成品简历**；
- 完成才落库（resume_id 回填 + resume_record 确实存在）；
- 防重复（连点两次不产生两条任务/两份简历）。

R6「生成时定下的版式覆盖要跟着简历落库」的用例已拆到
``test_resume_generate_task_format_config.py``（行数预算）；请求辅助与假 Provider
共用 ``tests/resume_generate_task_support.py``。
"""

import asyncio
import threading
import time

import pytest
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    EndlessProvider,
    HangingProvider,
    SuccessfulProvider,
    _configure,
    _job,
    _seed_profile,
    _wait_status,
    _wait_terminal,
)

# ===== RF-02：完整生命周期（孤儿恢复 / 收拢 / 总预算 / 字符计数 / 仲裁守卫）=====


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    """每个用例前释放运行器单例，避免上一个用例的后台线程跨用例残留。"""
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def test_background_generation_completes_and_persists_resume(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )

    started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})

    assert started.status_code == 201
    task = started.json()
    assert task["id"] > 0
    assert task["status"] in ("pending", "running")
    assert task["resume_id"] is None

    final = _wait_terminal(client, task["id"])
    assert final["status"] == "completed"
    assert final["resume_id"] is not None

    # 完成才落库：回填的 resume_id 确实能读出一份简历，而不是空指针。
    record = client.get(f"/api/resumes/{final['resume_id']}")
    assert record.status_code == 200
    assert record.json()["job_id"] == job["id"]


def test_cancel_marks_cancelled_and_writes_no_half_resume(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: EndlessProvider(resolved),
    )

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    _wait_status(client, task["id"], "running")

    cancelled = client.post(f"/api/resumes/generate/tasks/{task['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    final = _wait_terminal(client, task["id"])
    assert final["status"] == "cancelled"
    assert final["resume_id"] is None

    # 取消不落半成品：简历中心一条新记录都没有。
    assert client.get("/api/resumes").json()["total"] == 0


def test_cancel_returns_after_lease_released(client, monkeypatch):
    """取消返回 200 时，runner 线程必须已归还 resume-generate 租约。

    终态先于租约释放可见的话，紧随取消的数据集切换会在 _wait_for_idle 排空窗内
    撞上 409（e2e recovery 用例的真实翻车路径：取消 → teardown 激活主库 → 409）。
    cancel 现在先 join 工作线程（≤2s）再写终态，因此断言是确定性的。"""
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: EndlessProvider(resolved),
    )

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    _wait_status(client, task["id"], "running")

    cancelled = client.post(f"/api/resumes/generate/tasks/{task['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    from app.runtime import dataset_scope

    owners = dataset_scope.lease_owners()
    assert "resume-generate" not in owners, f"lease still held after cancel: {owners}"


def test_cancel_aborts_hung_model_call_and_releases_lease_promptly(client, monkeypatch):
    """取消时主动中止挂在 socket read 上的模型调用：亚秒退出、租约即时归还。

    修复前：cancel_event 的检查点只在 chunk 间隙轮询，Provider 挂死在 await 上时
    线程要等 read timeout 才退出——join(2) 超时，租约到线程退出才归还，此窗口内
    数据集切换会撞 409（实机验证报告"实机发现"第 1 条）。修复后：cancel 经
    ``call_soon_threadsafe`` 直接取消主 task，线程亚秒级退出。
    """
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: HangingProvider(resolved),
    )

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    _wait_status(client, task["id"], "running")

    begin = time.monotonic()
    cancelled = client.post(f"/api/resumes/generate/tasks/{task['id']}/cancel")
    elapsed = time.monotonic() - begin
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    # join(2.0) 只留作兜底：主动中止生效时线程亚秒退出，cancel 不应等满 2s 超时。
    assert elapsed < 2.0, f"cancel 耗时 {elapsed:.2f}s，主 task 未被主动中止"

    # 租约在 cancel 返回后 1s 内归还（修复前此刻仍被挂死线程持有，需等 read timeout）。
    from app.runtime import dataset_scope

    deadline = time.monotonic() + 1.0
    while "resume-generate" in dataset_scope.lease_owners():
        if time.monotonic() >= deadline:
            owners = dataset_scope.lease_owners()
            raise AssertionError(f"租约在 cancel 后 1s 仍未归还：{owners}")
        time.sleep(0.02)

    final = _wait_terminal(client, task["id"])
    assert final["status"] == "cancelled"
    assert final["resume_id"] is None


def test_cancel_main_task_aborts_hung_loop_sub_second():
    """机制单测：RunnerEventLoopHandle 跨线程取消事件循环上挂起的主 task。

    用真实 event loop + 挂起协程（短 sleep 预算，不注入时钟）：挂 30s 的协程在
    cancel 后必须亚秒级被取消并传播 CancelledError，句柄登记随之清空。
    """
    from app.services.resume.resume_runner_loop import RunnerEventLoopHandle

    stop = threading.Event()
    handle = RunnerEventLoopHandle(stop)
    entered = threading.Event()
    finished = threading.Event()
    outcome: list[str] = []

    async def hang() -> None:
        entered.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            outcome.append("cancelled")
            raise

    def worker() -> None:
        try:
            handle.drive(hang())
        except asyncio.CancelledError:
            outcome.append("propagated")
        finally:
            finished.set()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    # entered 在协程体内置位，而协程只有被 run_until_complete 调度后才运行——
    # 此时 loop/task 已登记完毕，无需再轮询句柄。
    assert entered.wait(timeout=2.0), "worker 未在 2s 内进入挂起协程"

    begin = time.monotonic()
    stop.set()
    handle.cancel_main_task()
    assert finished.wait(timeout=2.0), "挂起的事件循环未在 2s 内退出"
    assert time.monotonic() - begin < 1.0, "跨线程取消未亚秒级生效"
    assert outcome == ["cancelled", "propagated"]
    with handle._lock:
        assert handle._loop is None and handle._main_task is None


def test_cancel_after_done_before_completed_writes_no_resume(client, monkeypatch):
    """竞态：cancel 在 done 之后、completed 认领之前到达 → 取消胜出、不落库。

    用 ``_claim_completed`` 作为同步点：worker 拿到 done、正准备原子认领 completed 前会
    停在这里，测试趁机触发 cancel（把 running→cancelled 写库），再放行。此时 worker 的
    认领 UPDATE 影响 0 行，于是放弃写简历、按 cancelled 收尾——证明"取消不落库"在最后一
    刻依然成立。

    有牙：把原子认领去掉后，这个同步点消失、worker 直接无条件落库并置 completed，
    ``reached_claim`` 永不触发（超时断言红）；若连 ``_claim_completed`` 方法一并删掉，
    monkeypatch 直接 AttributeError（也红）。
    """
    from app.services.resume.resume_generate_runner import ResumeGenerateRunner

    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )

    reached_claim = threading.Event()
    cancel_issued = threading.Event()
    original_claim = ResumeGenerateRunner._claim_completed

    def coordinated_claim(self, session, task_id):
        reached_claim.set()
        assert cancel_issued.wait(timeout=5), "测试线程未在 5s 内发出 cancel"
        return original_claim(self, session, task_id)

    monkeypatch.setattr(ResumeGenerateRunner, "_claim_completed", coordinated_claim)

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    assert reached_claim.wait(timeout=8), "worker 未在 8s 内到达 completed 认领点"

    cancelled = client.post(f"/api/resumes/generate/tasks/{task['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    cancel_issued.set()

    final = _wait_terminal(client, task["id"])
    assert final["status"] == "cancelled"
    assert final["resume_id"] is None
    # 取消不落半成品：简历中心一条新记录都没有。
    assert client.get("/api/resumes").json()["total"] == 0


def test_duplicate_generation_is_rejected(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: EndlessProvider(resolved),
    )

    first = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    assert first.status_code == 201

    second = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    assert second.status_code == 409
    assert "正在进行" in second.json()["detail"]


def test_start_still_validates_job_and_llm(client):
    """后台任务的前置校验与旧 SSE 接口一致，别把坏输入也塞进后台线程。"""
    _seed_profile(client)

    # 未配置 LLM：400
    assert client.post("/api/resumes/generate/tasks", json={}).status_code == 400

    _configure(client)
    # 岗位不存在：404
    assert client.post("/api/resumes/generate/tasks", json={"job_id": 999}).status_code == 404


def test_status_endpoint_404s_for_unknown_task(client):
    response = client.get("/api/resumes/generate/tasks/9999")
    assert response.status_code == 404


def test_completed_status_and_resume_id_commit_atomically(client, monkeypatch):
    """回归：status=completed 与 resume_id 必须同事务提交。

    旧实现把 ``_claim_completed``（running→completed）单独 commit、之后才在另一个事务里
    回填 resume_id，中间窗口会让轮询读到 completed + resume_id=None。这里给运行器的会话
    工厂包一层 commit 检查：每次提交后立刻读库，若任务已是 completed 则记录"resume_id
    是否非空"。只要"resume_id 被拆出去提交"，中间那次 commit 后就会记到 False 而变红。
    """
    from app import database
    from app.services.resume.resume_generate_runner import get_resume_generate_runner
    from sqlalchemy import text
    from sqlalchemy.orm import Session, sessionmaker

    observations: list[bool] = []

    class InspectingSession(Session):
        def commit(self):
            super().commit()
            row = self.execute(text("SELECT status, resume_id FROM resume_generate_task")).first()
            if row is not None and row.status == "completed":
                observations.append(row.resume_id is not None)

    runner = get_resume_generate_runner()
    runner._session_factory = sessionmaker(
        bind=database.engine,
        class_=InspectingSession,
        autoflush=False,
        expire_on_commit=False,
    )

    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    final = _wait_terminal(client, task["id"])

    # 运行器把 completed 提交之后，工作线程还要再执行一条观察 SELECT 才把结果
    # 记进 observations——这两步之间只是普通语句边界，CI 负载下工作线程可能恰好
    # 在 commit 之后被抢占，而轮询线程此刻已经能读到 completed 终态。若拿到终态
    # 就立刻断言，会误报"spy 未生效"。所以这里等 observations 就绪即返回；
    # 预算只是安全网（正常情况微秒级就绪），该大就大。
    deadline = time.monotonic() + 30.0
    while not observations and time.monotonic() < deadline:
        time.sleep(0.02)

    assert final["status"] == "completed"
    assert final["resume_id"] is not None
    assert observations, "运行器会话未观察到任何 completed 提交，spy 未生效"
    assert all(observations), f"观察到 completed 但 resume_id 为空的中间态：{observations}"


# ===== 审计 PR-08：asyncio.run 的每任务新循环关闭前，池内该循环客户端必须被清理 =====


def test_runner_cleans_pool_clients_of_its_event_loop(client, monkeypatch):
    """runner 每任务新建事件循环（asyncio.run）：循环关闭前必须调用池的 per-loop 清理。

    修复前 runner 只调用 asyncio.run，池里以"该循环"为键的客户端随循环一起死亡
    却从未被 aclose。这里钉住接线本身：清理协程在 consume 的 finally 中被 await。
    """
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )
    calls: list[bool] = []

    async def _record_cleanup():
        calls.append(True)

    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.aclose_clients_for_current_loop",
        _record_cleanup,
    )

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    final = _wait_terminal(client, task["id"])
    assert final["status"] == "completed"
    assert calls == [True]
