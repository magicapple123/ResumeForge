# SPDX-License-Identifier: Apache-2.0
"""ASR 第三套协议 ``deepseek`` 的后端用例（T08）。

覆盖五件**换协议最容易静默出错**的事：

1. 判据：``deepseek`` 没有 ``model`` 参数，「只有地址 + Key」必须算已配置——
   否则界面永远显示"未配置"，而请求其实发得出去；
2. 上限：``deepseek`` 是 120 秒 / 8 MiB（不支持流式），其余两档维持 180 秒 / 10 MB；
   ``/transcribe/status`` 必须按协议回，前端据此解释"为什么只有 120 秒"；
3. 请求体：``POST {base}/tools/asr``，multipart 里**只有 ``file``**，不能带 ``model``；
4. 模型目录：``deepseek`` 没有 ``/models``，选到它时**不发请求**、也不报错；
5. 格式：只收 16bit PCM WAV / Ogg Opus，别的格式在本地就拒（不浪费一次上行）。

假上游只绑 127.0.0.1 的随机端口，请求体由它逐项记录——"真发出去的是什么"就是被验的东西，
所以不打桩 httpx。
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar

import pytest
from app.schemas.asr import AsrSettings
from app.services import asr_client
from app.services import asr_deepseek as deepseek
from app.services.asr_errors import AsrError
from app.services.asr_settings import binding_changed, is_asr_configured

FIXED_TEXT = "这是一段由假 DeepSeek 服务返回的中文转写。"
DURATION_MS = 4280


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        pass


class _FakeDeepSeekHandler(BaseHTTPRequestHandler):
    server: _FakeDeepSeekServer

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - 基类签名固定
        """静音访问日志。"""

    def do_GET(self) -> None:  # noqa: N802 - http.server 的约定接口
        self.server.requests.append({"method": "GET", "path": self.path, "body": b""})
        _json_response(self, 404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        server = self.server
        server.requests.append(
            {
                "method": "POST",
                "path": self.path,
                "authorization": self.headers.get("Authorization", ""),
                "content_type": self.headers.get("Content-Type", ""),
                "body": body,
            }
        )
        if server.mode == "auth":
            _json_response(self, 401, {"error": {"message": "invalid api key"}})
            return
        if server.mode == "bad_request":
            _json_response(self, 400, {"error": {"message": "unsupported audio format"}})
            return
        if server.mode == "empty":
            _json_response(self, 200, {"request_id": "r1", "text": "", "duration_ms": 0})
            return
        _json_response(
            self,
            200,
            {"request_id": "r1", "text": server.text, "duration_ms": DURATION_MS},
        )


class _FakeDeepSeekServer(ThreadingHTTPServer):
    """只实现 ``/v1/tools/asr`` 的假上游。"""

    daemon_threads = True
    _MODES: ClassVar[tuple[str, ...]] = ("ok", "auth", "bad_request", "empty")

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _FakeDeepSeekHandler)
        self.mode = "ok"
        self.text = FIXED_TEXT
        self.requests: list[dict[str, Any]] = []

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/v1"

    def handle_error(self, request: Any, client_address: Any) -> None:  # noqa: ARG002
        """假服务器自身异常不影响判决。"""


@pytest.fixture
def fake_deepseek():
    server = _FakeDeepSeekServer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _configure(client: Any, fake: _FakeDeepSeekServer, *, api_key: str = "sk-test-deepseek") -> Any:
    """把 ASR 配置写成 DeepSeek 那一档（**不填 model**，这是本档的正常形态）。"""
    return client.put(
        "/api/settings/asr",
        json={
            "base_url": fake.base_url,
            "api_key": api_key,
            "model": "",
            "protocol": "deepseek",
        },
    )


def test_is_asr_configured_accepts_key_only_for_deepseek() -> None:
    """只有地址 + Key 就是配好了：这一档没有 model 参数（今天会误判"未配置"）。"""
    settings = AsrSettings(
        base_url="https://api.deepseek.com/v1",
        api_key="sk-x",
        model="",
        protocol="deepseek",
    )
    assert is_asr_configured(settings) is True


def test_is_asr_configured_still_requires_model_for_other_protocols() -> None:
    """其余两档的判据不变：缺模型发不出一合法请求。"""
    for protocol in ("openai", "dashscope"):
        settings = AsrSettings.model_validate(
            {"base_url": "https://api.example.com/v1", "api_key": "sk-x", "protocol": protocol}
        )
        assert is_asr_configured(settings) is False


def test_binding_changed_recognizes_deepseek_protocol() -> None:
    """协议变了 = Key 不再适用：地址相同也要清（换了一条调用路径）。"""
    stored = AsrSettings(base_url="https://api.deepseek.com/v1", protocol="deepseek")
    assert binding_changed(stored, "https://api.deepseek.com/v1", "deepseek") is False
    assert binding_changed(stored, "https://api.deepseek.com/v1", "openai") is True


def test_audio_limits_are_single_source_per_protocol() -> None:
    """三套数字收敛：deepseek 120 秒 / 8 MiB，其余 180 秒 / 10 MB，且要求解释原因。"""
    deepseek_limits = deepseek.audio_limits_for("deepseek")
    assert (deepseek_limits.seconds, deepseek_limits.bytes) == (120, 8 * 1024 * 1024)
    assert deepseek_limits.needs_reason is True
    for protocol in ("openai", "dashscope"):
        limits = deepseek.audio_limits_for(protocol)
        assert (limits.seconds, limits.bytes) == (180, 10 * 1024 * 1024)
        assert limits.needs_reason is False


def test_endpoint_does_not_double_the_path() -> None:
    """用户把地址填到 ``/tools/asr`` 也认（自建网关常这么填）。"""
    assert deepseek.asr_endpoint("https://api.deepseek.com/v1") == (
        "https://api.deepseek.com/v1/tools/asr"
    )
    assert deepseek.asr_endpoint("https://api.deepseek.com/v1/tools/asr/") == (
        "https://api.deepseek.com/v1/tools/asr"
    )


def test_validated_endpoint_keeps_local_gateways_but_rejects_other_schemes() -> None:
    """只收 http(s) 主机：本地自建网关合法，``file:`` / 空主机 / 带凭据的地址一律拒。

    这条守的是 CodeQL 的 ``py/full-ssrf``：请求地址来自用户在设置里填的 base_url，
    必须先把"协议与形态"钉死再发请求。**刻意不拦回环与内网**——本地部署的网关就是
    ``http://127.0.0.1:11434`` 这类地址，拦掉等于把正常用法打死。
    """
    assert deepseek.validated_endpoint("http://127.0.0.1:11434/v1") == (
        "http://127.0.0.1:11434/v1/tools/asr"
    )
    assert deepseek.validated_endpoint("https://api.deepseek.com/v1/tools/asr") == (
        "https://api.deepseek.com/v1/tools/asr"
    )
    for bad in ("file:///etc/passwd", "gopher://x/1", "ftp://example.com", "/v1", "https://"):
        with pytest.raises(AsrError) as excinfo:
            deepseek.validated_endpoint(bad)
        assert excinfo.value.kind == "bad_request"
    with pytest.raises(AsrError) as excinfo:
        deepseek.validated_endpoint("https://user:secret@api.deepseek.com/v1")
    assert "用户名或密码" in str(excinfo.value)
    # 拒绝时不许把原地址（可能含凭据）拼进消息。
    assert "secret" not in str(excinfo.value)


def test_status_reports_provider_limits_for_deepseek(client, fake_deepseek) -> None:
    """``/transcribe/status`` 必须按协议回上限：前端靠它解释"为什么只有 120 秒"。"""
    assert _configure(client, fake_deepseek).status_code == 200
    status = client.get("/api/transcribe/status").json()
    assert status["configured"] is True
    assert status["protocol"] == "deepseek"
    assert status["max_seconds"] == 120
    assert status["max_bytes"] == 8 * 1024 * 1024


def test_models_are_fixed_and_never_requested(client, fake_deepseek) -> None:
    """没有 ``/models``：不发请求、不报错，直接给固定口径。"""
    assert _configure(client, fake_deepseek).status_code == 200
    response = client.post(
        "/api/settings/asr/models",
        json={"base_url": fake_deepseek.base_url, "api_key": "sk-test", "protocol": "deepseek"},
    )
    assert response.status_code == 200
    assert response.json()["models"] == [deepseek.MODEL_LABEL]
    assert [item for item in fake_deepseek.requests if item["method"] == "GET"] == []


def test_transcribe_sends_only_the_file_field(client, fake_deepseek) -> None:
    """请求体是 multipart 且**只有 ``file``**：多传 model 上游会 400。"""
    assert _configure(client, fake_deepseek).status_code == 200
    response = client.post(
        "/api/transcribe",
        files={"file": ("memo.wav", b"RIFF" + b"\x00" * 120, "audio/wav")},
        data={"duration_ms": "1234", "language": "zh"},
    )
    assert response.status_code == 200
    assert response.json()["text"] == FIXED_TEXT
    sent = fake_deepseek.requests[-1]
    assert sent["path"].endswith("/v1/tools/asr")
    assert sent["authorization"] == "Bearer sk-test-deepseek"
    body = sent["body"]
    assert b'name="file"' in body
    assert b'name="model"' not in body
    assert b'name="language"' not in body


def test_transcribe_rejects_webm_before_uploading(client, fake_deepseek) -> None:
    """只收 WAV / Ogg Opus：浏览器默认的 webm 在本地就拒，并给出两条出路。"""
    assert _configure(client, fake_deepseek).status_code == 200
    response = client.post(
        "/api/transcribe",
        files={"file": ("memo.webm", b"\x1aE\xdf\xa3payload", "audio/webm")},
        data={"duration_ms": "800"},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "WAV" in detail and "openai" in detail
    assert fake_deepseek.requests == []


def test_transcribe_rejects_duration_over_provider_limit(client, fake_deepseek) -> None:
    """120 秒是硬上限（不支持流式），文案要写秒而不是含糊的"两分钟"。"""
    assert _configure(client, fake_deepseek).status_code == 200
    response = client.post(
        "/api/transcribe",
        files={"file": ("memo.wav", b"RIFF" + b"\x00" * 120, "audio/wav")},
        data={"duration_ms": "120001"},
    )
    assert response.status_code == 413
    assert "120 秒" in response.json()["detail"]
    assert fake_deepseek.requests == []


def test_transcribe_maps_auth_failure_to_502(client, fake_deepseek) -> None:
    """鉴权失败仍是 502 + 指向 Key 的中文（沿用既有分类，不为新协议另写一套）。"""
    assert _configure(client, fake_deepseek).status_code == 200
    fake_deepseek.mode = "auth"
    response = client.post(
        "/api/transcribe",
        files={"file": ("memo.wav", b"RIFF" + b"\x00" * 120, "audio/wav")},
        data={"duration_ms": "900"},
    )
    assert response.status_code == 502
    assert "Key" in response.json()["detail"]


def test_openai_protocol_limits_are_untouched(client, fake_deepseek) -> None:
    """换协议不能顺手把老协议的上限也改成 120 秒（今天的行为必须保住）。"""
    response = client.put(
        "/api/settings/asr",
        json={
            "base_url": fake_deepseek.base_url,
            "api_key": "sk-test",
            "model": "whisper-1",
            "protocol": "openai",
        },
    )
    assert response.status_code == 200
    status = client.get("/api/transcribe/status").json()
    assert status["max_seconds"] == 180
    assert status["max_bytes"] == 10 * 1024 * 1024


def test_provider_requires_model_only_for_other_protocols() -> None:
    """``requires_model`` 是判据的单一来源（四个调用方共用）。"""
    assert deepseek.requires_model("deepseek") is False
    assert deepseek.requires_model("openai") is True
    assert deepseek.requires_model("dashscope") is True
    assert "模型" not in deepseek.incomplete_message("deepseek")
    assert "模型" in deepseek.incomplete_message("openai")


def test_transcribe_audio_dispatches_deepseek(fake_deepseek) -> None:
    """协议分派：``deepseek`` 走 ``/tools/asr``，返回值是上游的 ``text``。"""
    import asyncio

    text = asyncio.run(
        asr_client.transcribe_audio(
            base_url=fake_deepseek.base_url,
            api_key="sk-test",
            model="",
            content=b"RIFF" + b"\x00" * 64,
            content_type="audio/wav",
            protocol="deepseek",
        )
    )
    assert text == FIXED_TEXT
    assert fake_deepseek.requests[-1]["path"].endswith("/tools/asr")
