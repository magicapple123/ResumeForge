"""适配器 collect/detail 集成与采集器包装层（从 test_boss_network.py 拆出）。

``ScriptedClient``/``_search_payload``/``_response_event``/``_body_event``/
``READY``/``_adapter`` 留在主文件（部分被外部消费方 test_sample_recorder import）；
``_detail_payload`` 定义在 capture 文件。
"""
import pytest

from app.models.apply import FAILURE_SELECTOR_INVALID
from app.services.apply.task_runner import StopAwareCdpClient, TaskStopped
from app.services.sites.base import CollectQuery, SiteFailure
from app.services.sites.boss import NETWORK_RESPONSE_EVENT
from app.services.sites.boss_network import SEARCH_MARKER

from test_boss_network import (
    READY,
    ScriptedClient,
    _adapter,
    _body_event,
    _response_event,
    _search_payload,
)
from test_boss_network_capture import _detail_payload


def test_collect_prefers_the_network_response_when_it_is_available():
    """接口走得通时必须用它的结果——字段更全，而且不受渲染时序影响。"""
    events = [
        _response_event("1", "https://www.zhipin.com" + SEARCH_MARKER),
        _body_event("1", _search_payload()),
    ]
    client = ScriptedClient(
        events=events,
        # DOM 脚本故意返回一份**不同的**数据：用到了它说明走错了路。
        expressions={"rf:readiness": READY, "rf:collect": {"items": [{"title": "DOM 来的"}]}},
    )

    page = _adapter().collect_search(client, CollectQuery(keywords=["后端"]), 1)

    assert len(page.results) == 1
    assert page.results[0].title == "后端开发实习生"
    assert page.results[0].company == "示例科技"
    # 额外字段也要带出来（DOM 里读不到）。
    assert page.results[0].extra["degree"] == "本科"
    # 顺序本身就是这条链路的关键：订阅早于导航（否则漏掉第一批响应），而响应要等页面
    # 跑起来才回来，所以"取走"必须晚于导航、"停止"必须晚于取走（停止会清掉缓冲区）。
    assert client.started_with == ["Network.responseReceived"]
    assert (
        client.log.index("subscribe")
        < client.log.index("navigate")
        < client.log.index("drain")
        < client.log.index("stop")
    )


def test_collect_falls_back_to_the_dom_when_the_interface_is_unrecognised():
    """接口结构变了 → 安静地退回 DOM，而不是失败或返回空。"""
    events = [
        _response_event("1", "https://www.zhipin.com" + SEARCH_MARKER),
        _body_event("1", {"完全不同的结构": []}),
    ]
    client = ScriptedClient(
        events=events,
        expressions={
            "rf:readiness": READY,
            "rf:collect": {"items": [{"title": "DOM 来的", "company": "某公司"}]},
        },
    )

    page = _adapter().collect_search(client, CollectQuery(keywords=["后端"]), 1)
    assert [item.title for item in page.results] == ["DOM 来的"]


def test_collect_reports_a_nonzero_boss_api_response_before_dom_fallback():
    events = [
        _response_event("1", "https://www.zhipin.com" + SEARCH_MARKER),
        _body_event("1", {"code": 19, "message": "参数值错误"}),
    ]
    client = ScriptedClient(
        events=events,
        expressions={
            "rf:readiness": READY,
            "rf:collect": {"items": [{"title": "不应采用的 DOM 结果"}]},
        },
    )

    with pytest.raises(SiteFailure, match="code=19.*参数值错误"):
        _adapter().collect_search(client, CollectQuery(keywords=["后端"]), 1)


def test_collect_falls_back_when_the_client_cannot_capture_events():
    """不支持事件订阅的客户端（例如别的浏览器桥接实现）照样能用。"""
    client = ScriptedClient(
        expressions={
            "rf:readiness": READY,
            "rf:collect": {"items": [{"title": "DOM 来的"}]},
        },
        supports_capture=False,
    )
    page = _adapter().collect_search(client, CollectQuery(keywords=["后端"]), 1)
    assert [item.title for item in page.results] == ["DOM 来的"]


def test_collect_still_reports_a_genuinely_empty_result():
    """明确无结果时返回空页是合法的，不该因为"没解析出东西"就退化成失败。"""
    client = ScriptedClient(
        expressions={"rf:readiness": {**READY, "matched": 0, "explicitly_empty": True}},
    )
    page = _adapter().collect_search(client, CollectQuery(keywords=["不存在的岗位"]), 1)
    assert page.results == []
    assert page.has_next is False


def test_detail_prefers_the_network_response():
    events = [
        _response_event(
            "1", "https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=abc"
        ),
        _body_event("1", _detail_payload()),
    ]
    client = ScriptedClient(
        events=events,
        expressions={
            "rf:readiness": {"url": "https://www.zhipin.com/job_detail/abc.html", "matched": 1},
            "rf:detail": {"job_title": "DOM 来的", "description": "DOM 描述"},
        },
    )

    detail = _adapter().fetch_job_detail(client, "https://www.zhipin.com/job_detail/abc.html")
    assert detail["job_title"] == "后端开发实习生"
    assert "负责接口开发" in detail["description"]
    assert detail["extra"]["hr_active_time"] == "今日活跃"


def test_detail_network_response_survives_a_stale_dom_selector():
    events = [
        _response_event(
            "1", "https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=abc"
        ),
        _body_event("1", _detail_payload()),
    ]
    target = "https://www.zhipin.com/job_detail/abc.html"
    client = ScriptedClient(
        events=events,
        expressions={
            "rf:readiness": {
                "url": target,
                "matched": 0,
                "ready_state": "complete",
                "explicitly_empty": False,
            }
        },
    )

    detail = _adapter().fetch_job_detail(client, target)

    assert detail["job_title"] == "后端开发实习生"
    assert "负责接口开发" in detail["description"]


def test_detail_falls_back_to_the_dom():
    events = [
        _response_event("1", "https://www.zhipin.com/wapi/zpgeek/job/detail.json"),
        _body_event("1", {"没有 jobInfo": True}),
    ]
    client = ScriptedClient(
        events=events,
        expressions={
            "rf:readiness": {"url": "https://www.zhipin.com/job_detail/abc.html", "matched": 1},
            "rf:detail": {"job_title": "DOM 来的", "description": "DOM 描述"},
        },
    )
    detail = _adapter().fetch_job_detail(client, "https://www.zhipin.com/job_detail/abc.html")
    assert detail["job_title"] == "DOM 来的"


def test_detail_keeps_the_caller_url_when_the_api_omits_it():
    """接口没给详情页地址时要用调用方传进来的那个，而不是留空。"""
    payload = _detail_payload()
    payload["zpData"]["jobInfo"].pop("encryptJobId")
    events = [
        _response_event("1", "https://www.zhipin.com/wapi/zpgeek/job/detail.json"),
        _body_event("1", payload),
    ]
    client = ScriptedClient(
        events=events,
        expressions={"rf:readiness": {"url": "x", "matched": 1}},
    )
    target = "https://www.zhipin.com/job_detail/abc.html"
    assert _adapter().fetch_job_detail(client, target)["url"] == target


def test_an_interface_failure_never_becomes_a_silent_empty_result():
    """选择器失效仍然是**一等的失败**——兜底不等于把问题咽下去。"""
    client = ScriptedClient(
        expressions={"rf:readiness": {"url": "x", "matched": 0, "explicitly_empty": False}},
    )
    with pytest.raises(SiteFailure) as excinfo:
        _adapter().collect_search(client, CollectQuery(keywords=["后端"]), 1)
    assert excinfo.value.category == FAILURE_SELECTOR_INVALID


# ===== 采集器那层包装不许把订阅吞掉 =====


def _stopped() -> None:
    raise TaskStopped()


def test_the_runner_wrapper_does_not_swallow_event_capture():
    """采集器把真实客户端包在 ``StopAwareCdpClient`` 里，那层包装必须转发事件订阅。

    否则 ``CdpClient`` 基类的"不支持"空实现会被当成"这个客户端不支持订阅"，网络优先
    这条路**在生产里永远退回 DOM，而离线测试全绿**——正是本文件开头说的那种失败。
    """
    events = [
        _response_event("1", "https://www.zhipin.com" + SEARCH_MARKER),
        _body_event("1", _search_payload()),
    ]
    inner = ScriptedClient(
        events=events,
        expressions={"rf:readiness": READY, "rf:collect": {"items": [{"title": "DOM 来的"}]}},
    )
    page = _adapter().collect_search(
        StopAwareCdpClient(inner, lambda: None), CollectQuery(keywords=["后端"]), 1
    )
    assert [item.title for item in page.results] == ["后端开发实习生"]


def test_the_wrapper_still_honours_stop_before_subscribing():
    """转发订阅不能把"停止"绕过去：订阅会真的发 CDP 命令，所以仍要插检查点。"""
    wrapped = StopAwareCdpClient(ScriptedClient(), _stopped)
    with pytest.raises(TaskStopped):
        wrapped.start_event_capture([NETWORK_RESPONSE_EVENT])


def test_a_stop_does_not_throw_away_events_already_captured():
    """取走已拦到的响应是纯本地操作。在这里抛"停止"会把到手的数据白扔掉，
    让采集白白退回字段更少的 DOM 结果。"""
    inner = ScriptedClient(events=[_response_event("1", "https://x")])
    inner.start_event_capture([NETWORK_RESPONSE_EVENT])
    inner.evaluate("rf:readiness")  # 页面跑了一会儿，响应进了缓冲区
    # 此刻用户点了停止：再发 CDP 命令会被守卫拦下，但"取走已到手的数据"不该被拦。
    wrapped = StopAwareCdpClient(inner, _stopped)
    assert len(wrapped.drain_events()) == 1
