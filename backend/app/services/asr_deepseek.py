# SPDX-License-Identifier: Apache-2.0
"""语音转写 · 第三套协议 ``deepseek``（``POST {base}/tools/asr``）。

## 为什么它必须是一个独立协议，而不是"又一个 openai 兼容服务"

DeepSeek 的转写**不是** whisper 那套：

| 项目 | openai / dashscope | deepseek |
| --- | --- | --- |
| 端点 | ``/audio/transcriptions`` / ``/chat/completions`` | ``/tools/asr`` |
| 请求体 | multipart（含 ``model``）/ JSON | multipart，**只有 ``file``，没有 ``model``** |
| 接受格式 | webm / mp3 / m4a … | **只收 16bit PCM WAV 或 Ogg Opus** |
| 单段上限 | 180 秒 / 10 MB | **120 秒 / 8 MiB** |
| 流式 | — | **不支持**（所以 120 秒是硬上限，不是可调参数） |
| 响应 | ``{text}`` / ``choices`` | ``{request_id, text, duration_ms}`` |

因此"三个要素齐全才算配置好"这条判据对它是错的：它**没有 model 参数**，
``is_asr_configured`` 必须按协议给出最小要素（见 ``asr_settings``）。

## 两处数字必须写在同一个地方

- 上限（120 秒 / 8 MiB）在 ``audio_limits_for`` 里，服务端校验、``/transcribe/status``
  回给前端、UI 上那句解释都读它——三处各写一份必然漂移（今天前端滑块是 60–300、
  服务端是 180 秒，已经不一致了）。
- 模型口径 ``deepseek-asr`` **不是**提交给上游的参数，只是界面上"用哪个模型"那一格的
  显示值：它没有 ``/models`` 目录，所以 ``fetch_asr_models`` 不许为它发请求。
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from ..schemas.asr import MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS
from .asr_errors import AsrError, raise_for_status

#: 协议标识（写进 ``AppSetting.asr_config.protocol`` 与前端持久化，改名等于让配置失效）。
PROTOCOL = "deepseek"
#: 官方根地址。用户填的 base_url 以它开头时可以只填到 ``/v1``。
DEFAULT_API_BASE = "https://api.deepseek.com/v1"
ASR_PATH = "/tools/asr"

#: 与官方文档一致的硬上限（不支持流式，所以时长不是"可调"的）。
MAX_AUDIO_SECONDS_BY_PROVIDER = 120
MAX_AUDIO_BYTES_BY_PROVIDER = 8 * 1024 * 1024

#: 没有 ``model`` 参数时界面上的模型口径（也用于"这一档的模型列表"）。
MODEL_LABEL = "deepseek-asr"

#: 上游只接受这两种容器。清单外的格式**不转发**：让上游回一句笼统的 400 对用户没有帮助，
#: 而我们能提前说清"请改用 WAV"。
ACCEPTED_CONTENT_TYPES = frozenset(
    {
        "audio/wav",
        "audio/wave",
        "audio/x-wav",
        "audio/vnd.wave",
        "audio/ogg",
        "audio/opus",
    }
)


@dataclass(frozen=True)
class AudioLimits:
    """一套协议下的单段上限（秒 / 字节）。"""

    seconds: int
    bytes: int
    #: 需要向用户解释原因时为 True（现在只有 DeepSeek：不支持流式 + 单请求 120 秒）。
    needs_reason: bool = False


def audio_limits_for(protocol: str) -> AudioLimits:
    """该协议的单段上限。**收敛三套数字的唯一入口**。

    ``openai`` / ``dashscope`` 沿用既有 180 秒 / 10 MB（不改既有行为），
    ``deepseek`` 是 120 秒 / 8 MiB，并且 ``needs_reason=True``——UI 必须说明原因，
    不许静默把用户滑块拉到 300 的值砍掉。
    """
    if protocol == PROTOCOL:
        return AudioLimits(
            seconds=MAX_AUDIO_SECONDS_BY_PROVIDER,
            bytes=MAX_AUDIO_BYTES_BY_PROVIDER,
            needs_reason=True,
        )
    return AudioLimits(seconds=MAX_AUDIO_SECONDS, bytes=MAX_AUDIO_BYTES)


def asr_endpoint(base_url: str) -> str:
    """拼出 ``POST {base}/tools/asr``；base 已经带路径时（自建网关）不重复拼。"""
    base = (base_url or "").strip().rstrip("/")
    if base.endswith(ASR_PATH):
        return base
    return f"{base}{ASR_PATH}"


def validated_endpoint(base_url: str) -> str:
    """把用户填的 ``base_url`` 收成一个**只可能是 http(s) 主机**的请求地址。

    这道校验不是"防别人的服务器"——本项目是本地单用户工具，地址由使用者在设置里填，
    指向 ``127.0.0.1`` 上的自建网关是正常用法（所以**不**做内网/回环黑名单，那会把
    本地部署直接打死）。它拦的是**协议与形态**：``file:`` / ``gopher:`` / ``ftp:`` 这类
    非 HTTP 方案、空主机、带 userinfo 的地址（``https://user:pass@host`` 会让凭据
    进日志与错误信息）一律拒绝，并且拒绝时只回一句可读原因，不把原地址拼进消息。
    """
    endpoint = asr_endpoint(base_url)
    parts = urlsplit(endpoint)
    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"} or not parts.hostname:
        raise AsrError("bad_request", "语音服务地址必须是 http(s) 开头的完整地址")
    if parts.username or parts.password:
        raise AsrError("bad_request", "语音服务地址里不要带用户名或密码，请用 Key 字段填写凭据")
    return endpoint


def accepts_content(content_type: str) -> bool:
    """这个 Content-Type 是否在 DeepSeek 接受的容器里。"""
    return (content_type or "").split(";")[0].strip().lower() in ACCEPTED_CONTENT_TYPES


def fixed_models() -> list[str]:
    """该档的"模型列表"：一个口径名，**不发任何请求**（DeepSeek 没有 ``/models``）。

    返回非空而不是空列表，是为了让调用方（设置页的下拉）不需要为某一档写特例：
    "模型"这一格对 DeepSeek 仍有显示值，只是不需要用户改。
    """
    return [MODEL_LABEL]


def requires_model(protocol: str) -> bool:
    """这一档是否需要用户填模型名。

    DeepSeek 的请求体只有 ``file``，多传 ``model`` 反而 400；其余两档缺模型发不出合法请求。
    """
    return protocol != PROTOCOL


def is_endpoint_configured(*, base_url: str, model: str, api_key: str, protocol: str) -> bool:
    """**配置是否可用**的唯一实现（按协议取最小要素）。

    四个调用方共用这一份：``asr_settings.is_asr_configured``（运行时/设置页）、
    ``asr_profiles._is_configured``（能不能设为「使用中」）、``asr_profiles._profile_out``
    （卡片上的"已配置"）、``api/transcribe.test_asr_settings``（测试连接的必填校验）。
    分散写四遍的后果是实测过的：搜索那条链路通了、语音这条还在说"没 key"。
    """
    if not (base_url and api_key):
        return False
    return bool(model) if requires_model(protocol) else True


def incomplete_message(protocol: str) -> str:
    """配置不全时给用户的一句可操作提示（DeepSeek 不该被要求填模型）。"""
    if requires_model(protocol):
        return "这条配置缺少服务地址、模型或 Key，补齐后才能设为使用中"
    return "这条配置缺少服务地址或 Key，补齐后才能设为使用中"


def unsupported_format_message(content_type: str) -> str:
    """格式不支持时的可操作提示（两条出路：换格式、或换协议）。"""
    actual = (content_type or "").split(";")[0].strip() or "未知"
    return (
        "DeepSeek 转写只接受 16bit PCM WAV 或 Ogg Opus，"
        f"这段录音的格式是 {actual}。请改用 WAV 录音，或把协议换成 openai / dashscope"
    )


async def post_asr(
    *,
    base_url: str,
    api_key: str,
    content: bytes,
    content_type: str,
    timeout: float,
) -> str:
    """发一次 ``tools/asr`` 请求，返回识别文本（空文本抛 ``empty``）。

    请求体只有 ``file`` 一个字段：多传 ``model`` / ``language`` 上游会 400，
    所以这里**不转发**调用方传进来的 model 与 language（它们对 DeepSeek 无意义）。
    """
    if not accepts_content(content_type):
        raise AsrError("bad_request", unsupported_format_message(content_type))
    mime = (content_type or "audio/wav").split(";")[0].strip() or "audio/wav"
    files = {"file": ("voice.wav" if "wav" in mime else "voice.ogg", content, mime)}
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(validated_endpoint(base_url), headers=headers, files=files)
    raise_for_status(response)
    try:
        payload = response.json()
    except ValueError as exc:
        raise AsrError(
            "upstream", "语音服务返回的内容不是合法 JSON，请检查地址是否指向 DeepSeek 的 /v1"
        ) from exc
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise AsrError("empty", "没有识别到语音内容，请靠近麦克风重说一遍")
    return text.strip()


__all__ = [
    "ACCEPTED_CONTENT_TYPES",
    "ASR_PATH",
    "AudioLimits",
    "DEFAULT_API_BASE",
    "MAX_AUDIO_BYTES_BY_PROVIDER",
    "MAX_AUDIO_SECONDS_BY_PROVIDER",
    "MODEL_LABEL",
    "PROTOCOL",
    "accepts_content",
    "asr_endpoint",
    "audio_limits_for",
    "fixed_models",
    "incomplete_message",
    "is_endpoint_configured",
    "post_asr",
    "requires_model",
    "unsupported_format_message",
    "validated_endpoint",
]
