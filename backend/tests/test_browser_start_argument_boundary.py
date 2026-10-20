# SPDX-License-Identifier: Apache-2.0
"""No remote navigation text belongs in a browser process command line."""

import pytest
from app.services.browser.browser_manager import BrowserError
from tests.test_apply_browser_manager import _manager


class NavigationClient:
    def __init__(self, *, fail=False):
        self.urls = []
        self.closed = 0
        self.fail = fail

    def navigate(self, url):
        self.urls.append(url)
        if self.fail:
            raise RuntimeError("SYNTHETIC_PRIVATE_NAVIGATION_FAILURE")

    def close(self):
        self.closed += 1


def test_start_uses_a_fixed_page_then_navigates_with_cdp_data(tmp_path):
    client = NavigationClient()
    manager, popen = _manager(tmp_path, client_factory=lambda *args, **kwargs: client)
    url = 'https://example.invalid/apply?q="; --disable-web-security & ignored'
    assert manager.start(url).state == "running"
    args, options = popen.calls[0]
    assert options["shell"] is False
    assert args[-1] == "about:blank" and url not in args
    assert not any(arg.startswith("--remote-allow-origins=") for arg in args)
    assert "--remote-debugging-address=127.0.0.1" in args
    assert client.urls == [url] and client.closed == 1


def test_failed_initial_navigation_leaves_the_browser_available_and_closes_cdp(tmp_path):
    client = NavigationClient(fail=True)
    manager, popen = _manager(tmp_path, client_factory=lambda *args, **kwargs: client)
    with pytest.raises(BrowserError, match="浏览器已启动") as error:
        manager.start("https://example.invalid/")
    assert "SYNTHETIC_PRIVATE" not in str(error.value)
    assert client.closed == 1
    assert not popen.processes[0].terminated
    assert manager.status().state == "running"


def test_start_of_an_existing_browser_does_not_retarget_the_users_tab(tmp_path):
    client = NavigationClient()
    manager, popen = _manager(tmp_path, client_factory=lambda *args, **kwargs: client)
    manager.start()
    manager.start("https://example.invalid/other")
    assert len(popen.calls) == 1
    assert client.urls == []


def test_cdp_navigation_error_is_not_reported_as_a_successful_open(tmp_path):
    class FailedNavigationClient(NavigationClient):
        def navigate(self, url):
            return {"errorText": "SYNTHETIC_PRIVATE_NAVIGATION_FAILURE"}

    client = FailedNavigationClient()
    manager, _popen = _manager(tmp_path, client_factory=lambda *args, **kwargs: client)
    manager.start()
    with pytest.raises(BrowserError, match="无法打开网页") as error:
        manager.open_url("https://example.invalid/")
    assert "SYNTHETIC_PRIVATE" not in str(error.value)
    assert client.closed == 1
