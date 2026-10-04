"""投递专用浏览器管理器：client 入口、启动时打开站点、用户自选浏览器与显示名
（从 test_apply_browser_manager.py 拆出）。

fakes 与 _transport/_manager/_orphan_browser 留在主文件；
_env_with 只被本文件的 choice 组使用，随组迁入。
"""
from pathlib import Path

import pytest

from app.services.browser.browser_manager import (
    BROWSER_CHOICE_CHROME,
    BROWSER_CHOICE_CUSTOM,
    BROWSER_CHOICE_EDGE,
    BrowserError,
    BrowserManager,
    browser_display_name,
)
from app.services.browser.cdp_client import WebsocketCdpClient

from test_apply_browser_manager import FakePopen, _manager, _transport


def _env_with(tmp_path: Path, *which: str) -> dict[str, str]:
    """构造一个只装了指定浏览器的假安装环境。"""
    program_files = tmp_path / "pf"
    env: dict[str, str] = {"PROGRAMFILES": str(program_files)}
    if "chrome" in which:
        (program_files / "Google" / "Chrome" / "Application").mkdir(parents=True)
        (program_files / "Google" / "Chrome" / "Application" / "chrome.exe").write_text("")
    if "edge" in which:
        (program_files / "Microsoft" / "Edge" / "Application").mkdir(parents=True)
        (program_files / "Microsoft" / "Edge" / "Application" / "msedge.exe").write_text("")
    return env


def test_client_requires_a_running_browser(tmp_path):
    manager, _popen = _manager(tmp_path)

    with pytest.raises(BrowserError, match="请先启动投递专用浏览器"):
        manager.client()


def test_client_returns_a_cdp_client_when_running(tmp_path):
    manager, _popen = _manager(tmp_path)
    manager.start()

    client = manager.client()

    assert isinstance(client, WebsocketCdpClient)
    assert client._port == 9333


def test_client_uses_the_configured_factory(tmp_path):
    created: list[tuple] = []

    def factory(host, port, *, http_transport=None):
        created.append((host, port, http_transport))
        return "SENTINEL"

    manager, _popen = _manager(tmp_path, client_factory=factory)
    manager.start()
    client = manager.client()

    assert client == "SENTINEL"
    assert created and created[0][1] == 9333


# ===== 启动时就打开站点入口 =====
# 只拉一个 about:blank 的空白窗口是没有用的：用户面对白页既不知道去哪，
# 也没有可以扫码登录的页面。所以拉起时必须带上目标地址。


def test_start_opens_the_given_url_instead_of_a_blank_page(tmp_path):
    manager, popen = _manager(tmp_path)
    entry = "https://www.zhipin.com/"

    manager.start(url=entry)

    args, _kwargs = popen.calls[0]
    assert args[-1] == entry
    assert "about:blank" not in args


def test_start_falls_back_to_a_blank_page_when_no_url_is_known(tmp_path):
    manager, popen = _manager(tmp_path)

    manager.start()

    args, _kwargs = popen.calls[0]
    assert args[-1] == "about:blank"


def test_open_url_navigates_the_existing_tab_instead_of_opening_a_new_one(tmp_path):
    """反复点「打开招聘网站」不该越堆越多标签页，所以走 Page.navigate。"""
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def navigate(self, url, **_kwargs):
            calls.append(("navigate", {"url": url}))
            return {}

        def new_tab(self, url="about:blank"):  # pragma: no cover - 不该被调用
            raise AssertionError("open_url 不应该新开标签页")

    manager, _popen = _manager(tmp_path, client_factory=lambda *a, **k: FakeClient())
    manager.start(url="https://www.zhipin.com/")

    manager.open_url("https://www.zhipin.com/")

    assert calls == [("navigate", {"url": "https://www.zhipin.com/"})]


def test_open_url_requires_a_running_browser(tmp_path):
    manager, _popen = _manager(tmp_path)

    with pytest.raises(BrowserError, match="请先启动投递专用浏览器"):
        manager.open_url("https://www.zhipin.com/")


# ===== 功能 1：用户自选浏览器 =====
# 明确选了 Chrome 却启动 Edge 是比报错更坏的行为，所以指定了浏览器就只找那一个。


def test_choice_chrome_finds_only_chrome(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _name: None)
    manager = BrowserManager(
        profile_dir=tmp_path / "profile",
        browser_path=None,
        browser_choice=BROWSER_CHOICE_CHROME,
        env=_env_with(tmp_path, "chrome", "edge"),
        popen=FakePopen(),
        http_transport=_transport(),
    )

    located = manager._locate_browser()

    assert located.name == "chrome.exe"


def test_choice_chrome_does_not_silently_fall_back_to_edge(tmp_path, monkeypatch):
    """明确选 Chrome 但只装了 Edge：必须报中文错，绝不静默启动 Edge。"""
    monkeypatch.setattr("shutil.which", lambda _name: None)
    manager = BrowserManager(
        profile_dir=tmp_path / "profile",
        browser_path=None,
        browser_choice=BROWSER_CHOICE_CHROME,
        env=_env_with(tmp_path, "edge"),
        popen=FakePopen(),
        http_transport=_transport(),
    )

    with pytest.raises(BrowserError) as excinfo:
        manager._locate_browser()

    assert "Google Chrome" in str(excinfo.value)
    assert "自定义路径" in str(excinfo.value)


def test_choice_edge_does_not_silently_fall_back_to_chrome(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _name: None)
    manager = BrowserManager(
        profile_dir=tmp_path / "profile",
        browser_path=None,
        browser_choice=BROWSER_CHOICE_EDGE,
        env=_env_with(tmp_path, "chrome"),
        popen=FakePopen(),
        http_transport=_transport(),
    )

    with pytest.raises(BrowserError) as excinfo:
        manager._locate_browser()

    assert "Microsoft Edge" in str(excinfo.value)


def test_choice_edge_finds_only_edge(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _name: None)
    manager = BrowserManager(
        profile_dir=tmp_path / "profile",
        browser_path=None,
        browser_choice=BROWSER_CHOICE_EDGE,
        env=_env_with(tmp_path, "chrome", "edge"),
        popen=FakePopen(),
        http_transport=_transport(),
    )

    assert manager._locate_browser().name == "msedge.exe"


def test_custom_path_must_exist(tmp_path):
    manager = BrowserManager(
        profile_dir=tmp_path / "profile",
        browser_path=tmp_path / "does-not-exist.exe",
        browser_choice=BROWSER_CHOICE_CUSTOM,
        popen=FakePopen(),
        http_transport=_transport(),
    )

    with pytest.raises(BrowserError, match="不存在或不是文件"):
        manager._locate_browser()


def test_custom_path_is_used_when_it_exists(tmp_path):
    exe = tmp_path / "mybrowser.exe"
    exe.write_text("")
    manager = BrowserManager(
        profile_dir=tmp_path / "profile",
        browser_path=exe,
        browser_choice=BROWSER_CHOICE_CUSTOM,
        popen=FakePopen(),
        http_transport=_transport(),
    )

    assert manager._locate_browser() == exe


def test_status_reports_a_human_readable_browser_name(tmp_path):
    manager, _popen = _manager(tmp_path)

    manager.start()

    status = manager.status()
    assert status.browser_name == "Google Chrome"
    assert status.browser_path.endswith("chrome.exe")


def test_browser_display_name_classifies_paths():
    assert browser_display_name("C:/x/msedge.exe") == "Microsoft Edge"
    assert browser_display_name("C:/x/chrome.exe") == "Google Chrome"
    assert browser_display_name("C:/x/other.exe") == "自定义浏览器"
    assert browser_display_name("") == ""
