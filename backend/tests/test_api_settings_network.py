# SPDX-License-Identifier: Apache-2.0
"""``GET|PUT /api/settings/network``（T02）。

钉四件事：
1. 默认 ``system``，**不预设**直连（那是唯一会让用户"自己把自己断网"的开关）；
2. 改完立即生效：连接池 generation +1（不重启就换客户端）；
3. 响应里永远没有口令本体，只有 ``has_password``；
4. socks 在**写入时**就被挡下（400 + 中文原因），而不是等一次模型调用失败。
"""

from __future__ import annotations

import json

from app.services import net_proxy


def test_defaults_to_system_mode(client):
    body = client.get("/api/settings/network").json()
    assert body["proxy_mode"] == "system"
    assert body["supports_socks"] is False
    assert body["has_password"] is False
    # 测试环境没有代理：有效路径就是直连。
    assert body["effective"]["is_direct"] is True


def test_direct_mode_is_explicit_and_warned(client):
    response = client.put("/api/settings/network", json={"proxy_mode": "direct"})
    assert response.status_code == 200
    body = response.json()
    assert body["proxy_mode"] == "direct"
    assert "全部连不上" in body["notice"]
    assert body["effective"]["is_direct"] is True


def test_saving_bumps_generation_without_restart(client):
    before = net_proxy.generation()
    client.put("/api/settings/network", json={"proxy_mode": "direct"})
    assert net_proxy.generation() == before + 1


def test_custom_proxy_is_used_by_the_next_resolution(client):
    response = client.put(
        "/api/settings/network",
        json={"proxy_mode": "custom", "proxy_url": "http://127.0.0.1:7891"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["proxy_mode"] == "custom"
    assert body["effective"]["host_port"] == "127.0.0.1:7891"
    assert body["effective"]["source"] == net_proxy.SOURCE_CUSTOM


def test_socks_is_rejected_at_write_time(client):
    response = client.put(
        "/api/settings/network",
        json={"proxy_mode": "custom", "proxy_url": "socks5://127.0.0.1:1080"},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "socks" in detail
    # 引导换 http 端口，而不是让用户去装依赖。
    assert "http" in detail


def test_invalid_url_is_rejected_with_a_readable_reason(client):
    # 无协议头的 `127.0.0.1:7890` 会被补成 http://（用户常见粘贴形态），所以拿真正的
    # 非法协议来验：不支持 socks 之外的 scheme 时也必须给中文原因。
    response = client.put(
        "/api/settings/network",
        json={"proxy_mode": "custom", "proxy_url": "ftp://127.0.0.1:7890"},
    )
    assert response.status_code == 400
    assert response.json()["detail"].strip()


def test_password_is_write_only(client, tmp_path):
    response = client.put(
        "/api/settings/network",
        json={
            "proxy_mode": "custom",
            "proxy_url": "http://127.0.0.1:7892",
            "proxy_username": "alice",
            "proxy_password": "s3cret-token",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["has_password"] is True
    assert "s3cret-token" not in json.dumps(body, ensure_ascii=False)

    # 再读一次：口令不回显，但运行时解析会把它拼进代理 URL（只在内存里）。
    again = client.get("/api/settings/network")
    assert again.status_code == 200
    assert "s3cret-token" not in again.text
    assert again.json()["has_password"] is True
    resolved = net_proxy.resolve_proxy(target_url="https://api.deepseek.com")
    assert resolved.has_auth is True
    assert resolved.host_port == "127.0.0.1:7892"


def test_clear_sentinel_removes_the_password(client):
    client.put(
        "/api/settings/network",
        json={
            "proxy_mode": "custom",
            "proxy_url": "http://127.0.0.1:7893",
            "proxy_password": "to-be-cleared",
        },
    )
    cleared = client.put(
        "/api/settings/network",
        json={
            "proxy_mode": "custom",
            "proxy_url": "http://127.0.0.1:7893",
            "proxy_password": "__clear__",
        },
    )
    assert cleared.status_code == 200
    assert cleared.json()["has_password"] is False


# ===== 系统证书库开关（T05）=====


def test_trust_system_certs_defaults_to_off(client):
    body = client.get("/api/settings/network").json()
    # 默认关：打开它等于承认这台机器上任何被系统信任的中间人证书都可信。
    assert body["trust_system_certs"] is False
    kwargs = net_proxy.transport_kwargs(net_proxy.ProxyInfo())
    assert "verify" not in kwargs


def test_trust_system_certs_switch_is_persisted_and_changes_verify(client):
    response = client.put(
        "/api/settings/network",
        json={"proxy_mode": "system", "trust_system_certs": True},
    )
    assert response.status_code == 200
    assert response.json()["trust_system_certs"] is True
    kwargs = net_proxy.transport_kwargs(net_proxy.ProxyInfo())
    assert "verify" in kwargs
    # 不传该字段的旧客户端不该把它关掉。
    again = client.put("/api/settings/network", json={"proxy_mode": "system"})
    assert again.json()["trust_system_certs"] is True
