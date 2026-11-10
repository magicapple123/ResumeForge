# SPDX-License-Identifier: Apache-2.0
"""语音转写的**协议层**（openai / dashscope）后端用例。

覆盖四件事，每一件都对应一个曾经会静默出错的点：

1. ``protocol`` 的保存/读取往返——特别是 ``_write_config`` 整体重建 JSON 时**不能把协议吞掉**
   （漏了它表现为"保存后变回 openai"，而界面上的选择看起来是对的）；
2. Qwen-ASR（dashscope）的请求体构造：``chat/completions`` + ``messages[0].content`` 的
   ``input_audio.data`` 是 Data URI，不是本地路径也不是裸 base64；
3. 响应解析要同时吃下 ``content`` 是**字符串**与**分段数组**两种形态；
4. 400 要把上游 ``error.message`` 带出来（截断脱敏），拉模型列表任何失败都返回空列表。

**不在本文件里的东西**：静音探测的"400 但指向音频内容算可达"是 ``probe_asr_connection``
的行为，这里用真实 HTTP 上游验一次（假 Key 的真实 401 链路由 ``test_transcribe.py`` 覆盖）。

为什么用本地假上游而不是 patch ``httpx``：这条链路的正确性一半在"请求真的发成了那个形状"。
打桩客户端等于把要验的东西换成恒真式；假上游只绑定 127.0.0.1 的随机端口，不出网。
"""

from __future__ import annotations

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar

import pytest
from app.models.setting import AppSetting
from app.services.asr_settings import resolve_asr_api_key
from sqlalchemy.orm import Session

TEXT_STRING = "百炼返回的整段文本。"
TEXT_SEGMENTS = ("分段一的文本", "分段二的文本")
UPSTREAM_400 = "model qwen3-asr-flash received invalid audio: no speech detected"
LEAKED_KEY = "sk-upstream-should-not-leak-123456"


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


class _FakeUpstreamHandler(BaseHTTPRequestHandler):
    server: _FakeUpstream

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - 基类签名固定
        """静音默认访问日志，让 pytest 输出只剩结论。"""

    def do_GET(self) -> None:  # noqa: N802 - http.server 的约定接口
        server = self.server
        server.requests.append({"method": "GET", "path": self.path, "body": b""})
        if server.mode == "models_error":
            _json_response(self, 500, {"error": {"message": "internal error"}})
            return
        if server.mode == "models_garbage":
            body = b"<html>not json</html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        _json_response(
            self,
            200,
            {
                "data": [
                    {"id": "qwen3-asr-flash"},
                    {"id": "qwen-max"},
                    {"id": "qwen3-asr-flash"},
                    {"id": 42},
                    {"id": "sensevoice-small"},
                ]
            },
        )

    def do_POST(self) -> None:  # noqa: N802 - http.server 的约定接口
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        server = self.server
        server.requests.append(
            {
                "method": "POST",
                "path": self.path,
                "authorization": self.headers.get("Authorization", ""),
                "body": body,
            }
        )
        if server.mode == "bad_request":
            _json_response(self, 400, {"error": {"message": f"{UPSTREAM_400} key={LEAKED_KEY}"}})
            return
        if self.path.endswith("/chat/completions"):
            if server.mode == "segments":
                _json_response(
                    self,
                    200,
                    {
                        "choices": [
                            {
                                "message": {
                                    "content": [
                                        {"type": "text", "text": TEXT_SEGMENTS[0]},
                                        {"type": "text", "text": TEXT_SEGMENTS[1]},
                                    ]
                                }
                            }
                        ]
                    },
                )
                return
            _json_response(self, 200, {"choices": [{"message": {"content": TEXT_STRING}}]})
            return
        _json_response(self, 200, {"text": TEXT_STRING})


class _FakeUpstream(ThreadingHTTPServer):
    """一个同时实现两种协议的假上游（按用户要求 mock 掉网络边界，不出网）。"""

    daemon_threads = True
    _MODES: ClassVar[tuple[str, ...]] = (
        "string",
        "segments",
        "bad_request",
        "models_error",
        "models_garbage",
    )

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _FakeUpstreamHandler)
        self.mode = "string"
        self.requests: list[dict[str, Any]] = []

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/v1"

    def chat_requests(self) -> list[dict[str, Any]]:
        return [item for item in self.requests if item["path"].endswith("/chat/completions")]

    def handle_error(self, request: Any, client_address: Any) -> None:  # noqa: ARG002
        """假上游自身的异常不影响用例判决。"""


@pytest.fixture
def upstream():
    server = _FakeUpstream()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _save(client: Any, upstream: _FakeUpstream, *, protocol: str, api_key: str = "sk-asr-test"):
    response = client.put(
        "/api/settings/asr",
        json={
            "base_url": upstream.base_url,
            "api_key": api_key,
            "model": "qwen3-asr-flash",
            "protocol": protocol,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _post_audio(client: Any, content: bytes = b"RIFF0000WAVEfake"):
    return client.post(
        "/api/transcribe",
        files={"file": ("voice.wav", content, "audio/wav")},
        data={"duration_ms": "1200", "language": "zh"},
    )


# ---------------------------------------------------------------------------
# 1. protocol 往返：_write_config 不吞字段
# ---------------------------------------------------------------------------


def test_protocol_is_persisted_and_echoed_back(client):
    saved = client.put(
        "/api/settings/asr",
        json={
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "api_key": "sk-x",
            "model": "qwen3-asr-flash",
            "protocol": "dashscope",
        },
    ).json()
    assert saved["protocol"] == "dashscope"
    assert client.get("/api/settings/asr").json()["protocol"] == "dashscope"


def test_write_config_does_not_swallow_protocol(client, db_session: Session):
    """回归线：保存路径不能再落回旧 ``asr_config``（第二份真相），协议必须跟着 profile 走。"""
    client.put(
        "/api/settings/asr",
        json={
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "api_key": "sk-x",
            "model": "qwen3-asr-flash",
            "protocol": "dashscope",
        },
    )
    # 第二次保存只换模型：协议必须原样留住（前端每次都回传，但后端不能依赖这一点）。
    second = client.put(
        "/api/settings/asr",
        json={
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "api_key": "********",
            "model": "qwen3-asr-flash-v2",
            "protocol": "dashscope",
        },
    ).json()
    assert second["protocol"] == "dashscope"

    # 旧键不再写入：两份真相会让"读哪一份"变成永远的猜谜。
    db_session.expire_all()
    assert db_session.get(AppSetting, "asr_config") is None
    profiles = client.get("/api/settings/asr/profiles").json()
    assert len(profiles["profiles"]) == 1
    assert profiles["profiles"][0]["protocol"] == "dashscope"
    assert profiles["profiles"][0]["model"] == "qwen3-asr-flash-v2"
    assert profiles["active_profile_id"] == profiles["profiles"][0]["id"]


def test_changing_protocol_drops_saved_key(client, upstream, db_session: Session):
    _save(client, upstream, protocol="openai")
    db_session.expire_all()
    assert resolve_asr_api_key(db_session) == "sk-asr-test"

    # 同一台主机、只换协议：旧 Key 是另一条调用路径的凭据，不能继续用。
    after = client.put(
        "/api/settings/asr",
        json={
            "base_url": upstream.base_url,
            "api_key": "********",
            "model": "qwen3-asr-flash",
            "protocol": "dashscope",
        },
    ).json()
    assert after["protocol"] == "dashscope"
    assert after["configured"] is False
    db_session.expire_all()
    assert resolve_asr_api_key(db_session) == ""


def test_old_row_without_protocol_defaults_to_openai(client, db_session: Session):
    """旧数据（迁移前写入的 JSON 没有 protocol）必须被读成 openai，而不是报错。"""
    db_session.add(
        AppSetting(
            key="asr_config",
            value=json.dumps({"base_url": "https://api.openai.com/v1", "model": "whisper-1"}),
        )
    )
    db_session.commit()
    assert client.get("/api/settings/asr").json()["protocol"] == "openai"


# ---------------------------------------------------------------------------
# 2. dashscope 请求体：chat/completions + input_audio 的 Data URI
# ---------------------------------------------------------------------------


def test_dashscope_body_carries_base64_data_uri(client, upstream):
    _save(client, upstream, protocol="dashscope")
    payload = b"RIFF-not-really-a-wav"

    response = _post_audio(client, content=payload)
    assert response.status_code == 200, response.text
    assert response.json()["text"] == TEXT_STRING

    chats = upstream.chat_requests()
    assert len(chats) == 1
    request = chats[0]
    assert request["path"] == "/v1/chat/completions"
    assert request["authorization"] == "Bearer sk-asr-test"

    body = json.loads(request["body"].decode("utf-8"))
    assert body["model"] == "qwen3-asr-flash"
    assert body["stream"] is False
    assert body["asr_options"] == {"language": "zh"}
    content = body["messages"][0]["content"]
    assert content[0]["type"] == "input_audio"
    data = content[0]["input_audio"]["data"]
    assert data.startswith("data:audio/wav;base64,")
    assert data.endswith(base64.b64encode(payload).decode("ascii"))
    # 绝不能把本地路径当 data 传：那是阿里云明确不接受的形态。
    assert "C:\\" not in data and "/tmp/" not in data


def test_openai_protocol_still_uses_multipart(client, upstream):
    """协议默认值不能改变老路径：openai 仍走 /audio/transcriptions。"""
    _save(client, upstream, protocol="openai")
    assert _post_audio(client).status_code == 200
    paths = [item["path"] for item in upstream.requests]
    assert "/v1/audio/transcriptions" in paths
    assert not upstream.chat_requests()


# ---------------------------------------------------------------------------
# 3. 响应解析：字符串与分段数组
# ---------------------------------------------------------------------------


def test_dashscope_parses_string_content(client, upstream):
    upstream.mode = "string"
    _save(client, upstream, protocol="dashscope")
    assert _post_audio(client).json()["text"] == TEXT_STRING


def test_dashscope_parses_segmented_content(client, upstream):
    upstream.mode = "segments"
    _save(client, upstream, protocol="dashscope")
    assert _post_audio(client).json()["text"] == "".join(TEXT_SEGMENTS)


# ---------------------------------------------------------------------------
# 4. 400 带上游原文（截断脱敏） / 拉模型列表
# ---------------------------------------------------------------------------


def test_dashscope_400_surfaces_sanitized_upstream_message(client, upstream):
    upstream.mode = "bad_request"
    _save(client, upstream, protocol="dashscope")

    response = _post_audio(client)
    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    assert "invalid audio" in detail
    assert UPSTREAM_400.split(":")[1].strip() in detail
    # 脱敏：上游回显里出现的 Key 片段不能原样进 detail。
    assert LEAKED_KEY not in detail
    assert "sk-asr-test" not in detail


def test_probe_treats_audio_complaint_as_reachable(client, upstream):
    """静音样本被上游判"无有效语音"时链路仍算通：验的是配置，不是识别质量。"""
    upstream.mode = "bad_request"
    _save(client, upstream, protocol="dashscope")

    result = client.post(
        "/api/settings/asr/test",
        json={
            "base_url": upstream.base_url,
            "api_key": "********",
            "model": "qwen3-asr-flash",
            "protocol": "dashscope",
        },
    ).json()
    assert result["ok"] is True, result
    assert result["latency_ms"] is not None
    # 真的发了一次 chat 请求，而不是"看着像而已"。
    assert upstream.chat_requests()


def test_probe_reports_auth_failure_as_not_ok(client, upstream):
    _save(client, upstream, protocol="dashscope")
    result = client.post(
        "/api/settings/asr/test",
        json={
            "base_url": "https://another.example.com/v1",
            "api_key": "********",
            "model": "qwen3-asr-flash",
            "protocol": "dashscope",
        },
    ).json()
    # 地址变了 → 不复用旧 Key → 直接判定"请先填写"，且不会打上游。
    assert result["ok"] is False
    assert "请先填写" in result["message"]
    assert not upstream.chat_requests()


def test_models_endpoint_returns_ids_deduped(client, upstream):
    _save(client, upstream, protocol="dashscope")
    result = client.post(
        "/api/settings/asr/models",
        json={"base_url": upstream.base_url, "api_key": "********", "protocol": "dashscope"},
    ).json()
    # 后端不做关键词过滤：只去重、丢掉非字符串、保持上游顺序。
    assert result["models"] == ["qwen3-asr-flash", "qwen-max", "sensevoice-small"]


@pytest.mark.parametrize("mode", ["models_error", "models_garbage"])
def test_models_endpoint_returns_empty_on_any_failure(client, upstream, mode):
    upstream.mode = mode
    _save(client, upstream, protocol="dashscope")
    result = client.post(
        "/api/settings/asr/models",
        json={"base_url": upstream.base_url, "api_key": "********", "protocol": "dashscope"},
    ).json()
    assert result["models"] == []


def test_models_endpoint_does_not_send_a_key_to_another_host(client, upstream):
    _save(client, upstream, protocol="dashscope")
    before = len(upstream.requests)
    result = client.post(
        "/api/settings/asr/models",
        json={"base_url": "https://elsewhere.example.com/v1", "api_key": "********"},
    ).json()
    assert result["models"] == []
    assert len(upstream.requests) == before
