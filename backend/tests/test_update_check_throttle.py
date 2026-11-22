# SPDX-License-Identifier: Apache-2.0
# 守的是：两层节流——连点「重新检查」只打一次上游，普通「检查更新」命中 15 分钟缓存。
"""「检查更新」的两层节流：60 秒最小间隔 + 15 分钟缓存。

用户会连点「重新检查」。以前每点一次就打一次 api.github.com，匿名额度（60 次/小时）
几分钟就耗尽，于是好好的机器上「检查更新」变成一句"额度用完"。所以：

- ``refresh=true`` 走 60 秒最小间隔：5 次连点只允许 1 次上游请求，其余都是节流层给的旧
  结果（``cached=True``），但结论本身不许被节流改写；
- ``refresh=false`` 走 15 分钟缓存：第二次点击必须不发网络请求；
- 60 秒之后 ``refresh=true`` 必须真的再问一次——节流不是永久缓存。

上游请求用**本地计数替身**统计（`_fetch_latest_release` 换成本地函数），本机此刻 GitHub
匿名额度已经用完，真打一次只会拿到另一个 403。

发布说明截断见 `test_update_check.py`，降级文案见 `test_update_check_degrade.py`，
出网出口见 `test_update_check_outbound.py`。
"""

import app.services.update_check as update_check
from app.services.update_check import clear_cache


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
