# SPDX-License-Identifier: Apache-2.0
"""协议切换后 base_url 变了 path：密钥必须还能用，模型列表端点必须还能打对。

用户报的现场（2026-11）
---------------------
DeepSeek 记录的接口协议切到「OpenAI Responses」后点「测试连接」，界面报
「Base URL 与配置记录不一致，请重新填写 API Key」——他没换服务商、也没换 Key，手里
根本没有第二个 Key。根因是密钥引用的绑定身份用了**完整 URL（含 path）**，而前端切协议
会把 base_url 从 ``https://api.deepseek.com`` 改写成 ``.../responses``。

同一个根因的第二个症状：「获取可用模型」按 base_url 拼 ``/models``，于是请求打到
``https://api.deepseek.com/responses/models`` → 404 → 界面说"该服务商没有提供模型
列表接口"。

本文件钉住两件事
----------------
1. 绑定粒度是 origin（``scheme://host[:port]``）：path / 查询串变化不影响解析，**主机
   变化必须继续报错**（含 ``api.deepseek.com.evil.example.com`` 这种拿官方域名当前缀的
   仿冒主机——它是另一个 host）；
2. ``models_endpoint`` 先剥协议后缀（``/chat/completions``、``/responses``、
   ``/messages``）再拼 ``/models``。

三个分支（生效配置掩码 / 数据集旧记录 / 全局记录）各有用例：三处比较是同一条规则，
少改一处就会留下"换个入口又坏"的坑。
"""

from __future__ import annotations

import pytest
from app.models.setting import LLMConfigRecord
from app.schemas.setting import LLMConfig
from app.services.api_key_crypto import encrypt_key
from app.services.global_llm_profiles import read_global_llm, read_record_config
from app.services.llm.payload import models_endpoint
from app.services.llm_key_refs import RECORD_API_KEY_PREFIX
from app.services.llm_settings import (
    base_url_binding_identity,
    get_llm_config,
    opaque_base_url_identity,
)

BASE = "https://api.deepseek.com"
SECRET = "sk-deepseek-only"


class _FakeProvider:
    """纯内存 provider：只验证"配置解析到了什么"，不联网。"""

    async def chat(self, _messages, *, thinking: bool = True) -> str:
        return "正常"


@pytest.fixture()
def seen(monkeypatch):
    """provider 实际收到的配置（密钥有没有被还原，看这里最直接）。"""
    captured: dict[str, str] = {}

    def fake_create_provider(resolved):
        captured["api_key"] = resolved.api_key
        captured["base_url"] = resolved.base_url
        return _FakeProvider()

    monkeypatch.setattr("app.api.settings.create_provider", fake_create_provider)
    return captured


def _save_active_config(client, *, base_url: str = BASE) -> dict:
    """保存一份生效配置，返回**脱敏后**的响应体（api_key 是引用占位符）。"""
    payload = LLMConfig(
        base_url=base_url, api_key=SECRET, model="deepseek-flash", provider="deepseek"
    )
    response = client.put("/api/settings/llm", json=payload.model_dump())
    assert response.status_code == 200, response.text
    assert SECRET not in response.text
    return response.json()


# ===== 绑定身份（纯函数） =====


@pytest.mark.parametrize(
    "other",
    [
        f"{BASE}/responses",
        f"{BASE}/messages",
        f"{BASE}/v1",
        f"{BASE}/",
        "HTTPS://API.DEEPSEEK.COM",
        "https://api.deepseek.com:443",
        "https://api.deepseek.com/v1?trace=1#frag",
    ],
)
def test_binding_identity_ignores_path_and_default_port(other):
    """同一台主机上的 path / 查询串 / 默认端口 / 大小写差异都不算"换了地址"。"""
    assert base_url_binding_identity(other) == base_url_binding_identity(BASE)


@pytest.mark.parametrize(
    "other",
    [
        "https://evil.example.com",
        "https://api.deepseek.com.evil.example.com",
        "https://api.deepseek.com.cn",
        "http://api.deepseek.com",
        "https://api.deepseek.com:8443",
    ],
)
def test_binding_identity_keeps_hosts_apart(other):
    """主机（或 scheme / 非默认端口）不同就是不同身份——这是安全底线。"""
    assert base_url_binding_identity(other) != base_url_binding_identity(BASE)


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("https://[::1]:8443/v1", "https://[::1]:8443"),
        ("https://[::1]/v1", "https://[::1]/"),
    ],
)
def test_binding_identity_brackets_ipv6_hosts(left, right):
    assert base_url_binding_identity(left) == base_url_binding_identity(right)


@pytest.mark.parametrize("value", ["localhost:11434/v1", "/v1", "", "   "])
def test_binding_identity_falls_back_to_the_opaque_string(value):
    """解析不出 scheme+host 时不猜主机，退回"去尾斜杠的整串"（与拆分前一致）。"""
    assert base_url_binding_identity(value) == opaque_base_url_identity(value)


# ===== 分支一：生效配置的掩码密钥 =====


def test_protocol_suffix_still_resolves_the_saved_key(client, seen):
    """path 由 `` 变成 ``/responses``：解析成功且拿到原 Key。"""
    masked = _save_active_config(client)
    assert masked["api_key"].startswith("********")

    switched = {**masked, "base_url": f"{BASE}/responses", "api_style": "responses"}
    response = client.post("/api/settings/llm/test", json=switched)

    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
    assert seen["api_key"] == SECRET
    assert seen["base_url"] == f"{BASE}/responses"


@pytest.mark.parametrize(
    "host", ["evil.example.com", "api.deepseek.com.evil.example.com", "api.deepseek.com.cn"]
)
def test_masked_key_cannot_be_forwarded_to_another_host(client, db_session, seen, host):
    """换主机（含把官方域名当前缀的仿冒主机）必须继续报错，且 provider 一次都不被调用。"""
    masked = _save_active_config(client)
    forged = {**masked, "base_url": f"https://{host}/responses"}

    save_response = client.put("/api/settings/llm", json=forged)
    test_response = client.post("/api/settings/llm/test", json=forged)

    assert save_response.status_code == 400
    assert "配置记录不一致" in save_response.json()["detail"]
    assert test_response.status_code == 200
    assert test_response.json()["ok"] is False
    assert "配置记录不一致" in test_response.json()["message"]
    assert seen == {}, "主机不一致时不该走到 provider"
    # 原配置一个字都没被改写。
    db_session.expire_all()
    stored = get_llm_config(db_session)
    assert stored.base_url == BASE and stored.api_key == SECRET


# ===== 分支二：数据集旧记录（``********:record:<id>``） =====


def test_dataset_record_reference_survives_the_path_rewrite(client, db_session, seen):
    row = LLMConfigRecord(
        name="DeepSeek 旧记录",
        provider="deepseek",
        base_url=BASE,
        api_key=encrypt_key(SECRET),
        model="deepseek-flash",
    )
    db_session.add(row)
    db_session.commit()
    reference = f"{RECORD_API_KEY_PREFIX}{row.id}"

    response = client.post(
        "/api/settings/llm/test",
        json={
            "base_url": f"{BASE}/responses",
            "api_key": reference,
            "model": "deepseek-flash",
            "api_style": "responses",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
    assert seen["api_key"] == SECRET


def test_dataset_record_reference_is_rejected_for_another_host(client, db_session):
    row = LLMConfigRecord(
        name="DeepSeek 旧记录",
        provider="deepseek",
        base_url=BASE,
        api_key=encrypt_key(SECRET),
        model="deepseek-flash",
    )
    db_session.add(row)
    db_session.commit()

    response = client.post(
        "/api/settings/llm/test",
        json={
            "base_url": "https://api.deepseek.com.evil.example.com",
            "api_key": f"{RECORD_API_KEY_PREFIX}{row.id}",
            "model": "deepseek-flash",
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "配置记录不一致" in response.json()["message"]


# ===== 分支三：全局记录（``********:profile:<id>``） =====


def test_global_profile_reference_survives_the_anthropic_rewrite(client, seen):
    """切到 Anthropic 专用地址（``/anthropic/v1``）：origin 未变，Key 仍能用。"""
    masked = _save_active_config(client)

    response = client.post(
        "/api/settings/llm/test",
        json={
            **masked,
            "base_url": f"{BASE}/anthropic/v1",
            "api_style": "anthropic",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
    assert seen["api_key"] == SECRET


def test_global_profile_reference_is_rejected_for_another_host(client, seen):
    masked = _save_active_config(client)

    response = client.post(
        "/api/settings/llm/test",
        json={**masked, "base_url": "https://evil.example.com/anthropic/v1"},
    )

    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "配置记录不一致" in response.json()["message"]
    assert seen == {}


def test_global_profile_save_with_a_new_host_is_refused(client):
    """保存路径同样按 origin 判：换主机的"保存"不能把密钥带过去。"""
    masked = _save_active_config(client)

    response = client.put(
        "/api/settings/llm", json={**masked, "base_url": "https://evil.example.com"}
    )

    assert response.status_code == 400
    assert "重新填写 API Key" in response.json()["detail"]


# ===== 「留空 = 保留密钥」也要按 origin 判断 =====
#
# 这条路径比上面的占位符更隐蔽：前端切完协议后如果以空 api_key 保存（"我没改密钥"），
# 旧实现按整串比较 base_url → 判成换了地址 → keep="" → 用户的历史密钥被**静默清空**，
# 而且不报错。换主机时仍然不保留（安全底线不变）。


def test_blank_key_save_after_protocol_switch_keeps_the_secret(client):
    _save_active_config(client)

    response = client.put(
        "/api/settings/llm",
        json={
            "provider": "deepseek",
            "base_url": f"{BASE}/responses",
            "model": "deepseek-flash",
            "api_style": "responses",
            "api_key": "",
        },
    )

    assert response.status_code == 200, response.text
    assert SECRET not in response.text
    stored = read_global_llm()
    assert stored is not None
    assert stored.config.base_url == f"{BASE}/responses"
    # path 变了、主机没变：密钥保留。
    assert stored.config.api_key == SECRET


def test_blank_key_save_for_another_host_does_not_keep_the_secret(client):
    _save_active_config(client)

    response = client.put(
        "/api/settings/llm",
        json={
            "provider": "deepseek",
            "base_url": "https://evil.example.com/responses",
            "model": "deepseek-flash",
            "api_style": "responses",
            "api_key": "",
        },
    )

    assert response.status_code == 200, response.text
    stored = read_global_llm()
    assert stored is not None
    assert stored.config.base_url == "https://evil.example.com/responses"
    # 换主机：不保留（否则一次"留空保存"就把密钥送到了另一台机器上）。
    assert stored.config.api_key == ""


def test_blank_key_record_save_after_protocol_switch_keeps_the_record_secret(client):
    name = "DeepSeek 记录"
    created = client.post(
        "/api/settings/llm/records",
        json={
            "name": name,
            "provider": "deepseek",
            "base_url": BASE,
            "model": "deepseek-flash",
            "api_key": SECRET,
        },
    )
    assert created.status_code == 200, created.text
    assert SECRET not in created.text

    updated = client.post(
        "/api/settings/llm/records",
        json={
            "name": name,
            "provider": "deepseek",
            "base_url": f"{BASE}/anthropic/v1",
            "model": "deepseek-flash",
            "api_style": "anthropic",
            "api_key": "",
        },
    )

    assert updated.status_code == 200, updated.text
    stored = read_record_config(name)
    assert stored is not None
    assert stored.base_url == f"{BASE}/anthropic/v1"
    assert stored.api_key == SECRET


# ===== 模型列表端点：剥掉协议后缀再拼 /models =====


@pytest.mark.parametrize(
    ("base_url", "expected"),
    [
        (BASE, f"{BASE}/models"),
        (f"{BASE}/v1", f"{BASE}/v1/models"),
        (f"{BASE}/chat/completions", f"{BASE}/models"),
        (f"{BASE}/v1/chat/completions", f"{BASE}/v1/models"),
        (f"{BASE}/responses", f"{BASE}/models"),
        (f"{BASE}/v1/responses", f"{BASE}/v1/models"),
        (f"{BASE}/messages", f"{BASE}/models"),
        (f"{BASE}/v1/messages", f"{BASE}/v1/models"),
        (f"{BASE}/anthropic/v1/messages", f"{BASE}/anthropic/v1/models"),
        # 尾斜杠由 validated_base_url 统一去掉，剥后缀仍然成立。
        (f"{BASE}/v1/messages/", f"{BASE}/v1/models"),
    ],
)
def test_models_endpoint_strips_protocol_suffixes(base_url, expected):
    assert models_endpoint(base_url) == expected
