# SPDX-License-Identifier: Apache-2.0
"""OpenAI 兼容的语音转写客户端：``POST {base_url}/audio/transcriptions``。

只做一件事——把一段音频发给上游、拿回文本。请求体是 ``multipart/form-data``：
``file`` + ``model`` + ``language`` + ``response_format=json``（计划 §6 的固定口径）。

错误分类是这个模块存在的主要理由：上层要把 401 / 404 / 413 / 超时 / 空结果 分别翻成
**各不相同、且能给下一步**的中文提示（"失败"两个字对用户没有用）。

安全边界：日志与异常消息不携带 Key、不携带音频内容；Key 只出现在发给上游的
``Authorization`` 头里。
"""

from __future__ import annotations

import struct
import time

import httpx

# 单次转写的上游超时：60 秒（计划 §6）。3 分钟音频在这段时间内足够转完；
# 拨高只会让"服务不可用"时用户多等。
DEFAULT_TIMEOUT_SECONDS = 60.0
TRANSCRIBE_PATH = "/audio/transcriptions"

# 音频 Content-Type → 传给上游的固定文件名。不直接用 ``UploadFile.filename``：
# 那是用户可控输入，拼进 multipart 头要处理引号/换行，而扩展名对识别毫无帮助。
_FILE_NAME_BY_CONTENT_TYPE = {
    "audio/webm": "audio.webm",
    "audio/ogg": "audio.ogg",
    "audio/mp4": "audio.mp4",
    "audio/mpeg": "audio.mp3",
    "audio/mp3": "audio.mp3",
    "audio/wav": "audio.wav",
    "audio/x-wav": "audio.wav",
    "audio/flac": "audio.flac",
}


class AsrError(RuntimeError):
    """上游转写失败；``kind`` 决定 API 层翻成哪个 HTTP 状态与哪句中文。

    kind 取值：auth（401/403）、not_found（404）、too_large（413）、timeout、
    empty（200 但没有文本）、network（连不上）、upstream（其它非 2xx / 响应不是 JSON）。
    """

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def transcribe_endpoint(base_url: str) -> str:
    """把用户填的 Base URL 拼成转写端点。"""
    return f"{(base_url or '').strip().rstrip('/')}{TRANSCRIBE_PATH}"


def _file_name_for(content_type: str) -> str:
    return _FILE_NAME_BY_CONTENT_TYPE.get(
        (content_type or "").split(";")[0].strip().lower(), "audio.bin"
    )


async def transcribe_audio(
    *,
    base_url: str,
    api_key: str,
    model: str,
    content: bytes,
    content_type: str = "audio/webm",
    language: str = "zh",
    timeout: float | None = None,
) -> str:
    """调上游转写，返回识别文本；失败抛 :class:``AsrError``。

    ``timeout`` 显式传入是为了让测试能在毫秒级验证超时分支（真机走 60 秒默认值）。
    """
    effective_timeout = DEFAULT_TIMEOUT_SECONDS if timeout is None else timeout
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {"file": (_file_name_for(content_type), content, content_type or "audio/webm")}
    data = {"model": model, "language": language, "response_format": "json"}
    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
            response = await client.post(
                transcribe_endpoint(base_url), headers=headers, data=data, files=files
            )
    except httpx.TimeoutException as exc:
        raise AsrError(
            "timeout", f"语音服务响应超时（{effective_timeout:g} 秒），请稍后重试"
        ) from exc
    except httpx.HTTPError as exc:
        raise AsrError("network", "连不上语音服务，请检查网络与语音服务地址") from exc

    status = response.status_code
    if status in (401, 403):
        raise AsrError("auth", "语音服务鉴权失败（401），请检查设置 → 语音转写里的 Key 是否正确")
    if status == 404:
        raise AsrError(
            "not_found", "语音服务地址不存在（404），请检查地址是否包含服务商要求的路径前缀"
        )
    if status == 413:
        raise AsrError("too_large", "语音服务拒绝了这个音频（413），单段录音请控制在 3 分钟内")
    if status >= 400:
        raise AsrError("upstream", f"语音服务返回异常（HTTP {status}），请稍后重试")

    try:
        payload = response.json()
    except ValueError as exc:
        raise AsrError(
            "upstream", "语音服务返回的内容不是合法 JSON，请检查地址是否指向 OpenAI 兼容服务"
        ) from exc
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise AsrError("empty", "没有识别到语音内容，请靠近麦克风重说一遍")
    return text.strip()


def silent_wav_bytes(milliseconds: int = 300) -> bytes:
    """生成一段静音 WAV（8 kHz 单声道 16 bit），供「测试连接」探测上游可达性。

    为什么用合成音频而不是要求用户先录一段：设置页通常是在**录音之前**打开的。
    静音样本对 OpenAI 兼容服务是合法输入（返回空文本），足以验证地址、Key 与模型名；
    识别质量不在这条链路的验证范围内。
    """
    sample_rate = 8000
    sample_count = max(1, sample_rate * max(1, milliseconds) // 1000)
    pcm = b"\x00\x00" * sample_count
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(pcm),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sample_rate,
        sample_rate * 2,
        2,
        16,
        b"data",
        len(pcm),
    )
    return header + pcm


async def probe_asr_connection(
    *, base_url: str, api_key: str, model: str, timeout: float | None = None
) -> tuple[bool, str, int]:
    """「测试连接」：发一段静音看上游是否可达、鉴权是否通过。

    返回 ``(ok, message, latency_ms)``。**空结果算成功**——静音本来就识别不出字，
    能拿到 200 就说明地址/Key/模型都是对的；只有鉴权、404、网络、超时才算失败。
    """
    started = time.perf_counter()
    try:
        await transcribe_audio(
            base_url=base_url,
            api_key=api_key,
            model=model,
            content=silent_wav_bytes(),
            content_type="audio/wav",
            language="zh",
            timeout=timeout,
        )
    except AsrError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        if exc.kind == "empty":
            return True, "连接成功（静音样本没有识别出文字，属正常）", latency_ms
        return False, str(exc), latency_ms
    latency_ms = int((time.perf_counter() - started) * 1000)
    return True, "连接成功", latency_ms
