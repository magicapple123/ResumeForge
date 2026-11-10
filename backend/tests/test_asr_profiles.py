# SPDX-License-Identifier: Apache-2.0
"""语音转写「命名配置」后端：全局存储、旧数据迁移、按条的 Key 口径、激活/删除回落。

对应问题清单 §2.9 的 11 条。所有用例都不出网：协议链路复用 test_transcribe 的本地假
上游（127.0.0.1 随机端口），其余用「记录探测参数」的钩子替换 probe_asr_connection
——验的是"拿哪一份 Key/地址去探测"，不是网络本身。
"""

from __future__ import annotations

import json
import threading
from typing import Any

import pytest
from app.api import transcribe as transcribe_api
from app.models.setting import AppSetting
from app.services.api_key_crypto import encrypt_key
from app.services.asr_profiles import CLEAR_API_KEY, MAX_ASR_PROFILES
from app.services.asr_settings import resolve_asr_api_key
from app.services.global_settings import load_state
from test_asr_protocol import _FakeUpstream

DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
GROQ_URL = "https://api.groq.com/openai/v1"
LEGACY_KEY = "sk-legacy-asr-0123456789"


@pytest.fixture
def fake_asr():
    """同时实现两种协议的假上游：openai 走 multipart，dashscope 走 chat。"""
    server = _FakeUpstream()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture
def probe_calls(monkeypatch) -> list[dict[str, Any]]:
    """替换探测实现：只记录参数并返回成功，不发网络请求。"""
    calls: list[dict[str, Any]] = []

    async def _probe(*, base_url: str, api_key: str, model: str, protocol: str):
        calls.append(
            {"base_url": base_url, "api_key": api_key, "model": model, "protocol": protocol}
        )
        return True, "ok", 12

    monkeypatch.setattr(transcribe_api, "probe_asr_connection", _probe)
    return calls


def _legacy_rows(
    db_session,
    *,
    base_url: str = DASHSCOPE_URL,
    model: str = "qwen3-asr-flash",
    protocol: str = "dashscope",
    api_key: str = LEGACY_KEY,
) -> None:
    """造出升级前那种"每个数据集一份"的旧行。"""
    db_session.add(
        AppSetting(
            key="asr_config",
            value=json.dumps({"base_url": base_url, "model": model, "protocol": protocol}),
        )
    )
    if api_key:
        db_session.add(AppSetting(key="asr_api_key", value=encrypt_key(api_key)))
    db_session.commit()
    db_session.expire_all()


def _create(
    client,
    name: str,
    *,
    base_url: str = GROQ_URL,
    model: str = "whisper-large-v3",
    protocol: str = "openai",
    api_key: str = "sk-groq-profile",
    preset_id: str = "groq",
) -> dict[str, Any]:
    response = client.post(
        "/api/settings/asr/profiles",
        json={
            "name": name,
            "preset_id": preset_id,
            "base_url": base_url,
            "model": model,
            "protocol": protocol,
            "api_key": api_key,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _by_name(state: dict[str, Any], name: str) -> dict[str, Any]:
    return next(item for item in state["profiles"] if item["name"] == name)


def _probe(client, profile_id: str, draft: dict[str, Any] | None = None) -> dict[str, Any]:
    response = client.post(f"/api/settings/asr/profiles/{profile_id}/test", json=draft or {})
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# 1. 旧配置迁移：一条「默认配置」、Key 可解密、幂等、空配置只写标记
# ---------------------------------------------------------------------------


def test_migrates_legacy_config_into_default_profile(client, db_session):
    _legacy_rows(db_session)

    state = client.get("/api/settings/asr/profiles").json()

    assert [item["name"] for item in state["profiles"]] == ["默认配置"]
    profile = state["profiles"][0]
    assert profile["base_url"] == DASHSCOPE_URL
    assert profile["model"] == "qwen3-asr-flash"
    assert profile["protocol"] == "dashscope"
    assert profile["preset_id"] == "dashscope"
    assert profile["has_key"] is True and profile["configured"] is True
    assert state["active_profile_id"] == profile["id"]
    # 运行时解析到同一条：迁移后的 Key 真能用（加密往返）。
    assert resolve_asr_api_key(db_session) == LEGACY_KEY
    # 全局文件仍是版本 2（升版本会让主题与大模型配置一起读丢）。
    assert load_state()["version"] == 2
    # 旧行保留作回滚面包屑。
    assert db_session.get(AppSetting, "asr_config") is not None
    # 响应里绝不出现 Key 原文。
    assert LEGACY_KEY not in json.dumps(state, ensure_ascii=False)


def test_migration_without_legacy_writes_marker_and_never_falls_back(client, db_session):
    state = client.get("/api/settings/asr/profiles").json()
    assert state == {"active_profile_id": "", "profiles": []}
    assert load_state()["asr_profiles"] == {
        "version": 1,
        "active_profile_id": "",
        "profiles": [],
    }

    # 迁移之后再冒出旧行也不回退：否则"删光配置"会被旧值悄悄复活。
    _legacy_rows(db_session)
    assert client.get("/api/settings/asr/profiles").json()["profiles"] == []
    assert client.get("/api/settings/asr").json()["configured"] is False
    assert resolve_asr_api_key(db_session) == ""


def test_migration_is_idempotent(client, db_session):
    _legacy_rows(db_session)
    first = client.get("/api/settings/asr/profiles").json()
    second = client.get("/api/settings/asr/profiles").json()
    assert first == second

    # 改旧行不会重新导入（已迁移标记优先）。
    row = db_session.get(AppSetting, "asr_config")
    assert row is not None
    row.value = json.dumps({"base_url": GROQ_URL, "model": "other", "protocol": "openai"})
    db_session.commit()
    assert client.get("/api/settings/asr/profiles").json() == first


# ---------------------------------------------------------------------------
# 2. 增删改：重名 409、超限 400、名称超 64 字 400、不存在 404
# ---------------------------------------------------------------------------


def test_create_update_delete_profile(client):
    created = _create(client, "公司 Groq")
    profile = _by_name(created, "公司 Groq")
    assert profile["configured"] is True and profile["has_key"] is True
    assert profile["preset_id"] == "groq"
    # 新建不自动设为生效（用户回列表点「使用」才切换）。
    assert created["active_profile_id"] == ""

    # 按 id 更新：名称、地址、模型一起改。
    updated = client.post(
        "/api/settings/asr/profiles",
        json={
            "id": profile["id"],
            "name": "家里 Groq",
            "preset_id": "groq",
            "base_url": "https://api.groq.com/openai/v1",
            "model": "whisper-large-v3",
            "protocol": "openai",
            "api_key": "",
        },
    ).json()
    renamed = _by_name(updated, "家里 Groq")
    assert renamed["id"] == profile["id"]
    # 空 Key + 地址协议未变：保留这一条自己的旧 Key。
    assert renamed["has_key"] is True

    removed = client.delete("/api/settings/asr/profiles/" + profile["id"])
    assert removed.status_code == 200
    assert removed.json()["profiles"] == []

    missing = client.delete("/api/settings/asr/profiles/a_not_exist")
    assert missing.status_code == 404


def test_profile_name_conflict_returns_409(client):
    _create(client, "重名")
    response = client.post(
        "/api/settings/asr/profiles",
        json={"name": "重名", "base_url": GROQ_URL, "model": "m", "protocol": "openai"},
    )
    assert response.status_code == 409
    assert "同名配置" in response.json()["detail"]


def test_profile_limit_and_long_name_are_rejected(client):
    for index in range(MAX_ASR_PROFILES):
        _create(client, f"配置 {index}", api_key="")
    over = client.post(
        "/api/settings/asr/profiles",
        json={"name": "第 11 条", "base_url": GROQ_URL, "model": "m", "protocol": "openai"},
    )
    assert over.status_code == 400
    assert str(MAX_ASR_PROFILES) in over.json()["detail"]

    long_name = "x" * 65
    response = client.post(
        "/api/settings/asr/profiles",
        json={"name": long_name, "base_url": GROQ_URL, "model": "m", "protocol": "openai"},
    )
    assert response.status_code == 400
    assert "64" in response.json()["detail"]


# ---------------------------------------------------------------------------
# 3. Key 口径：按条判断，绝不跨条继承（反证：A 有 Key、B 空 Key）
# ---------------------------------------------------------------------------


def test_key_rules_are_per_profile(client, probe_calls):
    state = _create(client, "A 有 Key", api_key="sk-profile-A-0123456789")
    profile_a = _by_name(state, "A 有 Key")["id"]
    state = _create(client, "B 无 Key", api_key="")
    profile_b = _by_name(state, "B 无 Key")["id"]

    # A 的测试连接用 A 自己的 Key。
    assert _probe(client, profile_a)["ok"] is True
    assert probe_calls[-1]["api_key"] == "sk-profile-A-0123456789"

    # 反证：B 空 Key 不继承 A 的 Key，也不发上游请求。
    before = len(probe_calls)
    assert _probe(client, profile_b)["ok"] is False
    assert len(probe_calls) == before

    # 掩码 / 空串 + 地址协议未变 → 保留这一条自己的 Key。
    client.post(
        "/api/settings/asr/profiles",
        json={
            "id": profile_a,
            "name": "A 有 Key",
            "base_url": GROQ_URL,
            "model": "whisper-large-v3-turbo",
            "protocol": "openai",
            "api_key": "********",
        },
    )
    assert _probe(client, profile_a)["ok"] is True
    assert probe_calls[-1]["api_key"] == "sk-profile-A-0123456789"

    # 换地址 + 掩码 → 旧 Key 清空（不把 A 的 Key 发给新主机）。
    changed = client.post(
        "/api/settings/asr/profiles",
        json={
            "id": profile_a,
            "name": "A 有 Key",
            "base_url": "https://api.siliconflow.cn/v1",
            "model": "whisper-large-v3",
            "protocol": "openai",
            "api_key": "********",
        },
    ).json()
    assert _by_name(changed, "A 有 Key")["has_key"] is False
    before = len(probe_calls)
    assert _probe(client, profile_a)["ok"] is False
    assert len(probe_calls) == before

    # 显式 __clear__ → 清空；新建时 Key 留空就是没有 Key（不是"沿用上一条"）。
    cleared = client.post(
        "/api/settings/asr/profiles",
        json={
            "id": profile_b,
            "name": "B 无 Key",
            "base_url": GROQ_URL,
            "model": "whisper-large-v3",
            "protocol": "openai",
            "api_key": CLEAR_API_KEY,
        },
    )
    assert cleared.status_code == 200
    assert _by_name(cleared.json(), "B 无 Key")["has_key"] is False


def test_probe_new_profile_draft_never_reuses_saved_key(client, probe_calls):
    _create(client, "已存 Key", api_key="sk-existing-profile-0123")

    # 新建弹窗没有 id：草稿里必须自带 Key，否则直接提示先填写。
    missing = _probe(client, "new", {"base_url": GROQ_URL, "model": "whisper-large-v3"})
    assert missing["ok"] is False
    assert probe_calls == []

    drafted = _probe(
        client,
        "new",
        {
            "base_url": GROQ_URL,
            "model": "whisper-large-v3",
            "protocol": "openai",
            "api_key": "sk-draft-only-0123456789",
        },
    )
    assert drafted["ok"] is True
    assert probe_calls[-1]["api_key"] == "sk-draft-only-0123456789"


# ---------------------------------------------------------------------------
# 4. 激活：不探测、不完整 400；运行时与 /transcribe/status 跟着生效项走
# ---------------------------------------------------------------------------


def test_activate_requires_complete_profile_and_switches_runtime(client, fake_asr):
    complete = _create(
        client, "完整", base_url=fake_asr.base_url, model="whisper-1", api_key="sk-complete-1"
    )
    incomplete = _create(
        client, "缺 Key", base_url=fake_asr.base_url, model="whisper-large-v3", api_key=""
    )
    complete_id = _by_name(complete, "完整")["id"]
    incomplete_id = _by_name(incomplete, "缺 Key")["id"]

    activated = client.post("/api/settings/asr/profiles/" + complete_id + "/activate")
    assert activated.status_code == 200
    assert activated.json()["active_profile_id"] == complete_id
    # 「使用」不发网络请求。
    assert fake_asr.requests == []

    status = client.get("/api/transcribe/status").json()
    assert status["configured"] is True
    assert status["provider_host"] == f"127.0.0.1:{fake_asr.server_address[1]}"
    assert status["model"] == "whisper-1"

    rejected = client.post("/api/settings/asr/profiles/" + incomplete_id + "/activate")
    assert rejected.status_code == 400
    assert "补齐" in rejected.json()["detail"]
    # 激活失败不改变生效项。
    assert client.get("/api/settings/asr/profiles").json()["active_profile_id"] == complete_id


# ---------------------------------------------------------------------------
# 5. 删除回落：删生效项切到下一条；删光不复活旧 asr_config
# ---------------------------------------------------------------------------


def test_delete_active_falls_back_then_never_revives_legacy(client, db_session):
    _legacy_rows(db_session)
    default_id = client.get("/api/settings/asr/profiles").json()["active_profile_id"]
    assert default_id
    second_id = _by_name(_create(client, "第二条", api_key=""), "第二条")["id"]

    after_delete = client.delete("/api/settings/asr/profiles/" + default_id).json()
    assert after_delete["active_profile_id"] == second_id

    # 删光：configured=false，且**不**回退旧 asr_config/asr_api_key。
    emptied = client.delete("/api/settings/asr/profiles/" + second_id).json()
    assert emptied == {"active_profile_id": "", "profiles": []}
    assert client.get("/api/settings/asr").json()["configured"] is False
    assert resolve_asr_api_key(db_session) == ""
    assert client.get("/api/transcribe/status").json()["configured"] is False


# ---------------------------------------------------------------------------
# 6. 旧 PUT 兼容：写进生效 profile，不再产生 asr_config 第二份真相
# ---------------------------------------------------------------------------


def test_put_settings_asr_compat_writes_active_profile(client, db_session):
    saved = client.put(
        "/api/settings/asr",
        json={"base_url": GROQ_URL, "api_key": "sk-compat-0123456789", "model": "whisper-1"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["configured"] is True

    state = client.get("/api/settings/asr/profiles").json()
    assert len(state["profiles"]) == 1
    profile = state["profiles"][0]
    assert profile["name"] == "默认配置"
    assert state["active_profile_id"] == profile["id"]
    assert db_session.get(AppSetting, "asr_config") is None

    # 掩码原样回传 + 地址未变：保留 Key；显式 __clear__ 才清。
    client.put(
        "/api/settings/asr",
        json={"base_url": GROQ_URL, "api_key": "********", "model": "whisper-large-v3"},
    )
    assert _by_name(client.get("/api/settings/asr/profiles").json(), "默认配置")["has_key"] is True
    client.put(
        "/api/settings/asr",
        json={"base_url": GROQ_URL, "api_key": CLEAR_API_KEY, "model": "whisper-large-v3"},
    )
    assert _by_name(client.get("/api/settings/asr/profiles").json(), "默认配置")["has_key"] is False


# ---------------------------------------------------------------------------
# 7. 转写请求按生效 profile 的协议/地址走
# ---------------------------------------------------------------------------


def test_transcribe_follows_active_profile_protocol(client, fake_asr):
    openai_id = _by_name(
        _create(
            client,
            "OpenAI 协议",
            base_url=fake_asr.base_url,
            model="whisper-1",
            api_key="sk-openai-0123456789",
            protocol="openai",
            preset_id="custom",
        ),
        "OpenAI 协议",
    )["id"]
    dashscope_id = _by_name(
        _create(
            client,
            "百炼协议",
            base_url=fake_asr.base_url,
            model="qwen3-asr-flash",
            api_key="sk-dashscope-0123456789",
            protocol="dashscope",
            preset_id="custom",
        ),
        "百炼协议",
    )["id"]

    def _post_audio():
        return client.post(
            "/api/transcribe",
            files={"file": ("voice.webm", b"fake-audio-bytes", "audio/webm")},
            data={"duration_ms": "1200", "language": "zh"},
        )

    assert client.post("/api/settings/asr/profiles/" + openai_id + "/activate").status_code == 200
    assert client.get("/api/transcribe/status").json()["model"] == "whisper-1"
    assert _post_audio().status_code == 200
    assert fake_asr.requests[-1]["path"] == "/v1/audio/transcriptions"
    assert fake_asr.requests[-1]["authorization"] == "Bearer sk-openai-0123456789"

    assert (
        client.post("/api/settings/asr/profiles/" + dashscope_id + "/activate").status_code == 200
    )
    status = client.get("/api/transcribe/status").json()
    assert status["model"] == "qwen3-asr-flash"
    assert status["protocol"] == "dashscope"
    assert _post_audio().status_code == 200
    assert fake_asr.requests[-1]["path"] == "/v1/chat/completions"
    assert fake_asr.requests[-1]["authorization"] == "Bearer sk-dashscope-0123456789"
