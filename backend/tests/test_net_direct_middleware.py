# SPDX-License-Identifier: Apache-2.0
"""`X-RF-Net-Direct` 请求级直连覆盖（T02）。

为什么值得单独一条：设置页的「用直连重试一次」就是发这个头。它一旦失效，用户点完
按钮看到的结果与第一次完全相同，却会以为"直连也连不上"——把网络问题误判成服务端问题。

三条不变量：
1. 带头 → 该请求内 `direct_override_active()` 为真；
2. 不带头 → 为假（默认跟随设置，不能悄悄变成直连）；
3. 请求结束 → 覆盖必须被清掉（ContextVar 泄漏会让后续所有请求都走直连）。
"""

from __future__ import annotations

from app.middleware.net_direct import NetDirectOverrideMiddleware
from app.services import net_proxy
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(NetDirectOverrideMiddleware)

    @app.get("/probe")
    def probe() -> dict[str, bool]:
        return {"direct": net_proxy.direct_override_active()}

    return app


def test_header_forces_direct_for_that_request_only():
    client = TestClient(_app())

    with_header = client.get("/probe", headers={net_proxy.DIRECT_HEADER: "1"})
    assert with_header.json() == {"direct": True}

    # 同一个 client 的下一次请求没有头：必须回到"跟随设置"。
    without_header = client.get("/probe")
    assert without_header.json() == {"direct": False}


def test_non_truthy_header_values_are_ignored():
    client = TestClient(_app())
    for value in ("0", "false", "yes", ""):
        response = client.get("/probe", headers={net_proxy.DIRECT_HEADER: value})
        assert response.json() == {"direct": False}, value


def test_override_does_not_leak_after_the_request():
    client = TestClient(_app())
    client.get("/probe", headers={net_proxy.DIRECT_HEADER: "true"})
    # 出了请求作用域，ContextVar 必须已经 reset。
    assert net_proxy.direct_override_active() is False
