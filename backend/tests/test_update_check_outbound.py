# SPDX-License-Identifier: Apache-2.0
# 守的是：出网出口——两个 GitHub 探测都必须经过 net_client 工厂，且任何网络失败都降级。
"""「检查更新」的出网口径：两个 GitHub 出口都必须走 net_client 工厂。

为什么值得两条守卫：``net_client`` 的模块约定写着"这里是**唯一**允许直接构造 httpx
客户端的地方，代理只由本模块决定"。此前这两处都是 ``httpx.AsyncClient(trust_env=True)``
——只认环境变量，用户在设置页选了代理、或机器开着系统代理（注册表）时，这条请求照样裸奔
直连（2026-11-21 与桌面更新器一起定位）。

走工厂之后多了一种失败：代理是 socks 时工厂会明确报错（本项目不装 socks 支持）。它不能
变成 500——「检查更新」的契约是任何网络问题都降级成一句话。

发布说明截断见 `test_update_check.py`，降级文案与 `degraded` 标记见
`test_update_check_degrade.py`，缓存与节流见 `test_update_check_throttle.py`。
"""

import app.services.update_check as update_check
import pytest
from app.services import net_proxy
from app.services.update_check import clear_cache


async def test_both_fetch_paths_go_through_the_shared_proxy_factory(monkeypatch):
    """「检查更新」的两个出口都要经过 ``net_client.build_async_client``。

    手法：把工厂换成"记下参数再抛哨兵"的桩。有人改回直接构造客户端时，这里不会再抛
    哨兵，用例当场变红；``url`` 与 ``follow_redirects`` 也一并钉住——传错地址（比如把
    API 地址传给备用探测）或让 httpx 自动跟随 3xx，备用探测都会失去意义。
    """
    calls: list[dict] = []
    sentinel = RuntimeError("net_client factory sentinel")

    def fake_build(**kwargs):
        calls.append(kwargs)
        raise sentinel

    monkeypatch.setattr(update_check, "build_async_client", fake_build)

    cases = (
        (update_check._fetch_latest_release, update_check.RELEASES_API),
        (update_check._fetch_latest_tag_via_redirect, update_check.RELEASES_REDIRECT),
    )
    for fetch, template in cases:
        with pytest.raises(RuntimeError, match="factory sentinel"):
            await fetch("owner/repo")
        assert calls[-1]["url"] == template.format(repo="owner/repo"), fetch.__name__
        assert calls[-1]["follow_redirects"] is False, fetch.__name__
        assert calls[-1]["timeout"] is update_check._TIMEOUT, fetch.__name__
    assert len(calls) == 2, "两条路径各构造一次客户端"


def test_socks_proxy_degrades_to_a_message_instead_of_raising(client, monkeypatch):
    """走工厂之后多了一种失败：代理是 socks 时工厂会明确报错（本项目不装 socks 支持）。

    不能让它变成 500——「检查更新」的契约是任何网络问题都降级成一句话。这条钉住新引入
    的失败模式也走降级路径（改动前直接构造 httpx 客户端时不存在这个异常）。
    """
    clear_cache()

    def boom(**_kwargs):
        raise net_proxy.SocksProxyUnsupported(net_proxy.ProxyInfo(url="socks5://127.0.0.1:1080"))

    monkeypatch.setattr(update_check, "build_async_client", boom)

    body = client.get("/api/update/check").json()

    assert body["update_available"] is False
    assert "socks" in body["message"], body["message"]
