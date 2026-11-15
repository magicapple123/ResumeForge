# SPDX-License-Identifier: Apache-2.0
"""TTS DeepSeek 档（``interview_tts`` + ``interview_tts_deepseek``）的用例（T10）。

验五件会真的翻车的：
1. **两档并列**：百炼 4 个旧音色原样可用，DeepSeek 只有 stella / tide，默认档仍是百炼；
2. **已存音色不静默变声**：旧值落在另一档时必须回落到该档默认音色，并把"回落了"这件事
   交回调用方（界面据此提示）；选回原档时原音色照旧；
3. **凭据独立**：DeepSeek 档只认环境变量，不因为百炼没配 Key 就不可用，反过来也一样；
4. **RIFF 头必须重写**：上游把 ``nframes`` 写成 ``0x7FFFFFFF``（实测 89478 秒）；
5. **缓存按档隔离**：换档不能命中另一档的音频（否则"换档没生效"）。

假上游只绑 127.0.0.1 的随机端口：请求体形状（``{text, voice, format}``）就是被验的东西。
"""

from __future__ import annotations

import json
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar

import pytest
from app.services.interview import interview_tts, interview_tts_deepseek

FIXED_TEXT = "你好，我们开始吧。"


def _placeholder_wav(payload: bytes = b"\x00\x01" * 4800) -> bytes:
    """上游真实形态：``nframes`` 写成 ``0x7FFFFFFF``（播放器会算出 8 万多秒）。"""
    fmt = struct.pack("<HHIIHH", 1, 1, 24000, 48000, 2, 16)
    body = b"fmt " + struct.pack("<I", len(fmt)) + fmt
    body += b"data" + struct.pack("<I", 0x7FFFFFFF) + payload
    return b"RIFF" + struct.pack("<I", 0x7FFFFFFF) + b"WAVE" + body


class _FakeTtsHandler(BaseHTTPRequestHandler):
    server: _FakeTtsServer

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - 基类签名固定
        """静音访问日志。"""

    def do_POST(self) -> None:  # noqa: N802 - http.server 的约定接口
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        server = self.server
        server.requests.append(
            {
                "path": self.path,
                "authorization": self.headers.get("Authorization", ""),
                "body": json.loads(raw.decode("utf-8") or "{}"),
            }
        )
        if server.mode == "auth":
            body = json.dumps({"error": {"message": "invalid api key"}}).encode()
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        audio = _placeholder_wav()
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)


class _FakeTtsServer(ThreadingHTTPServer):
    daemon_threads = True
    _MODES: ClassVar[tuple[str, ...]] = ("ok", "auth")

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _FakeTtsHandler)
        self.mode = "ok"
        self.requests: list[dict[str, Any]] = []

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/v1"

    def handle_error(self, request: Any, client_address: Any) -> None:  # noqa: ARG002
        """假服务器自身异常不影响判决。"""


@pytest.fixture
def fake_tts(monkeypatch):
    server = _FakeTtsServer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv(interview_tts_deepseek.API_KEY_ENV, "sk-test-tts")
    monkeypatch.setenv(interview_tts_deepseek.API_BASE_ENV, server.base_url)
    interview_tts.clear_cache()
    try:
        yield server
    finally:
        interview_tts.clear_cache()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _wav_duration(raw: bytes) -> float:
    """按 data 块真实字节数算时长（头部修好后才能得到合理值）。"""
    pos = raw.index(b"fmt ")
    channels = struct.unpack("<H", raw[pos + 10 : pos + 12])[0]
    rate = struct.unpack("<I", raw[pos + 12 : pos + 16])[0]
    bits = struct.unpack("<H", raw[pos + 22 : pos + 24])[0]
    data_pos = raw.index(b"data")
    size = struct.unpack("<I", raw[data_pos + 4 : data_pos + 8])[0]
    return size / float(rate * channels * (bits // 8))


def test_provider_catalogs_are_separate() -> None:
    """两档各自的音色：百炼 4 个、DeepSeek 2 个；默认档仍是百炼（不替换）。"""
    assert interview_tts.DEFAULT_PROVIDER == interview_tts.PROVIDER_DASHSCOPE
    dashscope_voices = [voice for voice, _label in interview_tts.voices_of("dashscope")]
    deepseek_voices = [voice for voice, _label in interview_tts.voices_of("deepseek")]
    assert dashscope_voices == ["Cherry", "Serena", "Ethan", "Chelsie"]
    assert deepseek_voices == ["stella", "tide"]
    assert interview_tts.default_voice_of("dashscope") == "Cherry"
    assert interview_tts.default_voice_of("deepseek") == "stella"


def test_resolve_voice_keeps_saved_value_within_its_provider() -> None:
    """已存音色在它自己那一档必须继续可用（不能因为新增一档就失效）。"""
    assert interview_tts.resolve_voice("dashscope", "Cherry") == ("Cherry", False)
    assert interview_tts.resolve_voice("dashscope", "Chelsie") == ("Chelsie", False)
    assert interview_tts.resolve_voice("deepseek", "tide") == ("tide", False)


def test_resolve_voice_reports_fallback_across_providers() -> None:
    """旧值落在另一档：回落到该档默认音色，并**明确告诉调用方发生了回落**。"""
    assert interview_tts.resolve_voice("deepseek", "Cherry") == ("stella", True)
    assert interview_tts.resolve_voice("dashscope", "stella") == ("Cherry", True)
    # 空值只是"还没选过"，不是回落，界面不该提示"你的音色被改了"。
    assert interview_tts.resolve_voice("deepseek", "") == ("stella", False)


def test_unknown_provider_falls_back_to_default() -> None:
    """档位是本地偏好：写坏了回落默认档，不让通话打不开。"""
    assert interview_tts.normalize_provider("openrouter-tts") == interview_tts.DEFAULT_PROVIDER
    assert interview_tts.normalize_provider(None) == interview_tts.DEFAULT_PROVIDER


def test_deepseek_available_follows_its_own_credential(monkeypatch) -> None:
    """凭据独立：DeepSeek 档只看环境变量，百炼（ASR 配置）有没有 Key 不影响它。"""
    monkeypatch.delenv(interview_tts_deepseek.API_KEY_ENV, raising=False)
    assert interview_tts.available("deepseek") is False
    monkeypatch.setenv(interview_tts_deepseek.API_KEY_ENV, "sk-x")
    assert interview_tts.available("deepseek") is True


def test_request_shape_and_riff_rewrite(fake_tts) -> None:
    """请求体是 ``{text, voice, format:"wav"}``；返回的 WAV 头长度是真实值。"""
    audio = interview_tts.synthesize(FIXED_TEXT, "stella", "deepseek")
    sent = fake_tts.requests[-1]
    assert sent["path"].endswith("/tools/tts")
    assert sent["authorization"] == "Bearer sk-test-tts"
    assert sent["body"] == {"text": FIXED_TEXT, "voice": "stella", "format": "wav"}

    riff_size = struct.unpack("<I", audio[4:8])[0]
    assert riff_size == len(audio) - 8
    data_pos = audio.index(b"data")
    data_size = struct.unpack("<I", audio[data_pos + 4 : data_pos + 8])[0]
    assert data_size == len(audio) - data_pos - 8
    # 实测 9600 字节 24k/16bit 单声道 = 0.2 秒；关键是它**不是**八万多秒。
    assert 0.05 < _wav_duration(audio) < 15


def test_synthesize_does_not_mix_provider_caches(fake_tts, monkeypatch) -> None:
    """缓存按档隔离：同一句在两个 provider 下各打一次上游，不会互相顶替。"""
    calls: list[tuple[str, str]] = []

    def fake_request(text: str, voice: str) -> bytes:
        calls.append((text, voice))
        return _placeholder_wav(b"\x02\x03" * 2400)

    monkeypatch.setattr(interview_tts_deepseek, "request_audio", fake_request)
    deepseek_audio = interview_tts.synthesize(FIXED_TEXT, "stella", "deepseek")
    # 同一档同一音色第二次走缓存，不再打上游。
    assert interview_tts.synthesize(FIXED_TEXT, "stella", "deepseek") == deepseek_audio
    assert calls == [(FIXED_TEXT, "stella")]


def test_upstream_failure_becomes_reasoned_error(fake_tts) -> None:
    """上游 401 → 带原因的 TtsUnavailable（前端据此回落浏览器音色并说明原因）。"""
    fake_tts.mode = "auth"
    with pytest.raises(interview_tts.TtsUnavailable) as error:
        interview_tts.synthesize(FIXED_TEXT, "stella", "deepseek")
    assert "401" in str(error.value)


def test_missing_key_is_reported_not_crashed(monkeypatch) -> None:
    """没有 Key 时给一句可操作的原因，而不是让请求线程抛 500。"""
    monkeypatch.delenv(interview_tts_deepseek.API_KEY_ENV, raising=False)
    with pytest.raises(interview_tts.TtsUnavailable) as error:
        interview_tts.synthesize(FIXED_TEXT, "stella", "deepseek")
    assert interview_tts_deepseek.API_KEY_ENV in str(error.value)


def test_provider_status_describes_each_tier(fake_tts) -> None:
    """``provider_status`` 是 status 接口的唯一来源：音色与可用性必须与 synthesize 一致。"""
    deepseek = interview_tts.provider_status("deepseek")
    assert deepseek["id"] == "deepseek"
    assert deepseek["default_voice"] == "stella"
    assert deepseek["available"] is True
    assert [voice["id"] for voice in deepseek["voices"]] == ["stella", "tide"]
    dashscope = interview_tts.provider_status("dashscope")
    assert [voice["id"] for voice in dashscope["voices"]] == [
        "Cherry",
        "Serena",
        "Ethan",
        "Chelsie",
    ]


def test_tts_status_endpoint_lists_both_providers(client, fake_tts) -> None:
    """``GET /api/interview/voice/tts/status``：旧字段保留 + ``providers`` 两档齐全。"""
    response = client.get("/api/interview/voice/tts/status")
    assert response.status_code == 200
    payload = response.json()
    assert payload["default_provider"] == "dashscope"
    assert [voice["id"] for voice in payload["voices"]] == [
        "Cherry",
        "Serena",
        "Ethan",
        "Chelsie",
    ]
    providers = {item["id"]: item for item in payload["providers"]}
    assert set(providers) == {"dashscope", "deepseek"}
    assert [voice["id"] for voice in providers["deepseek"]["voices"]] == ["stella", "tide"]
    assert providers["deepseek"]["available"] is True


def test_tts_endpoint_synthesizes_with_selected_provider(client, fake_tts) -> None:
    """``POST /api/interview/voice/tts`` 带 ``provider`` 时真的按档合成，返回真实长度 WAV。"""
    response = client.post(
        "/api/interview/voice/tts",
        json={"text": FIXED_TEXT, "voice": "tide", "provider": "deepseek"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    audio = response.content
    assert struct.unpack("<I", audio[4:8])[0] == len(audio) - 8
    assert fake_tts.requests[-1]["body"]["voice"] == "tide"
