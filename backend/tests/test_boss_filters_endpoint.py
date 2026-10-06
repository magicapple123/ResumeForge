"""BOSS 筛选项：采集前的页面 prepare、API 接口与采集配置（从 test_boss_filters.py 拆出）。

payload helper 与 fake_fetcher 留在主文件；``_StoppedBrowser``/``_no_browser``/
``_BarOnlyClient`` 只被本文件使用，patch 全部随行。
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.services.browser.browser_manager import BrowserError
from app.services.sites.base import SOURCE_PUBLIC
from app.services.sites.boss import BossAdapter
from app.services.sites.boss_filters import CONDITIONS_ENDPOINT, INDUSTRY_ENDPOINT
from test_boss_filters import bar_payload, conditions_payload, fake_fetcher, industry_payload


class _BarOnlyClient:
    """停在**岗位详情页**的浏览器：页面上没有筛选栏，只有带登录态的 fetch 能拿到清单。

    这正是"采集开始那一刻"的真实状态——上一轮采集的最后一个动作是打开岗位详情。免登录的
    公开清单里没有「实习」这类只对某些账号可见的档，所以第一次校验必然判它"没能生效"。
    """

    def __init__(self, public_job_types: list[dict] | None = None) -> None:
        self.navigated: list[str] = []
        self._conditions = public_job_types or conditions_payload()["zpData"]["jobTypeList"]
        self._on_search_page = False
        self._fetch_done = False

    def navigate(self, url: str, **_kwargs):
        self.navigated.append(url)
        self._on_search_page = "geek/jobs" in url
        return {}

    def evaluate(self, expression: str, **_kwargs):
        if "rf:filters" in expression:
            return bar_payload() if self._on_search_page else {"groups": []}
        if "rf:filter-conditions" in expression:
            self._fetch_done = False
            return 1
        if "__rfFilterConditions" in expression:
            self._fetch_done = True
            return None  # geek 页面上那次 fetch 永远不 resolve（实测）
        return None


def test_prepare_opens_the_search_page_when_the_public_list_is_not_enough():
    """选了公开清单里没有的档（「实习」）时，才去搜索页读一次筛选栏，然后就能生效。"""
    getter = fake_fetcher(
        {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
    )
    client = _BarOnlyClient()
    adapter = BossAdapter(filter_fetcher=getter)
    resolved = adapter.prepare_collect_filters({"jobType": "1902"}, client)
    assert resolved.params == {"jobType": "1902"}
    assert resolved.applied == ["求职类型：实习"]
    assert resolved.unapplied == []
    assert client.navigated == ["https://www.zhipin.com/web/geek/jobs"]


def test_prepare_does_not_open_any_page_when_the_public_list_already_answers():
    """公开清单就能确认的选项**一次多余页面都不开**——这是绝大多数采集的情形。"""
    getter = fake_fetcher(
        {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
    )
    client = _BarOnlyClient()
    adapter = BossAdapter(filter_fetcher=getter)
    resolved = adapter.prepare_collect_filters({"degree": "203", "scale": "306"}, client)
    assert resolved.params == {"degree": "203", "scale": "306"}
    assert client.navigated == []


def test_prepare_does_not_open_a_page_when_one_is_already_there():
    """页面上已经有筛选栏（用户就停在搜索页）时不再导航——那会把他正在看的页面顶掉。"""
    getter = fake_fetcher(
        {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
    )
    client = _BarOnlyClient()
    client._on_search_page = True
    adapter = BossAdapter(filter_fetcher=getter)
    resolved = adapter.prepare_collect_filters({"jobType": "1902"}, client)
    assert resolved.params == {"jobType": "1902"}
    assert client.navigated == []


def test_adapter_falls_back_when_the_page_read_fails():
    class BrokenClient:
        def evaluate(self, expression: str, **_kwargs):
            raise RuntimeError("页面读不到")

    adapter = BossAdapter(
        filter_fetcher=fake_fetcher(
            {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
        )
    )
    groups = adapter.fetch_filter_options(BrokenClient())
    assert all(group.source == SOURCE_PUBLIC for group in groups)


# ===== 接口 =====


class _StoppedBrowser:
    """假装浏览器没启动。

    **测试必须显式把浏览器摘掉**：接口会去探测投递专用浏览器的调试端口，而开发者本机
    常常真的开着一个（跑真实采集验证时就是），于是这个用例的结果取决于那台机器当下的状态。
    """

    @staticmethod
    def status():
        return SimpleNamespace(state="stopped")


def _no_browser(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.apply._site_browser.get_browser_manager", lambda _db: _StoppedBrowser()
    )


def test_filter_options_endpoint_returns_groups(client, monkeypatch):
    adapter = BossAdapter(
        filter_fetcher=fake_fetcher(
            {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
        )
    )
    monkeypatch.setattr("app.services.apply._site_browser.current_site", lambda _db: adapter)
    _no_browser(monkeypatch)

    response = client.get("/api/collect/filters")
    assert response.status_code == 200
    body = response.json()
    assert body["site_key"] == "boss"
    assert body["session_read"] is False  # 没有浏览器 → 用的是公开清单
    by_key = {group["key"]: group for group in body["groups"]}
    assert by_key["degree"]["param"] == "degree"
    assert [item["label"] for item in by_key["degree"]["options"]] == ["不限", "本科"]
    assert by_key["industry"]["options"][1] == {
        "code": "100028",
        "label": "人工智能",
        "group": "互联网/AI",
    }


def test_filter_options_endpoint_degrades_instead_of_failing(client, monkeypatch):
    """清单读不到是降级路径：界面最多少一个筛选区，绝不能因此打不开。"""

    class BrokenAdapter:
        key = "boss"
        display_name = "BOSS 直聘"

        def fetch_filter_options(self, _client=None):
            raise RuntimeError("站点接口挂了")

    monkeypatch.setattr(
        "app.services.apply._site_browser.current_site", lambda _db: BrokenAdapter()
    )
    _no_browser(monkeypatch)
    response = client.get("/api/collect/filters")
    assert response.status_code == 200
    assert response.json()["groups"] == []


def test_filter_options_endpoint_degrades_when_the_browser_probe_raises(client, monkeypatch):
    """浏览器状态探测本身炸了，也要当"没启动"处理，而不是把 500 抛给界面。"""

    def boom(_db):
        raise BrowserError("调试端口没应答")

    monkeypatch.setattr("app.services.apply._site_browser.get_browser_manager", boom)
    monkeypatch.setattr(
        "app.services.apply._site_browser.current_site",
        lambda _db: BossAdapter(
            filter_fetcher=fake_fetcher({CONDITIONS_ENDPOINT: conditions_payload()})
        ),
    )
    response = client.get("/api/collect/filters")
    assert response.status_code == 200
    assert response.json()["session_read"] is False


def test_collect_config_round_trips_site_filters(client):
    """筛选项随采集条件一起存、一起读。"""
    response = client.put(
        "/api/collect/config",
        json={"keywords": ["python"], "city": "成都", "filters": {"degree": "203"}},
    )
    assert response.status_code == 200
    assert response.json()["filters"] == {"degree": "203"}
    assert client.get("/api/collect/config").json()["filters"] == {"degree": "203"}


@pytest.mark.parametrize(
    "payload",
    [
        {"filters": {f"k{index}": "1" for index in range(20)}},
        {"filters": {"k": "x" * 64}},
    ],
)
def test_collect_config_rejects_oversized_filters(client, payload):
    response = client.put("/api/collect/config", json={"keywords": ["python"], **payload})
    assert response.status_code == 422
