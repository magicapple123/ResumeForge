"""BOSS 适配器 detail / open_apply / fill_and_submit 与网络捕获兜底
（从 test_apply_boss_adapter.py 拆出）。

`boss()`/`ScriptedCdpClient`/`FAKE_JOB` 留在主文件；`NetworkCaptureClient` 只被
本文件的网络捕获用例使用，随组迁入。
"""
import json

import pytest
from app.models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_GREETING_MISSING,
    FAILURE_SELECTOR_INVALID,
)
from app.services.sites.base import CollectQuery, SiteFailure
from app.services.sites.boss import BossAdapter, same_target_page
from app.services.sites.boss_network import SEARCH_MARKER
from test_apply_boss_adapter import FAKE_JOB, ScriptedCdpClient, boss


def test_fetch_job_detail_waits_for_the_page_then_parses():
    adapter = boss()
    client = ScriptedCdpClient(
        {"rf:detail": json.dumps({"job_title": "后端开发", "description": "职责正文"})}
    )

    detail = adapter.fetch_job_detail(client, "https://www.zhipin.com/job_detail/xyz")

    assert client.navigations == ["https://www.zhipin.com/job_detail/xyz"]
    assert detail["job_title"] == "后端开发"
    assert detail["description"] == "职责正文"


def test_fetch_job_detail_fails_when_the_page_never_becomes_ready():
    adapter = boss()
    client = ScriptedCdpClient(
        ready={"matched": 0, "explicitly_empty": False, "ready_state": "complete"}
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.fetch_job_detail(client, "https://www.zhipin.com/job_detail/xyz")

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID


def test_open_apply_requires_a_source_url():
    adapter = boss()
    client = ScriptedCdpClient({"rf:apply-entry": {"found": True}})
    job = type("Job", (), {"source_url": ""})()

    with pytest.raises(SiteFailure) as excinfo:
        adapter.open_apply(client, job)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID


def test_open_apply_reuses_the_tab_and_confirms_the_entry_is_present():
    adapter = boss()
    client = ScriptedCdpClient(
        {
            "rf:apply-entry": {
                "found": True,
                "matched": 1,
                "url": FAKE_JOB.source_url,
                "title": "t",
            }
        }
    )

    adapter.open_apply(client, FAKE_JOB)

    assert client.navigations == [FAKE_JOB.source_url]
    assert client.tabs == []


def test_open_apply_reports_a_missing_entry_with_diagnostics():
    adapter = boss()
    client = ScriptedCdpClient(
        {"rf:apply-entry": {"found": False, "matched": 0, "url": "https://x/job", "title": "详情"}}
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.open_apply(client, FAKE_JOB)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID
    assert "https://x/job" in excinfo.value.detail


def test_fill_and_submit_success_sends_the_greeting():
    adapter = BossAdapter()
    client = ScriptedCdpClient(
        {
            "rf:entry-rect": {
                "found": True, "matched": 1, "label": "立即沟通",
                "x": 500, "y": 200, "width": 120, "height": 40,
                "url": "u", "title": "t",
            },
            "rf:chat-state": {
                "on_chat": True, "input_found": True, "found": True,
                "kind": "contenteditable", "url": "u", "title": "聊天",
            },
            "rf:fill-greeting": {"ok": True, "value": "您好，很感兴趣。"},
            "rf:send-rect": {
                "found": True, "disabled": False, "label": "发送",
                "x": 900, "y": 700, "width": 60, "height": 36,
                "url": "u", "title": "聊天",
            },
            "rf:submit-state": {"success": True, "url": "u", "title": "聊天"},
        }
    )

    outcome = adapter.fill_and_submit(client, {"name": "张三"}, greeting="您好，很感兴趣。")

    assert outcome.success is True
    assert outcome.greeting_sent == "您好，很感兴趣。"
    assert any("rf:fill-greeting" in expression for expression in client.expressions)
    # 现版链路用可信鼠标事件点击，不再发合成 click 探针。
    assert not any("rf:click-apply" in e or "rf:click-send" in e
                   for e in client.expressions)


def test_fill_and_submit_blocks_when_a_required_greeting_is_empty():
    adapter = BossAdapter()
    client = ScriptedCdpClient(
        {
            "rf:entry-rect": {
                "found": True, "matched": 1, "label": "立即沟通",
                "x": 500, "y": 200, "width": 120, "height": 40,
                "url": "u", "title": "t",
            },
        }
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.fill_and_submit(client, {}, greeting="")

    assert excinfo.value.category == FAILURE_GREETING_MISSING


def test_fill_and_submit_propagates_a_captcha_at_submit():
    adapter = BossAdapter()
    client = ScriptedCdpClient(
        {
            "rf:entry-rect": {
                "found": True, "matched": 1, "label": "立即沟通",
                "x": 500, "y": 200, "width": 120, "height": 40,
                "url": "u", "title": "t",
            },
            "rf:chat-state": {
                "on_chat": True, "input_found": True, "found": True,
                "kind": "contenteditable", "url": "u", "title": "聊天",
            },
            "rf:fill-greeting": {"ok": True, "value": "您好"},
            "rf:send-rect": {
                "found": True, "disabled": False, "label": "发送",
                "x": 900, "y": 700, "width": 60, "height": 36,
                "url": "u", "title": "聊天",
            },
            "rf:submit-state": {"captcha": True, "url": "u", "title": "t"},
        }
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.fill_and_submit(client, {}, greeting="您好")

    assert excinfo.value.category == FAILURE_CAPTCHA_REQUIRED


# ===== 采集抗改版（网络优先 / 地址规范化 / 选择器降级）=====
#
# 这一组对应一次真实故障：投递台报"页面没有切换到目标地址；匹配到的控件数: 0"，
# 而用户截图里 BOSS 的岗位列表**渲染得好好的**。两个独立的 bug 叠在一起：
#   1. 新鲜度判据是"地址与拼出来的目标**整串相等**"，站点把 /job 规范化成 /jobs 之后，
#      每次正常导航都被误判成"没切换"；
#   2. 卡片选择器还是旧的 `job-card-wrapper`（新页面是 `li.job-card-box`），
#      于是 matched 恒为 0 —— 而"匹配 0 个"以前会一路走到超时失败，
#      哪怕网络层手里已经有完整的岗位列表。


def test_same_target_page_accepts_normalised_urls_but_rejects_other_pages():
    """新鲜度判据：容忍站点的查询串规范化，但绝不把"还停在上一页"当成"已到位"。"""
    target = "https://www.zhipin.com/web/geek/job?query=%E5%90%8E%E7%AB%AF&city=&page=2"

    # 路径被规范化（/job → /jobs）、参数顺序不同 —— 都还算"就是目标那一页"。
    assert same_target_page("https://www.zhipin.com/web/geek/jobs?query=%E5%90%8E%E7%AB%AF&city=&page=2", target)
    assert same_target_page("https://www.zhipin.com/web/geek/job?page=2&city=&query=%E5%90%8E%E7%AB%AF", target)
    # 停在上一页 / 关键词不同 / 还没到搜索页 —— 都不算。
    assert not same_target_page("https://www.zhipin.com/web/geek/job?query=%E5%90%8E%E7%AB%AF&city=&page=1", target)
    assert not same_target_page("https://www.zhipin.com/web/geek/job?query=JAVA&city=&page=2", target)
    assert not same_target_page("https://www.zhipin.com/", target)


def test_a_redirected_search_url_still_counts_as_the_target_page():
    """站点把搜索地址规范化成 /jobs 之后，采集仍应正常完成而不是超时报"没切换地址"。"""
    adapter = boss()
    request = CollectQuery(keywords=["后端"])
    target = adapter.build_search_url(request, 1)
    normalized = target.replace("/web/geek/job?", "/web/geek/jobs?")
    assert normalized != target  # 确认这条用例真的在测"地址对不上"

    client = ScriptedCdpClient(
        {"rf:collect */": json.dumps({"items": [{"title": "后端开发"}], "has_next": False})},
        ready={
            "url": normalized,
            "matched": 5,
            "explicitly_empty": False,
            "ready_state": "complete",
        },
    )

    page = adapter.collect_search(client, request, page=1)

    assert [result.title for result in page.results] == ["后端开发"]


class NetworkCaptureClient(ScriptedCdpClient):
    """支持事件订阅的假客户端：把预置的接口响应交给采集器。

    真实链路上岗位列表来自 CDP 网络事件（``Network.responseReceived`` +
    ``Network.getResponseBody``）。这里把"接口返回了一份岗位列表"直接摆进去，
    用来验证"DOM 选择器失效也不影响采集"。
    """

    def __init__(self, responses=None, *, ready=None, events=None, bodies=None):
        super().__init__(responses, ready=ready)
        self.events = list(events or [])
        self.bodies = dict(bodies or {})
        self.capturing = False

    def start_event_capture(self, events):
        self.capturing = True

    def drain_events(self):
        return list(self.events) if self.capturing else []

    def stop_event_capture(self):
        self.capturing = False

    def send(self, method, params=None, *, timeout=None):
        if method == "Network.getResponseBody":
            return self.bodies.get(str((params or {}).get("requestId")), {})
        return {}


def test_network_capture_rescues_collection_when_the_dom_selector_is_stale():
    """DOM 卡片选择器过期（matched 恒为 0）不该让采集失败：接口已经返回了岗位列表。"""
    adapter = boss()
    payload = {
        "zpData": {
            "hasMore": True,
            "jobList": [
                {
                    "encryptJobId": "abc",
                    "jobName": "后端开发",
                    "brandName": "某某科技",
                    "cityName": "天津",
                    "lowSalary": 15000,
                    "highSalary": 25000,
                    "salaryMonth": 12,
                }
            ],
        }
    }
    client = NetworkCaptureClient(
        ready={
            "url": "https://www.zhipin.com/web/geek/jobs?query=%E5%90%8E%E7%AB%AF&city=&page=1",
            "matched": 0,  # 卡片 class 已改名 —— 选择器一个都匹配不到
            "explicitly_empty": False,
            "ready_state": "complete",
        },
        events=[
            {
                "method": "Network.responseReceived",
                "params": {
                    "requestId": "r1",
                    "response": {"url": f"https://www.zhipin.com{SEARCH_MARKER}?page=1"},
                },
            }
        ],
        bodies={"r1": {"body": json.dumps(payload), "base64Encoded": False}},
    )

    page = adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=1)

    assert [result.title for result in page.results] == ["后端开发"]
    assert page.results[0].company == "某某科技"
    # 12 薪是常态，不缀"·12薪"；只有 13 薪及以上才显示（见 format_salary 的口径）。
    assert page.results[0].salary == "15-25K"
    # 翻页标志来自接口（页面探针根本不报 has_next），否则永远停在第 1 页。
    assert page.has_next is True


def test_falls_back_to_job_links_when_the_card_selector_misses():
    """卡片结构没匹配到、但岗位链接在 → 用链接兜底出结果，而不是报"什么都没抓到"。"""
    adapter = boss()
    client = ScriptedCdpClient(
        {
            "rf:collect-links": json.dumps(
                {
                    "items": [
                        {"title": "前端开发", "url": "https://www.zhipin.com/job_detail/x.html"}
                    ],
                    "has_next": False,
                }
            ),
            "rf:collect */": json.dumps({"items": [], "has_next": False}),
        },
        ready={
            "url": adapter.build_search_url(CollectQuery(keywords=["前端"]), 1).replace(
                "/web/geek/job?", "/web/geek/jobs?"
            ),
            "matched": 3,
            "explicitly_empty": False,
            "ready_state": "complete",
        },
    )

    page = adapter.collect_search(client, CollectQuery(keywords=["前端"]), page=1)

    assert [result.title for result in page.results] == ["前端开发"]


def test_reports_a_diagnostic_instead_of_a_silent_zero_when_nothing_is_found():
    """三条路都没拿到岗位时必须**报错并带诊断**，绝不静默返回 0 条。

    静默的 0 是最坏的结果：用户会以为"关键词没搜到"，而实际是工具坏了，于是永远
    不会把诊断反馈回来，选择器也就永远收敛不了。
    """
    adapter = boss()
    client = ScriptedCdpClient(
        {
            "rf:collect-links": json.dumps({"items": [], "has_next": False}),
            "rf:collect */": json.dumps(
                {
                    "items": [],
                    "has_next": False,
                    "url": "https://www.zhipin.com/web/geek/jobs?page=1",
                    "title": "BOSS直聘",
                }
            ),
        },
        ready={
            "url": adapter.build_search_url(CollectQuery(keywords=["前端"]), 1).replace(
                "/web/geek/job?", "/web/geek/jobs?"
            ),
            "matched": 3,  # 页面等待认为"有内容"，但两套 DOM 脚本都取不到
            "explicitly_empty": False,
            "ready_state": "complete",
        },
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, CollectQuery(keywords=["前端"]), page=1)

    detail = excinfo.value.detail
    assert "岗位卡片" in detail
    assert "匹配到的控件数：0" in detail
