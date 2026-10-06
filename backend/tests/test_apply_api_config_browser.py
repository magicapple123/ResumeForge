"""投递台 API：任务创建/控制、配置、浏览器生命周期与启动入口
（从 test_apply_queue_and_api.py 拆出）。

browser_port/fake_runner fixture 与 _job helper 定义在主文件
（test_apply_queue_and_api.py），经本模块命名空间解析；显式 re-export。
"""
from types import SimpleNamespace

from app.models.apply import ApplyTask, ApplyTaskItem
from app.models.profile import utcnow
from app.services.apply import apply_service
from test_apply_queue_and_api import _job, browser_port, fake_runner

__all__ = ["browser_port", "fake_runner"]


# ===== 执行批次 =====


def test_create_task_requires_explicit_targets(client, db_session, fake_runner):
    response = client.post("/api/apply/tasks", json={})

    assert response.status_code == 400


def test_create_task_with_job_ids_starts_runner(client, db_session, fake_runner):
    job = _job(db_session)

    response = client.post("/api/apply/tasks", json={"job_ids": [job.id]})

    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "apply"
    assert body["total"] == 1
    assert fake_runner.started == body["id"]

    current = client.get("/api/apply/tasks/current")
    assert current.status_code == 200
    assert current.json()["id"] == body["id"]

    detail = client.get(f"/api/apply/tasks/{body['id']}")
    assert detail.status_code == 200
    assert len(detail.json()["items"]) == 1


def test_task_control_endpoints(client, db_session, fake_runner):
    job = _job(db_session)
    task_id = client.post("/api/apply/tasks", json={"job_ids": [job.id]}).json()["id"]

    assert client.post(f"/api/apply/tasks/{task_id}/pause").status_code == 200
    assert client.post(f"/api/apply/tasks/{task_id}/resume").status_code == 200
    assert client.post(f"/api/apply/tasks/{task_id}/stop").status_code == 200
    assert ("stop", task_id) in fake_runner.actions


def test_daily_limit_blocks_new_task(client, db_session, fake_runner):
    job = _job(db_session)
    client.put("/api/apply/config", json={"daily_limit": 1})
    parent = ApplyTask(kind="apply", status="completed", total=1, config={})
    db_session.add(parent)
    db_session.flush()
    db_session.add(
        ApplyTaskItem(
            task_id=parent.id,
            job_id=job.id,
            job_title=job.title,
            status="success",
            finished_at=utcnow(),
        )
    )
    db_session.commit()

    response = client.post("/api/apply/tasks", json={"job_ids": [job.id]})

    assert response.status_code == 409


# ===== 配置 / 浏览器 / 记录 =====


def test_config_roundtrip_and_validation(client, fake_runner):
    defaults = client.get("/api/apply/config")
    assert defaults.status_code == 200
    assert defaults.json()["interval_seconds"] == 25

    saved = client.put("/api/apply/config", json={"interval_seconds": 10, "daily_limit": 30})
    assert saved.status_code == 200
    assert client.get("/api/apply/config").json()["interval_seconds"] == 10

    invalid = client.put("/api/apply/config", json={"interval_seconds": 0})
    assert invalid.status_code == 422


def test_browser_status_reports_stopped(client, fake_runner):
    response = client.get("/api/apply/browser/status")

    assert response.status_code == 200
    assert response.json()["state"] == "stopped"
    assert response.json()["port"] == 9333
    # 启动浏览器时要用这个地址打开招聘网站，界面上也用它做「打开招聘网站」。
    assert response.json()["entry_url"] == "https://www.zhipin.com/"
    # 界面要能显示"实际用的是哪个浏览器"，所以状态里带上人类可读的名字。
    assert "browser_name" in response.json()
    # 没启动过就谈不上"是本次运行拉起的"，界面据此禁用「关闭浏览器」。
    assert response.json()["owned"] is False


def test_config_exposes_browser_and_site_fields(client, fake_runner):
    body = client.get("/api/apply/config").json()

    assert body["browser_choice"] == "auto"
    assert body["browser_path"] == ""
    assert body["site_key"] == "boss"
    assert body["defaults"]["browser_choice"] == "auto"
    assert body["defaults"]["site_key"] == "boss"


def test_browser_choice_roundtrip_and_validation(client, fake_runner):
    saved = client.put("/api/apply/config", json={"browser_choice": "chrome"})
    assert saved.status_code == 200
    assert saved.json()["browser_choice"] == "chrome"

    invalid = client.put("/api/apply/config", json={"browser_choice": "firefox"})
    assert invalid.status_code == 422


def test_sites_endpoint_lists_registered_sites_and_current(client, fake_runner):
    response = client.get("/api/apply/sites")

    assert response.status_code == 200
    body = response.json()
    assert body["current"] == "boss"
    assert [site["key"] for site in body["sites"]] == ["boss"]
    boss = body["sites"][0]
    assert boss["display_name"] == "BOSS直聘"
    assert boss["host"] == "zhipin.com"
    assert boss["entry_url"] == "https://www.zhipin.com/"
    assert boss["supports_collect"] is True
    assert boss["supports_apply"] is True


def test_browser_manager_is_rebuilt_when_choice_or_path_changes(db_session, fake_runner):
    """配置变更必须真正生效：选择项或路径变了就要重建浏览器管理器，而不是继续用旧的。"""
    apply_service.save_apply_config(db_session, apply_service.ApplyConfigIn(browser_choice="auto"))
    first = apply_service.get_browser_manager(db_session)

    apply_service.save_apply_config(db_session, apply_service.ApplyConfigIn(browser_choice="edge"))
    second = apply_service.get_browser_manager(db_session)

    assert second is not first
    assert second._browser_choice == "edge"

    # 同一配置重复取用应命中缓存（不重建）。
    again = apply_service.get_browser_manager(db_session)
    assert again is second

    # 自定义路径变化同样要重建。
    apply_service.save_apply_config(
        db_session,
        apply_service.ApplyConfigIn(browser_choice="custom", browser_path="C:/x/mybrowser.exe"),
    )
    third = apply_service.get_browser_manager(db_session)
    assert third is not second


def test_browser_open_needs_a_running_browser(client, fake_runner):
    """浏览器没起来时不能假装导航成功，要给出可展示的中文提示。"""
    response = client.post("/api/apply/browser/open")

    assert response.status_code == 409
    assert "请先启动投递专用浏览器" in response.json()["detail"]


# ===== 浏览器比后端活得久 =====
# 浏览器是独立进程、有意活得比后端久，所以后端重启后会丢掉它的进程句柄。
# 此时"在不在跑"必须由调试端口说了算，否则一个正在运行的浏览器会被报成"未启动"。


def test_browser_status_reports_running_when_a_previous_run_left_it_open(
    client, fake_runner, browser_port
):
    """这一条直接对应报障：端口在答就是"运行中"，采集与投递不该被拦住。"""
    browser_port.listening = True

    body = client.get("/api/apply/browser/status").json()

    assert body["state"] == "running"
    # 但它是上一次运行留下的窗口，关不掉——界面据此禁用「关闭浏览器」。
    assert body["owned"] is False


def test_browser_stop_refuses_to_pretend_it_closed_someone_elses_window(
    client, fake_runner, browser_port
):
    """关不掉就得说关不掉。

    不能像以前那样静默 no-op 还返回 204：界面会弹"已关闭投递专用浏览器"，
    而那个窗口还好端端开着——用户下次仍会撞上同一个困惑。
    """
    browser_port.listening = True

    response = client.post("/api/apply/browser/stop")

    assert response.status_code == 409
    assert "请直接关闭那个窗口" in response.json()["detail"]


def test_browser_stop_is_idempotent_when_nothing_is_running(client, fake_runner):
    response = client.post("/api/apply/browser/stop")

    assert response.status_code == 204


# ===== 启动浏览器时要不要打开站点入口页 =====
# 两种调用方的需要正好相反：投递台要那个页面（用户得在上面扫码登录），
# 官网采集不要（它只是借这个浏览器当渲染引擎，采集哪一页由采集自己导航）。


class _RecordingBrowser:
    """记录 ``start`` 收到什么 url 的假管理器。"""

    def __init__(self) -> None:
        self.started_with = "没有调用过 start"

    def start(self, url=None):
        self.started_with = url
        return self.status()

    def status(self):
        return SimpleNamespace(
            state="running",
            port=9333,
            profile_dir="",
            browser_path="",
            browser_name="",
            logged_in_hint="",
            owned=True,
        )


def _fake_browser(monkeypatch) -> _RecordingBrowser:
    manager = _RecordingBrowser()
    monkeypatch.setattr(
        "app.services.apply._site_browser.get_browser_manager", lambda _db: manager
    )
    return manager


def test_browser_start_opens_the_site_entry_by_default(client, fake_runner, monkeypatch):
    """不传参数时保持投递台原来的行为：打开站点入口页。"""
    manager = _fake_browser(monkeypatch)

    response = client.post("/api/apply/browser/start")

    assert response.status_code == 200
    assert manager.started_with == "https://www.zhipin.com/"


def test_browser_start_can_skip_the_site_entry(client, fake_runner, monkeypatch):
    """官网采集传 ``open_entry=false``：**不访问任何站点，停在空白页**。

    不跳过的话，只想采某公司官网的用户一点按钮就跳出一个招聘网站——
    而访问那个站点根本不是他这次的要求。
    """
    manager = _fake_browser(monkeypatch)

    response = client.post("/api/apply/browser/start?open_entry=false")

    assert response.status_code == 200
    assert manager.started_with is None
