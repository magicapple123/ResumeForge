from __future__ import annotations

from typing import Any

from app.services.webform import browser as webform_browser


class _FakeClient:
    def __init__(self, manager: "_FakeManager", target_id: str = "") -> None:
        self.manager = manager
        self.target_id = target_id
        self.closed = False

    def navigate(self, url: str) -> None:
        self.manager.navigated.append((self.target_id, url))
        for target in self.manager.targets:
            if target["id"] == self.target_id:
                target["url"] = url

    def new_tab(self, url: str) -> str:
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
