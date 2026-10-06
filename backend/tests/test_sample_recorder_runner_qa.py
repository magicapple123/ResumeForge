"""QA 独立验证：「保存本次抓到的站点原文」的**运行器级接线**与隐私底线。

为什么要单独一个文件：``test_sample_recorder.py`` 验的是装饰器本身能否配对落盘，
``test_apply_queue_and_api.py`` / ``test_collect_backfill.py`` 验的是 config/API 形状，
但**功能真正接线的地方**——``task_runner._run_collect`` 里"读到开关 → 按适配器声明的 markers
安装装饰器 → 跑采集 → 四条终态路径都写账目"——**没有运行器级用例**（工程师自述的缺口）。
这段接线错了单测都不会红：装饰器装错位置、开关读反、markers 取错，生产里只会表现为
"样例永远为空"或"关了还写盘"，而且**都不报错**。这里用仓库已有的 runner 台架把它钉住，
并把三条隐私底线（只存 path、不落凭据、只写 captures）在**真实接线路径**上再验一遍。

隐私底线是本功能最该保守的部分：样例会被拿去建"真实样例回归"，一旦把 query 里的令牌
或请求头落盘，就有可能被当成夹具提交进仓库。所以下面凡是落盘断言，都对着文件**内容**验。

拆分说明：录制器自身行为（装饰器透明 / 配对上限 / 畸形 URL）已迁至
test_sample_recorder_batch.py；API 形状与第二道防线 _is_within 边界已迁至
test_sample_recorder_is_within.py；防线 B 的 runner 级用例已迁至
test_sample_recorder_guard_qa.py。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from app.config import captures_dir
from app.models.apply import ApplyTask
from app.schemas.apply import ApplyConfigIn, CollectConfigIn
from app.services.apply import apply_service
from app.services.apply.task_runner import TaskRunner, TaskStopped
from app.services.browser.cdp_client import CdpClient, CdpError
from app.services.sites.base import (
    ApplyOutcome,
    CollectQuery,
    RiskProfile,
    SearchPage,
    SiteAdapter,
    SiteFailure,
)
from app.services.sites.registry import SiteRegistry

# 复用装饰器单测里的假内层构造器（_NetworkFakeCdp 需要）。
from test_sample_recorder import _response_event

# query 里放一个"像令牌的串"：它绝不允许出现在落盘文件里。
SECRET = "SECRET123"
SEARCH_URL = f"https://www.zhipin.com/wapi/zpgeek/search/joblist.json?token={SECRET}&jobId=abc"


class _FakeClock:
    """每次读表都大步前进，让岗位间限速立即结束（离线测试不真等）。"""

    def __init__(self) -> None:
        self._t = 0.0

    def __call__(self) -> float:
        self._t += 100.0
        return self._t


class _NetworkFakeCdp(CdpClient):
    """能推送一次 ``Network.responseReceived`` 且能应答 ``Network.getResponseBody`` 的假客户端。

    生产里 URL 先到、body 后取，录制器靠 ``requestId`` 配对——这里还原同一时序，才能让
    "运行器把装饰器接在真实取体路径上"这件事被真正走一遍。``request_id`` 必须与适配器取体时
    用的一致，否则配对失败（这正是要防的静默失败）。
    """

    def __init__(self, url: str, body_payload, *, request_id: str = "req-1") -> None:
        self._url = url
        self._body = json.dumps(body_payload, ensure_ascii=False)
        self._request_id = request_id
        self.capture_methods: list[str] = []
        self.closed = False

    def start_event_capture(self, methods) -> None:
        self.capture_methods = list(methods)

    def stop_event_capture(self) -> None:
        self.capture_methods = []

    def drain_events(self):
        # 订阅停了就收不到响应——与真实客户端一致（写错取走/停止顺序就会被这条测出来）。
        if not self.capture_methods:
            return []
        return [_response_event(self._request_id, self._url)]

    def send(self, method, params=None, *, timeout=None):
        if (
            method == "Network.getResponseBody"
            and isinstance(params, dict)
            and str(params.get("requestId")) == self._request_id
        ):
            return {"body": self._body, "base64Encoded": False}
        return {}

    def list_targets(self):
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        return "t"

    def evaluate(self, expression, *, timeout=None):
        return None

    def navigate(self, url, *, timeout=None):
        return {}

    def set_file_input(self, selector, files, *, timeout=None):
        return None

    def close(self) -> None:
        self.closed = True


class _RecordingAdapter(SiteAdapter):
    """采集适配器：先驱动一次"URL→body"时序（让录制器存下一份），再返回结果或抛异常。

    ``after`` 用来模拟四条终态：成功（None）、``SiteFailure``、``CdpError``、``TaskStopped``。
    """

    key = "boss"
    display_name = "示例采集站"
    hosts = ("zhipin.com",)
    sample_markers = (("search", ("joblist",)),)

    def __init__(
        self,
        *,
        url: str,
        body_payload=None,
        page: SearchPage | None = None,
        after: BaseException | None = None,
        markers=None,
    ) -> None:
        self._url = url
        self._body = body_payload if body_payload is not None else {"zpData": {"jobList": []}}
        self._page = page or SearchPage(results=[], has_next=False)
        self._after = after
        if markers is not None:
            # 站点知识只由适配器声明；``sample_markers=()`` 表示该站点不支持保存原文。
            self.sample_markers = markers

    def matches(self, url_or_source: str) -> bool:
        return True

    def risk_profile(self) -> RiskProfile:
        return RiskProfile(key=self.key)

    def collect_search(self, client, query: CollectQuery, page: int) -> SearchPage:
        client.start_event_capture(["Network.responseReceived"])
        client.drain_events()  # URL 先到，录制器据此记住 requestId → url
        client.send("Network.getResponseBody", {"requestId": "req-1"})  # body 后取，配对落盘
        client.stop_event_capture()
        if self._after is not None:
            raise self._after
        return self._page

    def open_apply(self, client, job):  # pragma: no cover - 采集不用
        raise AssertionError("采集不应触发投递")

    def fill_and_submit(self, client, data, greeting) -> ApplyOutcome:  # pragma: no cover
        raise AssertionError("采集不应触发投递")


def _registry(*adapters: SiteAdapter) -> SiteRegistry:
    registry = SiteRegistry()
    for adapter in adapters:
        registry.register(adapter)
    return registry


def _collect_task(db_session, *, save_site_samples: bool | None = None) -> ApplyTask:
    """一个采集任务；``save_site_samples`` 为 None 时**不带该键**（保持旧任务的 config 形状）。"""
    config = CollectConfigIn(keywords=["后端"], per_task_limit=20).model_dump()
    if save_site_samples is not None:
        config["save_site_samples"] = save_site_samples
    task = ApplyTask(kind="collect", status="pending", total=20, config=config)
    db_session.add(task)
    db_session.commit()
    return task


def _runner(adapter: SiteAdapter, client_factory) -> TaskRunner:
    return TaskRunner(
        registry=_registry(adapter),
        client_factory=client_factory,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
        poll_interval=0.01,
    )


def _wait(runner: TaskRunner, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while runner.is_running() and time.monotonic() < deadline:
        time.sleep(0.01)


def _patch_captures(monkeypatch, target: Path) -> None:
    """把运行器解析的样例目录改到临时目录。

    ``_run_collect`` 里是 ``from ...config import captures_dir`` 的**按名导入**，所以必须
    patch 它所在模块的属性；否则测试会把真实 ``backend/data/captures`` 写脏。
    """
    monkeypatch.setattr("app.services.apply.task_runner.captures_dir", lambda: target)


def _saved_json_files(directory: Path) -> list[Path]:
    return sorted(directory.rglob("*.json")) if directory.exists() else []


# ===== 一、隐私底线（在真实接线路径上验）=====


def test_flag_on_records_a_sample_that_keeps_only_the_path(db_session, tmp_path, monkeypatch):
    """底线 1「URL 只存 path」+ 底线 3「只写 captures 目录」，走完整运行器路径。

    这是"带 query 的 URL 不会把令牌写进文件"的运行器级证据：适配器驱动真实取体时序 →
    运行器安装装饰器 → 落盘。断言落在**文件内容**上，而不是只断言目录存在。
    """
    target = tmp_path / "captures"
    _patch_captures(monkeypatch, target)
    real_captures = captures_dir()  # 真实仓库路径，用来确认本次没有写它
    existed_before = real_captures.exists()

    created: list[_NetworkFakeCdp] = []

    def factory(_config):
        client = _NetworkFakeCdp(SEARCH_URL, {"zpData": {"jobList": [{"jobName": "后端"}]}})
        created.append(client)
        return client

    task = _collect_task(db_session, save_site_samples=True)
    runner = _runner(_RecordingAdapter(url=SEARCH_URL), factory)

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "completed"

    # 账目写进了 task.config：份数 + 目录，用户据此知道去哪儿拿。
    assert stored.config["saved_samples"] == 1
    samples_dir = Path(stored.config["samples_dir"])
    assert samples_dir == target / "boss"

    files = _saved_json_files(target)
    assert len(files) == 1
    text = files[0].read_text(encoding="utf-8")
    payload = json.loads(text)

    # 底线 1：只留 path，query / fragment / 令牌一律不落盘。
    assert payload["url_path"] == "/wapi/zpgeek/search/joblist.json"
    assert SECRET not in text
    assert "?" not in text and "&" not in text and "#" not in text
    assert payload["body"]["zpData"]["jobList"] == [{"jobName": "后端"}]

    # 底线 3：只写 captures 目录，绝不碰真实仓库数据目录 / 数据集 / 浏览器登录态。
    assert real_captures.exists() == existed_before
    assert target in samples_dir.parents
    from app.dataset_registry import datasets_directory
    from app.services.browser.browser_manager import default_profile_dir

    assert samples_dir != datasets_directory()
    assert datasets_directory() not in samples_dir.parents
    assert default_profile_dir() not in samples_dir.parents


def test_recorded_sample_has_exactly_the_three_safe_fields(db_session, tmp_path, monkeypatch):
    """底线 2「不落任何凭据」：落盘 JSON 的字段**只有** url_path / captured_at / body。

    用"集合相等"而不是"包含"，才能挡住将来有人顺手把 headers / cookies / request_body
    塞进同一份 payload——那样的夹具一旦进仓库就是把凭据带出去了。
    """
    target = tmp_path / "captures"
    _patch_captures(monkeypatch, target)
    task = _collect_task(db_session, save_site_samples=True)
    runner = _runner(_RecordingAdapter(url=SEARCH_URL), lambda _c: _NetworkFakeCdp(SEARCH_URL, {"ok": 1}))

    runner.start(task.id)
    _wait(runner)

    payload = json.loads(_saved_json_files(target)[0].read_text(encoding="utf-8"))
    assert set(payload) == {"url_path", "captured_at", "body"}


def test_flag_off_writes_nothing_and_never_even_resolves_the_directory(
    db_session, tmp_path, monkeypatch
):
    """默认关闭：开关为假 → **连 captures_dir() 都不调用**、不建目录、不落盘、不写账目。

    把 ``captures_dir`` 换成记账的探针：只要被调用一次就记下，能区分"调用了但没写"与
    "根本没走到"。这是"绝不默默记录"这条底线在运行器层的直接证据。
    """
    calls: list[int] = []

    def spy():
        calls.append(1)
        return tmp_path / "captures"

    monkeypatch.setattr("app.services.apply.task_runner.captures_dir", spy)
    task = _collect_task(db_session)  # 不带 save_site_samples
    runner = _runner(_RecordingAdapter(url=SEARCH_URL), lambda _c: _NetworkFakeCdp(SEARCH_URL, {"ok": 1}))

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "completed"
    assert calls == []  # 开关为假时连目录都不解析
    assert not (tmp_path / "captures").exists()
    assert "saved_samples" not in stored.config
    assert "samples_dir" not in stored.config


def test_adapter_without_markers_writes_nothing_even_when_flag_is_on(
    db_session, tmp_path, monkeypatch
):
    """适配器没声明 ``sample_markers``（默认空）时，即使开了开关也一个文件都不写、不建目录。

    这条守住"站点知识只属于适配器层"：装饰器不认识任何站点，适配器不声明就不录。
    """
    calls: list[int] = []
    monkeypatch.setattr(
        "app.services.apply.task_runner.captures_dir",
        lambda: (calls.append(1), tmp_path / "captures")[1],
    )
    adapter = _RecordingAdapter(url=SEARCH_URL, markers=())
    task = _collect_task(db_session, save_site_samples=True)
    runner = _runner(adapter, lambda _c: _NetworkFakeCdp(SEARCH_URL, {"ok": 1}))

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "completed"
    assert calls == []
    assert not (tmp_path / "captures").exists()
    assert "saved_samples" not in stored.config


def test_a_malicious_site_key_cannot_write_samples_outside_captures(
    db_session, tmp_path, monkeypatch
):
    """回归（缺陷修复）：配置里的 ``site_key`` 是**用户输入**，曾被直接拿去拼样例目录，
    能把样例写到 ``captures/`` 之外——例如 ``../browser-profile``（投递浏览器的登录态目录），
    破坏"只写 captures"这条底线。

    修法：目录改用**已解析适配器**的 ``key``（代码常量，如 ``boss``），用户输入不再进入文件路径；
    并在拼完后加一条 ``captures`` 之内检查（越界就不保存、只记日志）。

    这条测试对"改回用 site_key"**有牙**：样本必须落在 ``captures/<adapter.key>``；而且整个
    临时目录下、``captures`` 之外不得出现任何样例文件。把实现改回用 site_key，第一个断言
    （样本落在 ``captures/boss``）立刻变红。
    """
    target = tmp_path / "captures"
    _patch_captures(monkeypatch, target)

    # 配置里塞一个会"往上跳"的 site_key——它不在注册表里，_collect_adapter 会回退到 adapters[0]。
    apply_service.save_apply_config(db_session, ApplyConfigIn(site_key="../browser-profile"))

    task = _collect_task(db_session, save_site_samples=True)
    runner = _runner(
        _RecordingAdapter(url=SEARCH_URL),
        lambda _c: _NetworkFakeCdp(SEARCH_URL, {"ok": 1}),
    )

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "completed"

    # 样本落在 captures/<adapter.key>（boss），而不是那个畸形 site_key 指向的地方。
    assert Path(stored.config["samples_dir"]) == target / "boss"
    assert len(_saved_json_files(target / "boss")) == 1

    # captures 之外（含 ../browser-profile）不得出现任何样例文件。
    assert _saved_json_files(tmp_path / "browser-profile") == []
    # 整个临时目录下的 json 与 captures 下的 json 完全一致 → 没有任何文件逃出 captures。
    assert _saved_json_files(target.parent) == _saved_json_files(target)


# ===== 二、四条终态路径都要写账目，且已捕获的样例照样保留 =====

@pytest.mark.parametrize(
    ("after", "expected_status", "expected_reason"),
    [
        (None, "completed", "done"),  # 成功
        (SiteFailure("selector_invalid", "页面结构可能已变化"), "failed", "error"),  # 站点失败
        (CdpError("调试通道断开"), "failed", "error"),  # CDP 错误
        (TaskStopped(), "stopped", "user"),  # 用户停止
    ],
)
def test_every_terminal_path_records_count_and_directory(
    db_session, tmp_path, monkeypatch, after, expected_status, expected_reason
):
    """成功 / SiteFailure / CdpError / TaskStopped 四条终态都必须写"存了几份、在哪"。

    用户点了停止或采集失败后，同样想知道样例存哪了；不写账目等于把已经存下来的样例藏起来。
    这里让适配器**先存下一份再抛异常**，验证四条路径都记账，且样例文件真的还在。
    """
    target = tmp_path / "captures"
    _patch_captures(monkeypatch, target)
    task = _collect_task(db_session, save_site_samples=True)
    runner = _runner(
        _RecordingAdapter(url=SEARCH_URL, after=after),
        lambda _c: _NetworkFakeCdp(SEARCH_URL, {"ok": 1}),
    )

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == expected_status
    assert stored.stop_reason == expected_reason
    # 已捕获的样例照样保留，且账目里能读到份数与目录。
    assert stored.config["saved_samples"] == 1
    assert Path(stored.config["samples_dir"]) == target / "boss"
    assert len(_saved_json_files(target)) == 1


def test_main_flow_still_completes_when_recording_fails_to_decode(
    db_session, tmp_path, monkeypatch
):
    """解码失败 / 非 JSON 只是跳过这一条，**绝不影响主采集流程**（任务仍应完成）。"""
    target = tmp_path / "captures"
    _patch_captures(monkeypatch, target)

    class _HtmlBodyCdp(_NetworkFakeCdp):
        def send(self, method, params=None, *, timeout=None):
            if method == "Network.getResponseBody":
                return {"body": "<html>验证码页</html>", "base64Encoded": False}
            return {}

    task = _collect_task(db_session, save_site_samples=True)
    runner = _runner(_RecordingAdapter(url=SEARCH_URL), lambda _c: _HtmlBodyCdp(SEARCH_URL, {}))

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "completed"
    assert stored.config["saved_samples"] == 0
    assert _saved_json_files(target) == []
