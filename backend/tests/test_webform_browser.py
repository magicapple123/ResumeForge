# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Any

import pytest
from app.services.browser.cdp_client import CdpError
from app.services.webform import browser as webform_browser


class _FakeClient:
    def __init__(self, manager: _FakeManager, target_id: str = "") -> None:
        self.manager = manager
        self.target_id = target_id
        self.closed = False

    def navigate(self, url: str) -> dict[str, Any] | None:
        self.manager.navigated.append((self.target_id, url))
        for target in self.manager.targets:
            if target["id"] == self.target_id:
                target["url"] = url
        return self.manager.navigate_result

    def new_tab(self, url: str) -> str:
        if self.manager.new_tab_error is not None:
            raise self.manager.new_tab_error
        self.manager.new_tabs.append(url)
        target_id = f"new-{len(self.manager.new_tabs)}"
        self.manager.targets.append({"id": target_id, "type": "page", "url": url})
        return target_id

    def ensure_page_visible(self) -> bool:
        self.manager.activated.append(self.target_id)
        return True

    def close(self) -> None:
        self.closed = True


class _FakeManager:
    def __init__(self, *, active: bool, targets: list[dict[str, Any]]) -> None:
        self.active = active
        self.targets = targets
        self.started: list[str | None] = []
        self.new_tabs: list[str] = []
        self.navigated: list[tuple[str, str]] = []
        self.activated: list[str] = []
        # 导航返回值 / 新开标签页抛错：给"报成功但页面打不开""无效地址 500"两条
        # 回归用例注入 CDP 的真实失败形态。
        self.navigate_result: dict[str, Any] | None = None
        self.new_tab_error: Exception | None = None

    def is_active(self) -> bool:
        return self.active

    def start(self, url: str | None = None) -> object:
        self.started.append(url)
        self.active = True
        self.targets = [{"id": "started", "type": "page", "url": url or "about:blank"}]
        return object()

    def list_page_targets(self) -> list[dict[str, Any]]:
        return self.targets

    def client_for_target(self, target_id: str) -> _FakeClient:
        return _FakeClient(self, target_id)

    def client(self) -> _FakeClient:
        return _FakeClient(self)


def test_open_url_starts_browser_on_target_url_without_creating_blank_tab(monkeypatch) -> None:
    manager = _FakeManager(active=False, targets=[])
    monkeypatch.setattr(webform_browser, "get_browser_manager", lambda _db: manager)

    result = webform_browser.open_url(None, "https://example.com/apply")

    assert manager.started == ["https://example.com/apply"]
    assert manager.new_tabs == []
    assert result == {"target_id": "started", "url": "https://example.com/apply"}


def test_open_url_reuses_an_existing_blank_page_before_creating_a_tab(monkeypatch) -> None:
    manager = _FakeManager(
        active=True,
        targets=[{"id": "blank", "type": "page", "url": "about:blank"}],
    )
    monkeypatch.setattr(webform_browser, "get_browser_manager", lambda _db: manager)

    result = webform_browser.open_url(None, "https://example.com/apply")

    assert manager.new_tabs == []
    assert manager.navigated == [("blank", "https://example.com/apply")]
    assert result == {"target_id": "blank", "url": "https://example.com/apply"}


def test_open_url_renavigates_same_url_tab_and_reports_navigation_error(monkeypatch) -> None:
    """**回归守卫（2026-10-26 实机）**：同一个 URL 已经停在错误页时再打开，旧实现命中
    "existing = url 相同" 就直接 return——不重新 Page.navigate、也不看 errorText，于是
    打不开的页面被假报成 200「已打开」。同 URL 复用必须重新导航并检查导航错误。"""
    url = "https://example.com/apply"
    manager = _FakeManager(
        active=True,
        targets=[{"id": "same", "type": "page", "url": url}],
    )
    manager.navigate_result = {"frameId": "F", "errorText": "net::ERR_CONNECTION_REFUSED"}
    monkeypatch.setattr(webform_browser, "get_browser_manager", lambda _db: manager)

    with pytest.raises(webform_browser.BrowserError) as error:
        webform_browser.open_url(None, url)

    assert "无法打开网页" in str(error.value)
    # 真的重新导航了（而不是命中 existing 就直接返回），且仍然复用那一个标签页。
    assert manager.navigated == [("same", url)]
    assert manager.new_tabs == []


def test_open_url_reuses_same_url_tab_without_opening_a_new_tab(monkeypatch) -> None:
    """同 URL 复用语义不变：重新导航成功时仍然返回同一个 target_id、不新增标签页。"""
    url = "https://example.com/apply"
    manager = _FakeManager(
        active=True,
        targets=[{"id": "same", "type": "page", "url": url}],
    )
    manager.navigate_result = {"frameId": "F", "loaderId": "L"}
    monkeypatch.setattr(webform_browser, "get_browser_manager", lambda _db: manager)

    result = webform_browser.open_url(None, url)

    assert result == {"target_id": "same", "url": url}
    assert manager.navigated == [("same", url)]
    assert manager.new_tabs == []
    assert manager.activated == ["same"]


def test_batch_mapping_is_not_shifted_by_section_level_nearby_labels() -> None:
    """**回归守卫（2026-10-26 网申假表单实机测得）**：区块级旁文把整块标签串进来时，
    批量匹配不能靠 DOM 顺序硬分——那会让项目名称被写进"实习时间"框。

    现场形态：section 里 h2 标题 + 每行 label/input；labelText 把 section 层的标题与
    所有行标签一起收进每个控件的旁文（该区块没有必填星号，所以原有的"标签清单"启发式
    没拦住），于是同区块每个文本框对 project_name/project_description 都是同档同分的
    候选，按 DOM 顺序分配后整体错位一格：项目名称 → 实习时间、项目描述 → 项目名称。

    修复点在 evidence.evidence_key 的旁文兜底：旁文像标签清单时只认开头那段真标签。
    """
    from app.services.webform.engine import Control, FormEngine

    def control(index: int, name: str, nearby: str, placeholder: str = "") -> Control:
        return Control(
            index=index,
            type="text",
            name=name,
            nearby_text=nearby,
            placeholder=placeholder,
            selector='[data-rf-index="' + str(index) + '"]',
        )

    section = "实习与项目经历 实习公司 实习岗位 实习时间 项目名称 项目描述 掌握技能"
    controls = [
        control(13, "intern_company", "实习公司 " + section),
        control(14, "intern_position", "实习岗位 " + section),
        control(15, "intern_period", "实习时间 " + section, "如 2025.07-2025.10"),
        control(16, "project_name", "项目名称 " + section),
        control(17, "project_desc", "项目描述 " + section),
        control(18, "skills", "掌握技能 " + section),
    ]
    data = {
        "company": "星河数据科技有限公司",
        "job_title": "数据分析实习生",
        "project_1_name": "城市共享单车骑行数据分析",
        "project_1_description": "基于公开骑行数据做时段与站点热力分析，输出可视化报告。",
    }

    result = FormEngine().match_fields(controls, data)
    by_field = {mapping.field: mapping.control.index for mapping in result.mappings}

    assert by_field.get("project_1_name") == 16, by_field
    assert by_field.get("project_1_description") == 17, by_field
    assert by_field.get("company") == 13, by_field
    assert by_field.get("job_title") == 14, by_field
    # 实习时间框不该被任何项目字段认领（修复前它拿走了 project_1_name）。
    project_fields = {"project_1_name", "project_1_description"}
    assert not any(
        mapping.control.index == 15 and mapping.field in project_fields
        for mapping in result.mappings
    ), by_field


def test_open_url_validates_the_address_even_when_the_browser_is_already_running() -> None:
    """**回归守卫（2026-10-26 实机）**：浏览器已在跑时，打开网址这条路径以前跳过了
    地址校验——端口 99999 被放行，Chrome 打不开却回了 200。

    启动路径走 BrowserManager.start（内部会 validated_browser_url），复用/新开标签页
    路径必须用同一套校验，否则同一个坏地址"第一次点报错、第二次点报成功"。
    """
    manager = _FakeManager(
        active=True,
        targets=[{"id": "blank", "type": "page", "url": "about:blank"}],
    )
    manager.navigate_result = {"frameId": "F", "loaderId": "L"}

    with pytest.raises(webform_browser.BrowserError) as error:
        webform_browser.open_url(None, "http://127.0.0.1:99999/form.html")

    assert "浏览器地址无效" in str(error.value)
    assert manager.navigated == [], "无效地址不该被真的导航"


def test_open_url_reports_navigation_failure_instead_of_false_success(monkeypatch) -> None:
    """**回归守卫（2026-10-26 实机）**：DNS 解析失败 / 连接被拒时 CDP 不抛异常，
    而是在 Page.navigate 的 result 里给 errorText。不读它就会把打不开的网页报成
    「已打开」——实机用不存在的域名与拒绝连接的端口都拿到 200。
    """
    manager = _FakeManager(
        active=True,
        targets=[{"id": "blank", "type": "page", "url": "about:blank"}],
    )
    manager.navigate_result = {"frameId": "F", "errorText": "net::ERR_NAME_NOT_RESOLVED"}
    monkeypatch.setattr(webform_browser, "get_browser_manager", lambda _db: manager)

    with pytest.raises(webform_browser.BrowserError) as error:
        webform_browser.open_url(None, "http://nonexistent-host-for-rf.invalid/x")

    assert "无法打开网页" in str(error.value)


def test_open_url_checked_navigation_errors_even_when_it_must_open_a_tab(monkeypatch) -> None:
    """没有空白页时要走"新开标签页"分支：先开 about:blank、再用 Page.navigate 走到
    目标地址，这样 errorText 才读得到（直接交给 /json/new 的话打不开的网址会静默
    变成"已打开"）。"""
    manager = _FakeManager(
        active=True, targets=[{"id": "form", "type": "page", "url": "http://x/y"}]
    )
    manager.navigate_result = {"frameId": "F", "errorText": "net::ERR_CONNECTION_REFUSED"}
    monkeypatch.setattr(webform_browser, "get_browser_manager", lambda _db: manager)

    with pytest.raises(webform_browser.BrowserError) as error:
        webform_browser.open_url(None, "https://example.com/apply")

    assert "无法打开网页" in str(error.value)
    # 目标地址只作为**导航数据**交给 CDP，不能拼进 /json/new 的 URL 里。
    assert manager.new_tabs == ["about:blank"]


def test_open_url_maps_new_tab_cdp_failure_to_a_readable_browser_error(monkeypatch) -> None:
    """连空白标签页都开不出来（浏览器半死）时也要收敛成可读的 BrowserError，不能 500。"""
    manager = _FakeManager(
        active=True, targets=[{"id": "form", "type": "page", "url": "http://x/y"}]
    )
    manager.new_tab_error = CdpError("打开新标签页失败（HTTP 500）")
    monkeypatch.setattr(webform_browser, "get_browser_manager", lambda _db: manager)

    with pytest.raises(webform_browser.BrowserError) as error:
        webform_browser.open_url(None, "https://example.com/apply")

    assert "无法打开网页" in str(error.value)


def test_list_page_targets_converts_cdp_errors_to_browser_errors(monkeypatch) -> None:
    """浏览器刚被关掉时底层抛 CdpError；上层只处理 BrowserError，不转换就是 500。"""

    class _BrokenManager:
        def list_page_targets(self) -> list[dict[str, Any]]:
            raise CdpError("无法连接投递专用浏览器")

    monkeypatch.setattr(webform_browser, "get_browser_manager", lambda _db: _BrokenManager())

    with pytest.raises(webform_browser.BrowserError) as error:
        webform_browser.list_page_targets(None)

    assert "无法读取网申浏览器" in str(error.value)


def test_browser_targets_route_returns_409_when_the_browser_is_stopped(monkeypatch) -> None:
    """**回归守卫（2026-10-26 实机）**：停止状态下 GET /api/webform/browser/targets
    返回 500「服务器处理请求时发生内部错误」；前端轮询这个接口时只能看到这条无信息的
    错误。应当是 409 + 可读文案。"""
    from app.api.webform import live_routes
    from fastapi import HTTPException

    def _raise_browser_error(_db):
        raise webform_browser.BrowserError("请先启动投递专用浏览器，再进行采集或投递")

    monkeypatch.setattr(webform_browser, "list_page_targets", _raise_browser_error)

    with pytest.raises(HTTPException) as error:
        live_routes.browser_targets(None)

    assert error.value.status_code == 409
    assert "请先启动" in str(error.value.detail)


def test_browser_stop_route_maps_browser_errors_to_400(monkeypatch) -> None:
    """**回归守卫（2026-10-26 复核）**：stop 路由是 browser 域里唯一没做错误映射的一个——
    "这个窗口是上次运行留下的，关不掉"会冒成 500 内部错误，用户只看到一条无信息提示。
    同一套错误语义应当和其它路由一致：400 + 可读文案。"""
    from app.api.webform import browser_routes
    from fastapi import HTTPException

    def _refuse(_db):
        raise webform_browser.BrowserError(
            "这个网申浏览器窗口不是本次运行启动的，应用不会猜进程来关闭它；请直接关闭那个窗口。"
        )

    monkeypatch.setattr(webform_browser, "stop_browser", _refuse)

    with pytest.raises(HTTPException) as error:
        browser_routes.browser_stop(None)

    assert error.value.status_code == 400
    assert "不是本次运行启动" in str(error.value.detail)
