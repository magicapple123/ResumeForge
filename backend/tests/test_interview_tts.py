# SPDX-License-Identifier: Apache-2.0
"""Q1：面试官语音合成（``services/interview/interview_tts.py``）的纯逻辑用例。

**不联网**：``_request_audio`` 全部打桩成假上游，只验三件会真的翻车的事——
1. 流式占位长度必须被改写成真实长度（不改的话播放器显示 44739 秒）；
2. 采样数据一个字节都不许动（我们只重写头，不做重采样）；
3. 上游失败必须变成带原因的 ``TtsUnavailable``，而不是让请求线程抛 500。
"""

from __future__ import annotations

import struct

import pytest
from app.services.interview import interview_tts


def _wav(payload: bytes = b"\x00\x01" * 480) -> bytes:
    """造一段 fmt + 占位 data 的 WAV（上游真实形态：data 长度写成 0x7FFFFF9B）。"""
    fmt = struct.pack("<HHIIHH", 1, 1, 24000, 48000, 2, 16)
    body = b"fmt " + struct.pack("<I", len(fmt)) + fmt
    body += b"data" + struct.pack("<I", 0x7FFFFF9B) + payload
    return b"RIFF" + struct.pack("<I", 0x7FFFFF9B) + b"WAVE" + body


def test_normalize_wav_rewrites_placeholder_lengths() -> None:
    raw = _wav()
    fixed = interview_tts.normalize_wav(raw)
    assert struct.unpack("<I", fixed[4:8])[0] == len(fixed) - 8
    data_pos = fixed.index(b"data")
    assert struct.unpack("<I", fixed[data_pos + 4 : data_pos + 8])[0] == len(fixed) - data_pos - 8


def test_normalize_wav_keeps_pcm_bytes_untouched() -> None:
    """只重写头：采样数据逐字节相同，长度也不变（重采样会掉质量，方案里明确不做）。"""
    raw = _wav(b"\x11\x22" * 300)
    fixed = interview_tts.normalize_wav(raw)
    assert len(fixed) == len(raw)
    assert fixed[44:] == raw[44:]


def test_normalize_wav_passes_through_non_wav() -> None:
    """不是 WAV 就原样返回：在这里猜格式，会让"上游换了编码"变成静默的错音频。"""
    assert interview_tts.normalize_wav(b"not-a-wav") == b"not-a-wav"


def test_synthesize_rejects_empty_text() -> None:
    with pytest.raises(interview_tts.TtsUnavailable):
        interview_tts.synthesize("   ")


def test_synthesize_caches_by_text_and_voice(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []

    def fake_request(text: str, voice: str) -> bytes:
        calls.append((text, voice))
        return _wav()

    interview_tts.clear_cache()
    monkeypatch.setattr(interview_tts, "_request_audio", fake_request)
    first = interview_tts.synthesize("你好", "Cherry")
    second = interview_tts.synthesize("你好", "Cherry")
    third = interview_tts.synthesize("你好", "Serena")
    assert first == second
    # 换音色是一次新的上游调用：缓存键必须带 voice，否则换音色会播旧声音。
    assert calls == [("你好", "Cherry"), ("你好", "Serena")]
    assert third == first


def test_synthesize_surfaces_upstream_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(text: str, voice: str) -> bytes:
        raise interview_tts.TtsUnavailable("语音服务返回 400：invalid voice")

    interview_tts.clear_cache()
    monkeypatch.setattr(interview_tts, "_request_audio", boom)
    with pytest.raises(interview_tts.TtsUnavailable) as info:
        interview_tts.synthesize("你好")
    assert "invalid voice" in str(info.value)


def test_synthesize_rejects_empty_audio(monkeypatch: pytest.MonkeyPatch) -> None:
    """上游回了 200 但音频只有个头：当成成功会让界面"有播报动作但没声音"。"""

    def empty(text: str, voice: str) -> bytes:
        return _wav()[:44]

    interview_tts.clear_cache()
    monkeypatch.setattr(interview_tts, "_request_audio", empty)
    with pytest.raises(interview_tts.TtsUnavailable):
        interview_tts.synthesize("你好")


def test_available_false_without_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(interview_tts, "active_profile_settings", lambda: None)
    assert interview_tts.available() is False
