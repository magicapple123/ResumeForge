# SPDX-License-Identifier: Apache-2.0
# 守的是：限流/断网时的降级文案与 `degraded` 标记（含限额恢复时刻的纯函数换算）。
"""「检查更新」拿不到上游答案时的降级口径。

三件事必须成立，否则用户会白等或者被误导：

- 403 限额时文案必须**结论前置**（先有"已确认有新版"，再说"约 N 分钟后恢复"）；
- 403 不是限额时不许把责任推给"额度用完"；
- 真没问到（双路径都失败 / 连不上）要标 `degraded`，而"确实没有新版"不许标成降级。

上游请求用**计数替身**统计（`_fetch_latest_release` / `_fetch_latest_tag_via_redirect`
都换成本地函数），本机此刻 GitHub 匿名额度已经用完，真打一次只会拿到另一个 403。

发布说明截断见 `test_update_check.py`，缓存与 60 秒节流见 `test_update_check_throttle.py`，
出网出口（net_client 工厂）见 `test_update_check_outbound.py`。
"""

import logging
import time

import httpx
from app.services.update_check import clear_cache
from app.services.update_check_degrade import (
    build_api_error,
    degraded_available_message,
    recovery_minutes,
)


class _FakeResponse:
    """只带 `build_api_error` 需要的两个属性（状态码 + 响应头）。"""

    def __init__(self, status_code: int, headers: dict[str, str]) -> None:
        self.status_code = status_code
        self.headers = headers


def _block_api(monkeypatch, *, status_code: int, headers: dict[str, str]):
    """把主路径换成"GitHub 返回 status_code"，返回一个请求计数器。"""

    async def blocked(_repo: str) -> dict:
        raise build_api_error(
            _FakeResponse(status_code, headers),
            f"GitHub 拒绝了这次匿名请求（HTTP {status_code}）",
        )

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", blocked)
    return blocked


def _serve_tag(monkeypatch, tag: str = "v99.0.0"):
    """备用探测（不碰 api.github.com）返回一个 tag，同样计数。"""

    async def fake_tag(_repo: str) -> str:
        return tag

    monkeypatch.setattr("app.services.update_check._fetch_latest_tag_via_redirect", fake_tag)
    return fake_tag


# ── 降级文案的结论前置 ──────────────────────────────────────────────────────


def test_rate_limited_403_leads_with_the_conclusion_and_says_when_it_recovers(client, monkeypatch):
    """01-2：额度用完时那句话必须是「已确认有新版 X … 约 N 分钟后恢复」。

    顺序是有意义的：用户点「检查更新」先要知道"到底有没有新版本"，"更新说明这次没取到"
    只能排在后面；`N` 来自 `X-RateLimit-Reset`（UTC epoch 秒）。
    """
    clear_cache()
    reset_at = int(time.time()) + 7 * 60
    _block_api(
        monkeypatch,
        status_code=403,
        headers={
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": str(reset_at),
        },
    )
    _serve_tag(monkeypatch, "v99.0.0")

    body = client.get("/api/update/check?refresh=true").json()

    message = body["message"]
    assert body["update_available"] is True
    assert body["latest_version"] == "99.0.0"
    # 结论必须排在"没取到说明"之前。
    assert message.index("已确认有新版 99.0.0") < message.index("没取到更新说明")
    assert "恢复" in message
    assert "额度已用完" in message
    # N 从 X-RateLimit-Reset 换算：7 分钟（允许跨秒带来 1 分钟的抖动）。
    assert "约 6 分钟后恢复" in message or "约 7 分钟后恢复" in message
    assert "备用方式" in message


def test_403_without_a_quota_hit_does_not_blame_the_rate_limit(client, monkeypatch):
    """403 也可能是网络里有人拦了 api.github.com：不许说"额度用完"，那会让人白等。"""
    clear_cache()
    _block_api(
        monkeypatch,
        status_code=403,
        headers={"x-ratelimit-limit": "60", "x-ratelimit-remaining": "42"},
    )
    _serve_tag(monkeypatch, "v99.0.0")

    message = client.get("/api/update/check?refresh=true").json()["message"]

    assert "已确认有新版 99.0.0" in message
    assert "额度" not in message
    assert "HTTP 403" in message
    assert "恢复" in message


def test_429_is_treated_as_rate_limited_even_without_the_remaining_header(client, monkeypatch):
    clear_cache()
    _block_api(
        monkeypatch,
        status_code=429,
        headers={"retry-after": "120"},
    )
    _serve_tag(monkeypatch, "v99.0.0")

    message = client.get("/api/update/check?refresh=true").json()["message"]

    assert "额度已用完" in message
    assert "约 1 分钟后恢复" in message or "约 2 分钟后恢复" in message


def test_degraded_path_logs_a_warning_with_status_and_rate_limit(client, monkeypatch, caplog):
    """01-4：降级要打 warning。启动器默认 `--log-level warning`，`info` 会被整条吞掉。"""
    clear_cache()
    _block_api(
        monkeypatch,
        status_code=403,
        headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(int(time.time()) + 60)},
    )
    _serve_tag(monkeypatch, "v99.0.0")

    with caplog.at_level(logging.WARNING, logger="app.services.update_check"):
        client.get("/api/update/check?refresh=true")

    warnings = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert warnings, "降级必须留下一条 warning"
    text = warnings[0].getMessage()
    assert "403" in text
    assert "rate_limited=True" in text


# ── 降级标记：`degraded` 区分"上游没给"与"这次没问到" ──────────────────────


def test_both_paths_failing_marks_the_result_as_degraded(client, monkeypatch):
    """403 + 备用探测也失败 → `degraded=True`，文案是可解释的降级而不是「未提供」。

    `latest_version` 为空原本一律渲染成「未提供」，而桌面壳有自己的出网链路、同一时刻
    可能已经查到 2.3.0 并弹窗——标记出来之后，界面才知道该说"本次没能确认"。
    """
    clear_cache()
    _block_api(
        monkeypatch,
        status_code=403,
        headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(int(time.time()) + 60)},
    )

    async def broken_tag(_repo: str) -> str:
        raise httpx.ConnectError("备用探测也断了")

    monkeypatch.setattr("app.services.update_check._fetch_latest_tag_via_redirect", broken_tag)

    body = client.get("/api/update/check?refresh=true").json()

    assert body["degraded"] is True
    # 没拿到版本号是事实——不许凭空编一个。
    assert body["latest_version"] == ""
    assert body["update_available"] is False
    # 降级文案必须说清"为什么没问到 + 怎么办"，而不是留给界面瞎猜。
    assert "HTTP 403" in body["message"]
    assert "备用方式这次也没成功" in body["message"]
    assert "稍后再点一次" in body["message"]


def test_unreachable_network_is_also_degraded(client, monkeypatch):
    """连不上 GitHub 是同一类"没问到"，不能只标 403 那一条。"""
    clear_cache()

    async def offline(_repo: str) -> dict:
        raise httpx.ConnectTimeout("connect timeout")

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", offline)

    body = client.get("/api/update/check?refresh=true").json()

    assert body["degraded"] is True
    assert body["latest_version"] == ""
    assert "无法连接" in body["message"]


def test_a_confirmed_answer_is_not_marked_degraded(client, monkeypatch):
    """正常拿到 tag 的结果（含只走通备用探测的那条）不许被标成降级：
    标错一次就等于把"确实没有新版"说成"不知道"。
    """
    clear_cache()

    async def release(_repo: str) -> dict:
        return {"tag_name": "v99.0.0", "name": "测试更新", "body": "x", "assets": []}

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", release)
    assert client.get("/api/update/check?refresh=true").json()["degraded"] is False

    # 主路径 403、备用探测拿到 tag：结论是有的（99.0.0），不算降级。
    clear_cache()
    _block_api(
        monkeypatch,
        status_code=403,
        headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(int(time.time()) + 60)},
    )
    _serve_tag(monkeypatch, "v99.0.0")
    body = client.get("/api/update/check?refresh=true").json()
    assert body["latest_version"] == "99.0.0"
    assert body["degraded"] is False


# ── 纯函数：X-RateLimit-Reset 的换算（UTC epoch 秒） ─────────────────────────


def test_recovery_minutes_reads_epoch_seconds():
    now = 1_700_000_000.0
    assert recovery_minutes(now + 7 * 60, now=now) == 7
    # 不足一分钟按一分钟说，绝不出现"约 0 分钟后恢复"。
    assert recovery_minutes(now + 5, now=now) == 1
    # 时刻已经过去（时钟抖动）同样退到 1 分钟，而不是给一个负数。
    assert recovery_minutes(now - 600, now=now) == 1
    # 明显不是限额重置时刻（超过一天）时宁可不给数字。
    assert recovery_minutes(now + 3 * 24 * 3600, now=now) is None
    assert recovery_minutes(None, now=now) is None


def test_degraded_message_is_capped_at_the_schema_limit():
    message = degraded_available_message(
        latest="99.0.0",
        release_page="https://github.com/example/ResumeForge/releases",
        failure=RuntimeError("x" * 2000),
    )
    assert len(message) <= 1000
