# SPDX-License-Identifier: Apache-2.0
"""浏览器引擎的标签页策略：**每次抓取新开标签，抓完关掉**。

这条不是洁癖，是修过的一个真 bug：站点的前端路由会接管同源导航，在已有标签上
`Page.navigate` 到同站另一条路由时，页面骨架在、数据区不挂载（字节「应聘记录」页
实测：复用标签 153 字，新标签 252 字且含记录卡片）。同时新标签也不会把用户正在
看的页面导航走。
"""

from __future__ import annotations

from typing import Any

from app.services.web_fetch import browser_engine


class FakeClient:
    """只实现 `fetch_with_browser` 真正用到的那几个方法。"""

    def __init__(self, *, text: str = "校招 应聘记录 投递简历", fail_new_tab: bool = False):
        self.text = text
        self.fail_new_tab = fail_new_tab
        self.navigated: list[str] = []
        self.commands: list[tuple[str, dict[str, Any] | None]] = []
        self.closed = False
        self.capturing = False

    def new_tab(self, url: str = "about:blank") -> str:
        if self.fail_new_tab:
            raise RuntimeError("浏览器不支持新标签")
        self.navigated.append(f"new-tab:{url}")
        return "tab-1"

    def start_event_capture(self, methods) -> None:
        self.capturing = True

    def stop_event_capture(self) -> None:
        self.capturing = False

    def navigate(self, url: str, *, timeout: float | None = None) -> dict[str, Any]:
        self.navigated.append(url)
        return {}

    def evaluate(self, expression: str, *, timeout: float | None = None) -> Any:
        if "readyState" in expression:
            return {"readyState": "complete", "textLength": len(self.text), "linkCount": 4}
        if "location.href" in expression:
            return "https://jobs.bytedance.com/campus/position/application"
        if "outerHTML" in expression:
            return "<div>应聘记录</div>"
        return self.text

    def drain_events(self) -> list[dict[str, Any]]:
        return []

    def send(self, method: str, params: dict[str, Any] | None = None, *, timeout=None):
        self.commands.append((method, params))
        return {}

    def close(self) -> None:
        self.closed = True


class FakeManager:
    def __init__(self, client: FakeClient, closer: FakeClient | None = None):
        self._client = client
        self._closer = closer or FakeClient()
        self.started = False
        self.client_calls = 0

    def is_active(self) -> bool:
        return True

    def start(self) -> None:  # pragma: no cover - 已经在跑
        self.started = True

    def client(self, *, target_id: str | None = None) -> FakeClient:
        self.client_calls += 1
        # 第一次取客户端用于抓取，之后取的那个用于发 Target.closeTarget。
        return self._client if self.client_calls == 1 else self._closer


def test_opens_a_tab_and_closes_it_after_reading(monkeypatch):
    monkeypatch.setattr(browser_engine, "resolve_and_check", lambda url, resolver=None: url)
    client = FakeClient()
    manager = FakeManager(client)

    page = browser_engine.fetch_with_browser(
        object(),
        "https://jobs.bytedance.com/campus/position/application",
        manager_factory=lambda _db: manager,
        settle_seconds=0,
    )

    assert client.navigated[:2] == [
        "new-tab:about:blank",
        "https://jobs.bytedance.com/campus/position/application",
    ]
    assert "投递简历" in page.text
    # 抓完必须把临时标签关掉，否则每刷一次就多一个标签。
    assert manager._closer.commands == [("Target.closeTarget", {"targetId": "tab-1"})]
    assert client.closed is True


def test_falls_back_to_the_current_tab_when_new_tab_fails(monkeypatch):
    """浏览器不支持新标签（或被策略拦住）时不能整次抓取失败。"""
    monkeypatch.setattr(browser_engine, "resolve_and_check", lambda url, resolver=None: url)
    client = FakeClient(fail_new_tab=True)
    manager = FakeManager(client)

    page = browser_engine.fetch_with_browser(
        object(),
        "https://jobs.bytedance.com/campus/position/application",
        manager_factory=lambda _db: manager,
        settle_seconds=0,
    )

    # 没有开标签的动作，但仍然导航并取到了正文。
    assert client.navigated == ["https://jobs.bytedance.com/campus/position/application"]
    assert "投递简历" in page.text
    assert manager._closer.commands == []


def test_can_opt_out_of_the_new_tab(monkeypatch):
    """显式传 use_new_tab=False 时保持旧行为（给需要复用标签的调用方）。"""
    monkeypatch.setattr(browser_engine, "resolve_and_check", lambda url, resolver=None: url)
    client = FakeClient()
    manager = FakeManager(client)
    browser_engine.fetch_with_browser(
        object(),
        "https://example.test/page",
        manager_factory=lambda _db: manager,
        settle_seconds=0,
        use_new_tab=False,
    )
    assert "new-tab:about:blank" not in client.navigated
