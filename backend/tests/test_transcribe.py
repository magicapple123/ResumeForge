# SPDX-License-Identifier: Apache-2.0
"""语音听写（T12）后端：本地假 ASR 服务器 + 真 HTTP 客户端。

**为什么不用 patch 掉 httpx**：这条链路的一半正确性在"multipart 真发出去了、上游状态码
真被分类了"。把客户端打桩等于把要验的东西换成恒真式。假服务器只实现 OpenAI 兼容服务
会返回的几种形态（成功 / 401 / 404 / 413 / 超时 / 空结果），请求体与鉴权头由它逐项记录，
测试据此断言"发出去的到底是什么"。

所有用例都不访问外网：假服务器绑定 127.0.0.1 的随机端口。
"""

from __future__ import annotations

import json
import logging
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar

import pytest
from app.api import transcribe as transcribe_api
from app.services import asr_client
from app.services.asr_settings import provider_host, resolve_asr_api_key
from app.services.llm_key_refs import API_KEY_MASK

FIXED_TEXT = "这是一段由假语音服务返回的固定中文转写。"


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        # 超时用例：客户端先断开，假服务器还在往里写。这不是被测行为，静默即可。
        pass


class _FakeAsrHandler(BaseHTTPRequestHandler):
    server: _FakeAsrServer

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - 基类签名固定
        """Mute the default stderr access log: pytest output stays readable."""

    def do_POST(self) -> None:  # noqa: N802 - http.server 的约定接口
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        server = self.server
        server.requests.append(
            {
                "path": self.path,
                "authorization": self.headers.get("Authorization", ""),
                "content_type": self.headers.get("Content-Type", ""),
                "body": body,
            }
        )
        if server.mode == "slow":
            time.sleep(server.delay_seconds)
        if server.mode == "auth":
            _json_response(self, 401, {"error": {"message": "invalid api key"}})
            return
        if server.mode == "not_found":
            _json_response(self, 404, {"error": {"message": "not found"}})
            return
        if server.mode == "too_large":
            _json_response(self, 413, {"error": {"message": "payload too large"}})
            return
        if server.mode == "empty":
            _json_response(self, 200, {"text": ""})
            return
        _json_response(self, 200, {"text": server.text})


class _FakeAsrServer(ThreadingHTTPServer):
    """一个只实现 /audio/transcriptions 的假上游。"""

    daemon_threads = True
    _MODES: ClassVar[tuple[str, ...]] = ("ok", "auth", "not_found", "too_large", "empty", "slow")

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _FakeAsrHandler)
        self.mode = "ok"
        self.text = FIXED_TEXT
        self.delay_seconds = 0.6
        self.requests: list[dict[str, Any]] = []

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/v1"

    @property
    def host(self) -> str:
        return f"127.0.0.1:{self.server_address[1]}"

    def handle_error(self, request: Any, client_address: Any) -> None:  # noqa: ARG002
        """假服务器自身的异常不影响用例判决（超时用例会主动断开连接）。"""


@pytest.fixture
def fake_asr():
    server = _FakeAsrServer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _configure(client: Any, fake: _FakeAsrServer, *, api_key: str = "sk-test-asr") -> dict:
    response = client.put(
        "/api/settings/asr",
        json={"base_url": fake.base_url, "api_key": api_key, "model": "whisper-1"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _post_audio(client: Any, content: bytes = b"fake-webm-bytes", duration_ms: str = "5000"):
    return client.post(
        "/api/transcribe",
        files={"file": ("voice.webm", content, "audio/webm")},
        data={"duration_ms": duration_ms, "language": "zh"},
    )


# ---------------------------------------------------------------------------
# 配置读写：Key 只回掩码、三种写入口径
# ---------------------------------------------------------------------------


def test_settings_roundtrip_masks_key(client, db_session, fake_asr):
    saved = _configure(client, fake_asr)
    assert saved["configured"] is True
    assert saved["api_key"] == API_KEY_MASK
    assert "sk-test-asr" not in json.dumps(saved, ensure_ascii=False)
    assert resolve_asr_api_key(db_session) == "sk-test-asr"

    # 掩码原样回传 + 地址没变：保留旧 Key，只改模型。
    response = client.put(
        "/api/settings/asr",
        json={"base_url": fake_asr.base_url, "api_key": API_KEY_MASK, "model": "whisper-large-v3"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["model"] == "whisper-large-v3"
    db_session.expire_all()
    assert resolve_asr_api_key(db_session) == "sk-test-asr"

    # 空串 + 地址没变：同样保留（前端清空输入框不等于要删密钥）。
    response = client.put(
        "/api/settings/asr",
        json={"base_url": fake_asr.base_url, "api_key": "", "model": "whisper-1"},
    )
    assert response.json()["configured"] is True
    db_session.expire_all()
    assert resolve_asr_api_key(db_session) == "sk-test-asr"

    # 地址变了 + 掩码：旧 Key 不能发给新主机，按清空处理。
    response = client.put(
        "/api/settings/asr",
        json={
            "base_url": "https://asr.example.com/v1",
            "api_key": API_KEY_MASK,
            "model": "whisper-1",
        },
    )
    assert response.status_code == 200
    assert response.json()["configured"] is False
    db_session.expire_all()
    assert resolve_asr_api_key(db_session) == ""


def test_settings_clear_sentinel_removes_saved_key(client, db_session, fake_asr):
    _configure(client, fake_asr, api_key="sk-to-remove")
    db_session.expire_all()
    assert resolve_asr_api_key(db_session) == "sk-to-remove"

    response = client.put(
        "/api/settings/asr",
        json={"base_url": fake_asr.base_url, "api_key": "__clear__", "model": "whisper-1"},
    )
    assert response.status_code == 200
    assert response.json()["api_key"] == ""
    assert response.json()["configured"] is False
    db_session.expire_all()
    assert resolve_asr_api_key(db_session) == ""


def test_settings_rejects_non_http_base_url(client):
    response = client.put(
        "/api/settings/asr", json={"base_url": "api.example.com/v1", "api_key": "", "model": "m"}
    )
    assert response.status_code == 422
    assert "http://" in response.text


def test_provider_host_returns_only_netloc():
    assert provider_host("https://api.groq.com/openai/v1") == "api.groq.com"
    assert provider_host("http://127.0.0.1:8097/v1/") == "127.0.0.1:8097"
    assert provider_host("") == ""
    assert provider_host("not a url") == ""


# ---------------------------------------------------------------------------
# 状态探测：前端据此决定是否显示隐私提示
# ---------------------------------------------------------------------------


def test_status_reports_configured_and_host(client, fake_asr):
    before = client.get("/api/transcribe/status").json()
    assert before["configured"] is False
    assert before["provider_host"] == ""
    assert before["max_seconds"] == 180
    assert before["max_bytes"] == 10 * 1024 * 1024

    _configure(client, fake_asr)
    after = client.get("/api/transcribe/status").json()
    assert after["configured"] is True
    assert after["provider_host"] == fake_asr.host
    assert after["model"] == "whisper-1"


# ---------------------------------------------------------------------------
# 成功链路：multipart、日志脱敏、返回体
# ---------------------------------------------------------------------------


def test_transcribe_success_sends_multipart_and_hides_secrets(client, fake_asr, caplog):
    _configure(client, fake_asr)
    payload = b"fake-webm-bytes-not-real-audio"

    with caplog.at_level(logging.INFO, logger="app.api.transcribe"):
        response = _post_audio(client, content=payload, duration_ms="5000")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["text"] == FIXED_TEXT
    assert body["provider_host"] == fake_asr.host
    assert "sk-test-asr" not in response.text

    # 上游真的收到了一次 OpenAI 兼容的 multipart POST。
    upstream = fake_asr.requests[-1]
    assert upstream["path"] == "/v1/audio/transcriptions"
    assert upstream["authorization"] == "Bearer sk-test-asr"
    assert upstream["content_type"].startswith("multipart/form-data")
    raw_body = upstream["body"]
    for field in (b'name="file"', b'name="model"', b'name="language"', b'name="response_format"'):
        assert field in raw_body
    assert b'filename="audio.webm"' in raw_body
    assert b"whisper-1" in raw_body
    # 日志只有 status / bytes / ms / host：无 Key、无音频内容。
    logged = caplog.text
    assert "asr status=ok bytes=" in logged
    assert fake_asr.host in logged
    assert "sk-test-asr" not in logged
    assert "fake-webm-bytes-not-real-audio" not in logged


def test_transcribe_works_without_duration_field(client, fake_asr):
    """duration_ms 是可选字段：老前端不传也能转写（限额由文件大小与 3 分钟规则兜住）。"""
    _configure(client, fake_asr)
    response = client.post(
        "/api/transcribe",
        files={"file": ("voice.webm", b"audio-bytes", "audio/webm")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["text"] == FIXED_TEXT


# ---------------------------------------------------------------------------
# 本地校验：未配置 / 过大 / 超时长 / 语言 / 空文件
# ---------------------------------------------------------------------------


def test_transcribe_without_configuration_returns_409_and_never_calls_upstream(client, fake_asr):
    response = _post_audio(client)
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "未配置语音服务" in detail
    assert "设置" in detail and "语音转写" in detail
    assert fake_asr.requests == []


def test_transcribe_rejects_too_large_audio(client, fake_asr, monkeypatch):
    monkeypatch.setattr(transcribe_api, "MAX_AUDIO_BYTES", 8)
    _configure(client, fake_asr)
    response = _post_audio(client, content=b"123456789")
    assert response.status_code == 413
    assert "10 MB" in response.json()["detail"]
    assert fake_asr.requests == []


def test_transcribe_rejects_duration_over_three_minutes(client, fake_asr):
    _configure(client, fake_asr)
    response = _post_audio(client, duration_ms=str(180_001))
    assert response.status_code == 413
    assert "3 分钟" in response.json()["detail"]
    assert fake_asr.requests == []


def test_transcribe_rejects_empty_audio_and_bad_language(client, fake_asr):
    _configure(client, fake_asr)
    empty = _post_audio(client, content=b"")
    assert empty.status_code == 422
    assert "没有读到音频数据" in empty.json()["detail"]

    bad_language = client.post(
        "/api/transcribe",
        files={"file": ("voice.webm", b"audio-bytes", "audio/webm")},
        data={"language": "zh;drop table"},
    )
    assert bad_language.status_code == 422
    assert "语言代码" in bad_language.json()["detail"]
    assert fake_asr.requests == []


# ---------------------------------------------------------------------------
# 上游错误分类：每种都有独立中文文案，前端据此出不同提示
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("mode", "expected_status", "needle"),
    [
        ("auth", 502, "鉴权失败"),
        ("not_found", 502, "地址不存在"),
        ("too_large", 413, "413"),
        ("empty", 422, "没有识别到语音内容"),
    ],
)
def test_transcribe_classifies_upstream_errors(
    client, fake_asr, mode, expected_status, needle, caplog
):
    fake_asr.mode = mode
    _configure(client, fake_asr)
    with caplog.at_level(logging.WARNING, logger="app.api.transcribe"):
        response = _post_audio(client)

    assert response.status_code == expected_status, response.text
    detail = response.json()["detail"]
    assert needle in detail
    assert "sk-test-asr" not in detail
    assert "asr status=error" in caplog.text


def test_transcribe_timeout_maps_to_504(client, fake_asr, monkeypatch):
    fake_asr.mode = "slow"
    fake_asr.delay_seconds = 0.6
    monkeypatch.setattr(asr_client, "DEFAULT_TIMEOUT_SECONDS", 0.1)
    _configure(client, fake_asr)

    response = _post_audio(client)
    assert response.status_code == 504, response.text
    assert "超时" in response.json()["detail"]


# ---------------------------------------------------------------------------
# 测试连接：不要求先保存；静音样本的空结果算成功
# ---------------------------------------------------------------------------


def test_test_connection_uses_stored_key_and_reports_failure(client, fake_asr):
    _configure(client, fake_asr)
    ok = client.post(
        "/api/settings/asr/test",
        json={"base_url": fake_asr.base_url, "api_key": API_KEY_MASK, "model": "whisper-1"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["ok"] is True
    assert ok.json()["message"]
    assert fake_asr.requests, "测试连接应该真的发一次上游请求"

    fake_asr.mode = "auth"
    failed = client.post(
        "/api/settings/asr/test",
        json={"base_url": fake_asr.base_url, "api_key": API_KEY_MASK, "model": "whisper-1"},
    )
    assert failed.status_code == 200
    assert failed.json()["ok"] is False
    assert "鉴权失败" in failed.json()["message"]


def test_test_connection_refuses_to_reuse_key_for_a_new_host(client, fake_asr):
    _configure(client, fake_asr)
    before = len(fake_asr.requests)
    response = client.post(
        "/api/settings/asr/test",
        json={"base_url": "https://another.example.com/v1", "api_key": API_KEY_MASK, "model": "m"},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "请先填写" in response.json()["message"]
    assert len(fake_asr.requests) == before


def test_silent_wav_is_a_valid_wav_container():
    data = asr_client.silent_wav_bytes(100)
    assert data[:4] == b"RIFF"
    assert data[8:12] == b"WAVE"
    assert data[12:16] == b"fmt "
    assert data[36:40] == b"data"
    assert len(data) > 44
