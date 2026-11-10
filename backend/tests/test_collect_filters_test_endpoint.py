# SPDX-License-Identifier: Apache-2.0
"""「测试筛选是否实际生效」端点：逐项判定 + 浏览器未启动的 409。

fake 适配器/浏览器管理器全部用 SimpleNamespace 拼装——这里测的是**服务层的编排
逻辑**（逐组解析、applied/unapplied/unlimited 的归类、浏览器状态守卫），不是 BOSS
选择器本身（那由 boss 系列测试覆盖）。
"""
from types import SimpleNamespace

import pytest
from app.services.apply import _site_browser
from app.services.apply._base import ApplyConflict
from app.services.sites.base import FilterResolution


def _fake_groups():
    """两组合成清单：degree（学历要求）与 industry（公司行业）。"""

    def options(pairs):
        return [SimpleNamespace(code=code, label=label, group="") for code, label in pairs]

    return (
        SimpleNamespace(
            key="degree",
            param="degree",
            label="学历要求",
            options=options([("202", "大专"), ("203", "本科"), ("204", "硕士")]),
            source="session",
            note="",
        ),
        SimpleNamespace(
            key="industry",
            param="industry",
            label="公司行业",
            options=options([("100901", "互联网")]),
            source="session",
            note="",
        ),
    )


class _FakeAdapter:
    key = "fake"
    display_name = "示例站点"

    def __init__(self, known_codes: set[str] | None = None):
        self.known_codes = known_codes  # None = 全部视为生效
        self.prepared: list[dict] = []

    def fetch_filter_options(self, client=None):
        return _fake_groups()

    def prepare_collect_filters(self, selected, client=None):
        """聚合解析（与真实适配器一致：一次调用处理整组选中值）。"""
        self.prepared.append({key: list(raw) for key, raw in selected.items()})
        resolution = FilterResolution()
        for key, raw_codes in selected.items():
            codes = list(raw_codes) if isinstance(raw_codes, (list, tuple)) else [raw_codes]
            codes = [str(code) for code in codes if str(code) not in {"", "0"}]
            if not codes:
                continue
            if self.known_codes is not None and any(
                code not in self.known_codes for code in codes
            ):
                resolution.unapplied.append("学历要求" if key == "degree" else key)
                continue
            label = {"degree": "学历要求", "industry": "公司行业"}.get(key, key)
            labels = {
                "202": "大专",
                "203": "本科",
                "204": "硕士",
                "100901": "互联网",
            }
            value = "、".join(labels.get(code, code) for code in codes)
            resolution.params[key] = ",".join(codes)
            resolution.applied.append(f"{label}：{value}")
        return resolution


class _FakeStatus:
    def __init__(self, state: str):
        self.state = state


class _FakeManager:
    def __init__(self, state: str = "running"):
        self._state = state

    def status(self):
        return _FakeStatus(self._state)

    def client(self):
        return SimpleNamespace(close=lambda: None)


@pytest.fixture
def patched_service(monkeypatch):
    """把 current_site / get_browser_manager 换成 fake，返回适配器便于断言。"""
    from app.services.apply import _site_browser

    holder: dict[str, _FakeAdapter] = {}

    def install(adapter: _FakeAdapter, state: str = "running"):
        holder["adapter"] = adapter
        monkeypatch.setattr(_site_browser, "current_site", lambda db: adapter)
        monkeypatch.setattr(_site_browser, "get_browser_manager", lambda db: _FakeManager(state))

    return install, holder


def test_test_collect_filters_groups_applied_and_unapplied(db_session, patched_service):
    install, holder = patched_service
    # 学历「硕士」在清单里（生效）；行业选一个清单里没有的编码（未生效）
    adapter = _FakeAdapter(known_codes={"204"})
    install(adapter)

    result = _site_browser.test_collect_filters(
        db_session, {"degree": ["204"], "industry": ["999999"]}
    )

    assert [item.label for item in result.applied] == ["学历要求"]
    assert result.applied[0].value == "硕士"
    assert "学历要求：硕士" in result.applied[0].detail
    assert [item.label for item in result.unapplied] == ["公司行业"]
    assert "不在站点当前提供的清单里" in result.unapplied[0].detail
    # 整组一次解析（联动规则需要控制组的上下文），不逐组重复读清单/导航
    assert len(adapter.prepared) == 1
    assert adapter.prepared[0] == {"degree": ["204"], "industry": ["999999"]}


def test_test_collect_filters_marks_unlimited(db_session, patched_service):
    install, _ = patched_service
    install(_FakeAdapter())

    result = _site_browser.test_collect_filters(db_session, {"degree": ["0"]})

    assert [item.label for item in result.unlimited] == ["学历要求"]
    assert "不会向站点发送" in result.unlimited[0].detail
    assert result.applied == [] and result.unapplied == []


def test_test_collect_filters_requires_a_running_browser(db_session, patched_service):
    install, _ = patched_service
    install(_FakeAdapter(), state="stopped")

    with pytest.raises(ApplyConflict, match="请先在投递台启动投递专用浏览器"):
        _site_browser.test_collect_filters(db_session, {"degree": ["204"]})


def test_filter_test_endpoint_round_trip(client, monkeypatch):
    """端点层：service 正常时 200 返回逐项结论。"""
    from app.services.apply import _site_browser

    adapter = _FakeAdapter(known_codes={"204"})
    monkeypatch.setattr(_site_browser, "current_site", lambda db: adapter)
    monkeypatch.setattr(_site_browser, "get_browser_manager", lambda db: _FakeManager("running"))

    response = client.post(
        "/api/collect/filters/test", json={"filters": {"degree": ["204"]}}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["applied"][0]["label"] == "学历要求"
    assert body["applied"][0]["value"] == "硕士"


def test_filter_test_endpoint_reports_a_stopped_browser(client, monkeypatch):
    from app.services.apply import _site_browser

    monkeypatch.setattr(_site_browser, "current_site", lambda db: _FakeAdapter())
    monkeypatch.setattr(_site_browser, "get_browser_manager", lambda db: _FakeManager("stopped"))

    response = client.post("/api/collect/filters/test", json={"filters": {}})

    assert response.status_code == 409
    assert "请先在投递台启动投递专用浏览器" in response.json()["detail"]

def test_test_collect_filters_passes_the_whole_multi_group_at_once(db_session, patched_service):
    """多选组要**整组一起**解析（站点对多值的接受程度由那一次解析回答），不能拆成多次单项。"""
    install, _ = patched_service
    adapter = _FakeAdapter(known_codes={"202", "203"})
    install(adapter)

    result = _site_browser.test_collect_filters(db_session, {"degree": ["202", "203"]})

    assert adapter.prepared == [{"degree": ["202", "203"]}]
    assert [item.label for item in result.applied] == ["学历要求"]
    assert result.applied[0].value == "大专、本科"
    assert "学历要求：大专、本科" in result.applied[0].detail


def test_filter_test_endpoint_accepts_multi_value_filters(client, monkeypatch):
    from app.services.apply import _site_browser

    adapter = _FakeAdapter(known_codes={"202", "203"})
    monkeypatch.setattr(_site_browser, "current_site", lambda db: adapter)
    monkeypatch.setattr(_site_browser, "get_browser_manager", lambda db: _FakeManager("running"))

    response = client.post(
        "/api/collect/filters/test", json={"filters": {"degree": ["202", "203"]}}
    )

    assert response.status_code == 200, response.text
    assert response.json()["applied"][0]["value"] == "大专、本科"
