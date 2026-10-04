"""QA 对抗测试（拦截类）：登录墙、验证码与超时诊断。

等待期间出现的"硬失败"（登录失效 / 验证码）必须立刻返回，绝不傻等满超时；
而真正的超时失败必须带上可行动的诊断信息（URL / 标题 / 匹配控件数 / 期望控件）。

复用主文件的 ScriptedReadyClient / QUERY / _adapter。
"""
from __future__ import annotations

import pytest

from app.models.apply import FAILURE_CAPTCHA_REQUIRED, FAILURE_LOGIN_REQUIRED
from app.services.browser.page_ready import ReadyWait
from app.services.sites.base import SiteFailure
from app.services.sites.boss import BossAdapter

from test_qa_collect_load_adversarial import QUERY, ScriptedReadyClient, _adapter


def test_login_wall_while_waiting_fails_immediately():
    """等待期间出现登录失效 → 立刻抛 login_required 类失败，绝不傻等满超时。"""
    import time

    # 超时给足 30 秒，用来证明它根本没等。
    adapter = BossAdapter(ready_wait=ReadyWait(timeout=30.0, poll_interval=0.5))
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[
            {"url": target, "matched": 0, "ready_state": "complete",
             "explicitly_empty": False, "login_required": True, "title": "登录"}
        ]
    )

    started = time.monotonic()
    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, QUERY, page=1)
    elapsed = time.monotonic() - started

    assert excinfo.value.category == FAILURE_LOGIN_REQUIRED
    assert elapsed < 2.0, f"登录墙出现后仍等了 {elapsed:.2f}s，没有立刻失败"
    assert client.readiness_probes == 1


def test_login_wall_appearing_later_still_fails_as_soon_as_it_shows():
    """登录墙在第 3 次探针才出现时，也应在它出现的那一次立刻返回。"""
    adapter = _adapter(timeout=30.0, poll=0.001)
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[
            {"url": target, "matched": 0, "ready_state": "loading", "explicitly_empty": False},
            {"url": target, "matched": 0, "ready_state": "loading", "explicitly_empty": False},
            {"url": target, "matched": 0, "ready_state": "complete",
             "explicitly_empty": False, "login_required": True},
        ]
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, QUERY, page=1)

    assert excinfo.value.category == FAILURE_LOGIN_REQUIRED
    assert client.readiness_probes == 3


def test_captcha_while_waiting_fails_immediately():
    adapter = _adapter(timeout=30.0, poll=0.001)
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[
            {"url": target, "matched": 0, "ready_state": "complete",
             "explicitly_empty": False, "captcha": True}
        ]
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, QUERY, page=1)

    assert excinfo.value.category == FAILURE_CAPTCHA_REQUIRED
    assert client.readiness_probes == 1


def test_timeout_failure_carries_actionable_diagnostics():
    """超时时失败，且诊断里要带 URL / 标题 / 匹配控件数 / 期望控件描述。"""
    adapter = _adapter(timeout=0.0, poll=0.001)
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[
            {"url": target, "title": "BOSS直聘-职位搜索", "matched": 0,
             "ready_state": "loading", "explicitly_empty": False}
        ]
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, QUERY, page=1)

    detail = excinfo.value.detail
    assert target in detail
    assert "BOSS直聘-职位搜索" in detail
    assert "匹配到的控件数：0" in detail
    assert "期望" in detail

