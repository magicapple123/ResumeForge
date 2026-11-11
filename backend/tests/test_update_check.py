# SPDX-License-Identifier: Apache-2.0
"""更新说明（Release body）的按行截断 + 「检查更新」的降级口径与两层节流。

为什么单独一个文件：`UpdateCheckResult.notes` 的 schema 上限正好是 4000，截断时多拼
一个字就会在构造结果那一刻抛 ValidationError，把整条「检查更新」变成 500。所以这里既
测「退到换行处」，也测「总长不超预算」和「恰好等于预算时不追加提示」。

后一半（P2-1）测的是用户实际看到的那句话与请求次数：
- 403 限额时文案必须**结论前置**（先有"已确认有新版"，再说"约 N 分钟后恢复"）；
- 403 不是限额时不许把责任推给"额度用完"（那会让人白等）；
- 连点「重新检查」5 次只允许 1 次上游请求，第二次点「检查更新」必须命中缓存。

上游请求用**计数替身**统计（`_fetch_latest_release` / `_fetch_latest_tag_via_redirect`
都换成本地函数），本机此刻 GitHub 匿名额度已经用完，真打一次只会拿到另一个 403。
"""

import logging
import time

import app.services.update_check as update_check
from app.services.update_check import (
    NOTES_BUDGET,
    NOTES_TRUNCATED_HINT,
    _truncate_notes,
    clear_cache,
)
from app.services.update_check_degrade import (
    build_api_error,
    degraded_available_message,
    recovery_minutes,
)

# 每行 ~40 字符、共 300 行，总长明显超过预算，且行边界清晰便于断言。
_LINES = [
    f"第 {index:04d} 行：修复了一个具体问题，说明文字写在这里，方便看清从哪里断开。"
    for index in range(1, 301)
]


def test_short_notes_are_returned_untouched():
    text = "## 新增\n- **深挖** 模式支持从台账直出报告"

    assert _truncate_notes(text) == text
    # 没被截断就不该暗示用户「完整说明见发布页」。
    assert NOTES_TRUNCATED_HINT not in _truncate_notes(text)


def test_long_notes_break_at_a_line_boundary_and_point_at_the_release_page():
    text = "\n".join(_LINES)
    assert len(text) > NOTES_BUDGET

    result = _truncate_notes(text)

    assert result.endswith(NOTES_TRUNCATED_HINT)
    # 总长必须留在 schema 上限内，否则 UpdateCheckResult 构造即报错。
    assert len(result) <= NOTES_BUDGET
    body = result[: -len(NOTES_TRUNCATED_HINT)].rstrip()
    kept = body.split("\n")
    # 保留下来的每一行都是完整的原文行——没有半句话、也没有半行表格。
    assert all(line in _LINES for line in kept)
    # 没有在最前面几行就断掉：回退点不早于预算的 60%。
    assert len(body) > NOTES_BUDGET // 2


def test_exactly_the_budget_counts_as_not_truncated():
    text = "甲" * NOTES_BUDGET
    assert len(text) == NOTES_BUDGET

    result = _truncate_notes(text)

    assert result == text
    assert NOTES_TRUNCATED_HINT not in result


def test_one_giant_line_falls_back_to_a_hard_cut():
    # 整段没有换行时无处可退，只能硬截——但仍要补提示且不超预算。
    text = "乙" * (NOTES_BUDGET + 500)

    result = _truncate_notes(text)

    assert result.startswith("乙" * 400)
    assert result.endswith(NOTES_TRUNCATED_HINT)
    assert len(result) <= NOTES_BUDGET


def test_check_update_returns_truncated_notes_that_still_fit_the_schema(client, monkeypatch):
    # 端到端一遍：走真实的 check_for_update 与 schema 校验，确认拼了提示也不会超长。
    clear_cache()

    async def fake_release(_repo: str) -> dict:
        return {
            "tag_name": "v99.0.0",
            "name": "测试更新",
            "html_url": "https://github.com/example/ResumeForge/releases/tag/v99.0.0",
            "published_at": "2026-09-24T00:00:00Z",
            "body": "\n".join(_LINES),
            "assets": [],
        }

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", fake_release)

    response = client.get("/api/update/check?refresh=true")

    assert response.status_code == 200
    notes = response.json()["notes"]
    assert notes.endswith(NOTES_TRUNCATED_HINT)
    assert len(notes) <= NOTES_BUDGET


# ── P2-1：降级文案的结论前置 ────────────────────────────────────────────────


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


def test_rate_limited_403_leads_with_the_conclusion_and_says_when_it_recovers(
    client, monkeypatch
):
    """01-2：额度用完时那句话必须是「已确认有新版 X … 约 N 分钟后恢复」。

    顺序是有意义的：用户点「检查更新」先要知道"到底有没有新版本"，"更新说明这次没取到"
    只能排在后面；`N` 来自 `X-RateLimit-Reset`（UTC epoch 秒）。
    """
    clear_cache()
    reset_at = int(time.time()) + 7 * 60
    _block_api(
        monkeypatch,
        status_code=403,
        headers={"x-ratelimit-limit": "60", "x-ratelimit-remaining": "0",
                 "x-ratelimit-reset": str(reset_at)},
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


def test_429_is_treated_as_rate_limited_even_without_the_remaining_header(
    client, monkeypatch
):
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


# ── P2-1：两层节流 ──────────────────────────────────────────────────────────


def _counting_release(monkeypatch, calls: list[int]):
    async def fake_release(_repo: str) -> dict:
        calls.append(1)
        return {"tag_name": "v99.0.0", "name": "测试更新", "body": "x", "assets": []}

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", fake_release)


def test_five_rechecks_in_a_row_hit_the_upstream_once(client, monkeypatch):
    """01-3：连点 5 次「重新检查」只产生 1 次上游请求（60 秒最小间隔）。"""
    clear_cache()
    calls: list[int] = []
    _counting_release(monkeypatch, calls)

    bodies = [client.get("/api/update/check?refresh=true").json() for _ in range(5)]

    assert len(calls) == 1
    # 第一次是真的问了，之后 4 次都是节流层给的旧结果。
    assert bodies[0]["cached"] is False
    assert [body["cached"] for body in bodies[1:]] == [True] * 4
    # 节流不该改变结论本身。
    assert all(body["latest_version"] == "99.0.0" for body in bodies)


def test_second_plain_check_uses_the_fifteen_minute_cache(client, monkeypatch):
    """「检查更新」传 refresh=false：第二次点击必须命中缓存，不发网络请求。"""
    clear_cache()
    calls: list[int] = []
    _counting_release(monkeypatch, calls)

    first = client.get("/api/update/check").json()
    second = client.get("/api/update/check").json()

    assert len(calls) == 1
    assert first["cached"] is False
    assert second["cached"] is True


def test_refresh_still_works_after_the_throttle_window(client, monkeypatch):
    """60 秒之后「重新检查」必须真的再问一次（别把节流写成永久缓存）。"""
    clear_cache()
    calls: list[int] = []
    _counting_release(monkeypatch, calls)

    client.get("/api/update/check?refresh=true")
    # 把缓存时间戳往回拨 61 秒，避免用例真的等一分钟。
    cached_at, result = update_check._cache[update_check.repository()]
    update_check._cache[update_check.repository()] = (cached_at - 61, result)

    body = client.get("/api/update/check?refresh=true").json()

    assert len(calls) == 2
    assert body["cached"] is False


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
