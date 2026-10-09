"""投递台 API 冒烟测试：准入冲突、去重、错误码、显式开始、记录、配置、浏览器状态。

执行批次用**假运行器**替换单例（不真起线程、不连浏览器），只验证路由与准入逻辑。

（拆分说明：任务/配置/浏览器生命周期与启动入口在 test_apply_api_config_browser.py；
records/采集配置/补详情在 test_apply_api_collect_backfill.py。fakes、fixtures 与
helpers 留在本文件，兄弟文件按 0.1 模式导入 fake_runner/browser_port。）
"""

import httpx
import pytest
from app.models.apply import (
    ADMISSION_BLOCK,
    JobMatchAnalysis,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.profile import UserProfile
from app.schemas.job_match import JobMatchResult, MatchCondition
from app.services.apply import _site_browser, apply_service, task_runner
from app.services.job.job_match import finalize_match_result


class FakeRunner:
    def __init__(self) -> None:
        self.running = False
        self.started: int | None = None
        self.actions: list[tuple[str, int]] = []

    def is_running(self) -> bool:
        return self.running

    def start(self, task_id: int) -> None:
        self.started = task_id

    def pause(self, task_id: int) -> None:
        self.actions.append(("pause", task_id))

    def resume(self, task_id: int) -> None:
        self.actions.append(("resume", task_id))

    def stop(self, task_id: int) -> None:
        self.actions.append(("stop", task_id))


class FakeBrowserPort:
    """控制"调试端口上有没有人在答"。

    ``listening=False``（默认）＝端口上没人，与"没启动过浏览器"等价；
    置为 ``True`` 用来模拟"浏览器还在跑，但不是本进程拉起的"（后端重启后的处境）。
    """

    def __init__(self) -> None:
        self.listening = False

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path != "/json/version":
                return httpx.Response(404)
            return httpx.Response(200 if self.listening else 503, json={"Browser": "Chrome"})

        return httpx.MockTransport(handler)


@pytest.fixture
def browser_port(monkeypatch) -> FakeBrowserPort:
    """给浏览器管理器注入一个假调试端口，兑现本文件"不连浏览器"的约定。

    这层桩同时是道保险：'浏览器在不在跑'现在是**探端口**决定的，而开发机上真的
    有一个浏览器占着 9333 是很常见的事——没有这个桩，用例会连上它、甚至导航它。
    """
    port = FakeBrowserPort()
    real_manager = _site_browser.BrowserManager

    def build(**kwargs):
        kwargs.setdefault("http_transport", port.transport())
        return real_manager(**kwargs)

    monkeypatch.setattr(_site_browser, "BrowserManager", build)
    return port


@pytest.fixture
def fake_runner(monkeypatch, browser_port) -> FakeRunner:
    fake = FakeRunner()
    monkeypatch.setattr(task_runner, "get_task_runner", lambda: fake)
    apply_service.reset_browser_manager()
    yield fake
    apply_service.reset_browser_manager()


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job/1",
        "status": JOB_STATUS_OPEN,
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


def _profile(db_session) -> UserProfile:
    profile = UserProfile(name="张三", job_intent="后端开发")
    db_session.add(profile)
    db_session.commit()
    return profile


def _blocked_match(db_session, job_id: int) -> None:
    result = finalize_match_result(
        JobMatchResult(
            hard_conditions=[
                MatchCondition(label="硕士及以上", status="real_gap", evidence="资料中未提供")
            ]
        )
    )
    assert result.admission == ADMISSION_BLOCK
    apply_service.persist_match(db_session, db_session.get(Job, job_id), result)


# ===== 队列准入 =====


def test_queue_add_requires_confirmation_for_unanalyzed_job(client, db_session, fake_runner):
    job = _job(db_session)

    response = client.post("/api/apply/queue", json={"items": [{"job_id": job.id}]})

    assert response.status_code == 409
    assert response.json()["detail"]["unanalyzed"] is True


def test_queue_add_with_confirmation_succeeds_then_dedupes(client, db_session, fake_runner):
    job = _job(db_session)

    first = client.post(
        "/api/apply/queue",
        json={"items": [{"job_id": job.id, "confirm_unanalyzed": True}]},
    )
    assert first.status_code == 200
    assert len(first.json()) == 1

    second = client.post(
        "/api/apply/queue",
        json={"items": [{"job_id": job.id, "confirm_unanalyzed": True}]},
    )
    assert second.status_code == 409


def test_queue_add_blocks_real_gap_until_confirmed(client, db_session, fake_runner):
    job = _job(db_session)
    _blocked_match(db_session, job.id)

    blocked = client.post("/api/apply/queue", json={"items": [{"job_id": job.id}]})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["gaps"] == ["硕士及以上"]

    confirmed = client.post(
        "/api/apply/queue",
        json={"items": [{"job_id": job.id, "confirm_real_gap": True}]},
    )
    assert confirmed.status_code == 200


def test_queue_treats_empty_match_conclusion_as_needs_confirmation(client, db_session, fake_runner):
    """纵深防御：脏的匹配结论（空结果 / hard_gate=unknown / requires_confirm=False）不得默认放行。

    正常链路 ``persist_match`` 经 ``finalize_match_result`` 必然写合法值；这里**直接落一条脏行**
    模拟回归或历史数据。准入是安全闸门，读不出可用结论时必须按「需确认」处理
    （``requires_confirm=True``），而不是被当成可自动投递的 ALLOWED。
    """
    job = _job(db_session)
    db_session.add(
        JobMatchAnalysis(job_id=job.id, result={}, hard_gate="unknown", requires_confirm=False)
    )
    db_session.commit()

    response = client.post("/api/apply/queue", json={"items": [{"job_id": job.id}]})

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["requires_confirm"] is True


def test_queue_reorder_and_delete(client, db_session, fake_runner):
    job_a = _job(db_session, title="岗位A", source_url="https://www.zhipin.com/job/a")
    job_b = _job(db_session, title="岗位B", source_url="https://www.zhipin.com/job/b")
    created = client.post(
        "/api/apply/queue",
        json={
            "items": [
                {"job_id": job_a.id, "confirm_unanalyzed": True},
                {"job_id": job_b.id, "confirm_unanalyzed": True},
            ]
        },
    ).json()
    id_a, id_b = created[0]["id"], created[1]["id"]

    reordered = client.patch("/api/apply/queue/reorder", json={"order": [id_b, id_a]})
    assert reordered.status_code == 200
    assert [item["id"] for item in reordered.json()] == [id_b, id_a]

    assert client.delete(f"/api/apply/queue/{id_a}").status_code == 204
    assert len(client.get("/api/apply/queue").json()) == 1


# ===== 匹配分析 =====


def test_match_analysis_requires_profile(client, db_session, fake_runner):
    job = _job(db_session)

    response = client.post(f"/api/jobs/{job.id}/match-analysis")

    assert response.status_code == 400


def test_match_analysis_local_fallback_and_lifecycle(client, db_session, fake_runner):
    job = _job(db_session)
    _profile(db_session)

    created = client.post(f"/api/jobs/{job.id}/match-analysis")
    assert created.status_code == 200
    body = created.json()
    assert body["admission"] == "needs_confirm"
    assert any("未配置大模型" in note for note in body["notes"])

    fetched = client.get(f"/api/jobs/{job.id}/match-analysis")
    assert fetched.status_code == 200
    assert fetched.json()["id"] > 0
    assert fetched.json()["result"]["admission"] == "needs_confirm"

    assert client.delete(f"/api/jobs/{job.id}/match-analysis").status_code == 204
    empty = client.get(f"/api/jobs/{job.id}/match-analysis")
    assert empty.json()["id"] == 0


def test_match_analysis_missing_job_returns_404(client, fake_runner):
    assert client.post("/api/jobs/9999/match-analysis").status_code == 404




def test_queue_shows_the_latest_import_first(client, db_session, fake_runner):
    """后导入的排最上（用户实测反馈：海投场景新加入的岗位应该最先看到）。

    ``add_to_queue`` 的新条目 ``sort_order`` 取最大，``list_queue`` 倒序显示——
    两者配对，缺一不可；``reorder_queue`` 写值时也必须按同一口径倒写。
    """
    job_a = _job(db_session, title="先导入的岗位")
    job_b = _job(db_session, title="后导入的岗位")
    db_session.commit()

    # 未分析的岗位入队需要显式确认（海投场景：用户自己选择跳过确认）
    assert (
        client.post(
            "/api/apply/queue", json={"items": [{"job_id": job_a.id, "confirm_unanalyzed": True}]}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/apply/queue", json={"items": [{"job_id": job_b.id, "confirm_unanalyzed": True}]}
        ).status_code
        == 200
    )

    listed = client.get("/api/apply/queue").json()
    assert [item["job_id"] for item in listed] == [job_b.id, job_a.id]

    # 重排序：把 job_a 挪到显示顺序的最上面（界面传"从上到下"的 id 列表）
    reordered = client.patch("/api/apply/queue/reorder", json={"order": [job_a.id, job_b.id]})
    assert [item["job_id"] for item in reordered.json()] == [job_a.id, job_b.id]

    # 重排之后新导入的依然排最上（sort_order 继续取最大）
    job_c = _job(db_session, title="重排后再导入")
    db_session.commit()
    assert (
        client.post(
            "/api/apply/queue", json={"items": [{"job_id": job_c.id, "confirm_unanalyzed": True}]}
        ).status_code
        == 200
    )
    listed = client.get("/api/apply/queue").json()
    assert [item["job_id"] for item in listed] == [job_c.id, job_a.id, job_b.id]
