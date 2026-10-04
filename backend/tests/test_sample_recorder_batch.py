"""QA 独立验证：录制器自身行为的补充证据（装饰器透明、配对、畸形 URL）。

拆分自 test_sample_recorder_runner_qa.py：
- 装饰器对主流程完全透明（转发返回值逐方法比对，漏 return 会静默退回 DOM）；
- 一批 URL 的配对不受 500 上限影响，落盘文件都是合法 JSON；
- 畸形 URL / fragment 不让采集报错（宁留空、不抛异常）。
"""
from __future__ import annotations

import json

from app.services.browser.sample_recorder import (
    MAX_TRACKED_REQUESTS,
    SampleRecordingCdpClient,
)

# 复用装饰器单测里的假内层与构造器，避免"同一份夹具两处各写一遍"。
from test_sample_recorder import (
    MARKERS,
    _FakeInner,
    _body_result,
    _recorder,
    _response_event,
    _saved_files,
)


# ===== 三、装饰器对主流程完全透明（这里出错会直接把采集弄坏）=====


def test_decorator_returns_are_identical_with_and_without_wrapping(tmp_path):
    """包一层之后 ``drain_events`` / ``send`` / ``evaluate`` / ``navigate`` / ``list_targets``
    的返回值与不包时**完全一致**。

    适配器是照着"没用装饰器"写的：只要某一个转发方法把返回值改了（漏 return、返回 None），
    适配器就会拿不到响应体而**静默退回 DOM**，采集表面成功、实际走了慢且脆的兜底路径。
    这里用"同样的内层建两份：一份裸用、一份包着"，逐方法比对返回值。
    """

    def build() -> _FakeInner:
        return _FakeInner(
            events=[_response_event("1", "https://x/wapi/zpgeek/search/joblist.json")],
            bodies={"1": _body_result({"k": 1})},
        )

    raw = build()
    wrapped = SampleRecordingCdpClient(
        build(), markers=MARKERS, directory=tmp_path / "captures" / "boss"
    )

    assert wrapped.drain_events() == raw.drain_events()
    assert wrapped.evaluate("rf:probe") == raw.evaluate("rf:probe")
    assert wrapped.navigate("https://x/next") == raw.navigate("https://x/next")
    assert wrapped.list_targets() == raw.list_targets()
    assert wrapped.new_tab("https://x") == raw.new_tab("https://x")
    assert wrapped.send("Page.enable") == raw.send("Page.enable")
    assert wrapped.send("Network.getResponseBody", {"requestId": "1"}) == raw.send(
        "Network.getResponseBody", {"requestId": "1"}
    )


# ===== 四、配对不受 500 上限影响 + 落盘文件都是合法 JSON =====


def test_a_realistic_batch_under_the_tracking_limit_pairs_everything(tmp_path):
    """长跑里 URL 成批到达、body 随后成批取：只要一批不超过 500，配对就一条都不丢。

    ``requestId → url`` 映射超限才丢最旧。这里 200 条（< 500）先全部到达再全部取体，
    应对**全部配对成功**——若丢最旧导致配对失败，样本会静默少存，这正是本功能最怕的失败。
    同时断言**每一份落盘文件都是合法 JSON**（夹具一旦解析不了就是废的）。
    """
    count = 200
    assert count < MAX_TRACKED_REQUESTS
    events = [
        _response_event(str(i), f"https://x/wapi/zpgeek/search/joblist.json?page={i}")
        for i in range(count)
    ]
    bodies = {str(i): _body_result({"n": i}) for i in range(count)}
    recorder = _recorder(tmp_path, _FakeInner(events=events, bodies=bodies), max_samples=count)

    recorder.drain_events()  # 一大批 URL 先到
    for i in range(count):  # body 随后成批取
        recorder.send("Network.getResponseBody", {"requestId": str(i)})

    files = _saved_files(tmp_path)
    assert len(files) == count
    assert recorder.saved_count == count
    for path in files:
        json.loads(path.read_text(encoding="utf-8"))  # 每一份都能解析


def test_oversized_sample_is_skipped_whole_never_a_truncated_file(tmp_path, caplog):
    """超 2MB 的样例是**整份跳过**（记一条 warning），绝不写出半截 JSON。

    若实现是"把序列化后的 JSON 截断"，文件会解析不了、对夹具就是废的。这里断言：
    先存一份正常样例、再来一份超大样例 → 超大那份不产生任何文件，已存的那份仍然合法可解析。
    """
    import logging

    big = _body_result("ok")
    huge = json.dumps({"blob": "x" * 5000}, ensure_ascii=False)
    inner = _FakeInner(
        events=[
            _response_event("1", "https://x/wapi/zpgeek/search/joblist.json?page=1"),
            _response_event("2", "https://x/wapi/zpgeek/search/joblist.json?page=2"),
        ],
        bodies={"1": big, "2": {"body": huge, "base64Encoded": False}},
    )
    recorder = _recorder(tmp_path, inner, max_bytes=512)

    with caplog.at_level(logging.WARNING):
        recorder.drain_events()
        recorder.send("Network.getResponseBody", {"requestId": "1"})  # 正常，落盘
        recorder.send("Network.getResponseBody", {"requestId": "2"})  # 超大，跳过

    files = _saved_files(tmp_path)
    assert recorder.saved_count == 1
    assert len(files) == 1  # 超大那份没有产出（尤其是没有产出半截文件）
    json.loads(files[0].read_text(encoding="utf-8"))  # 已落盘那份仍合法
    assert any("单份上限" in record.message for record in caplog.records)


# ===== 五、畸形 URL / fragment 不让采集报错 =====


def test_malformed_url_does_not_raise_and_drops_the_path(tmp_path):
    """畸形 URL（``urlsplit`` 抛 ``ValueError``）绝不能让采集报错；path 取不到就留空。

    站点偶尔会发出畸形地址；录制器是**旁路观察者**，它出错会顺着装饰器把异常带进主流程，
    所以这里必须钉住"宁留空、不抛异常"。
    """
    malformed = "http://[::1/wapi/zpgeek/search/joblist.json"  # 未闭合 IPv6 → urlsplit 抛 ValueError
    inner = _FakeInner(
        events=[_response_event("1", malformed)],
        bodies={"1": _body_result({"k": 1})},
    )
    recorder = _recorder(tmp_path, inner)

    recorder.drain_events()
    recorder.send("Network.getResponseBody", {"requestId": "1"})  # 不抛异常

    payload = json.loads(_saved_files(tmp_path)[0].read_text(encoding="utf-8"))
    assert payload["url_path"] == ""  # 取不到 path 就留空


def test_fragment_only_url_keeps_the_path_and_strips_the_fragment(tmp_path):
    """带 fragment 的 URL：只留 path，fragment 不落盘。"""
    inner = _FakeInner(
        events=[_response_event("1", "https://x/wapi/zpgeek/search/joblist.json#section-3")],
        bodies={"1": _body_result({"k": 1})},
    )
    recorder = _recorder(tmp_path, inner)

    recorder.drain_events()
    recorder.send("Network.getResponseBody", {"requestId": "1"})

    text = _saved_files(tmp_path)[0].read_text(encoding="utf-8")
    payload = json.loads(text)
    assert payload["url_path"] == "/wapi/zpgeek/search/joblist.json"
    assert "#" not in text
