# SPDX-License-Identifier: Apache-2.0
"""面试官语音合成 · DeepSeek 档（``POST {base}/tools/tts``，音色 stella / tide）。

## 与百炼档并列，不替换

``interview_tts`` 是**分发层**：它决定用哪一档、管进程内缓存、把失败翻成可展示的原因；
本文件只做"一次合成请求"这一件事。这样做的理由是两档的凭据来源本来就是两套：

- 百炼档：从 ASR 配置的活动 profile 推导 origin（同属一个 Key）；
- DeepSeek 档：**只认环境变量** ``DEEPSEEK_API_KEY``（与聊天模型同一份 Key），
  不读 ASR 配置、也不读搜索设置 —— 现有 ``_credentials()`` 的默认值一个字符都没改。

## 三条实测约束

1. **WAV 头里的长度是假的**（实测 ``nframes = 0x7FFFFFFF``，播放器算出 89478 秒）。
   落盘/回传前必须重写 RIFF 头，见 ``tts_shared.normalize_wav``。
2. **只有 stella / tide 两个音色**，且**不支持调速**（语速由前端播放器的 ``playbackRate``
   承担，与百炼档同一口径）；写错音色上游直接 400，不会静默降级。
3. **计费字符上限 10000（汉字算 2 字符）、单次 ≤30 分钟**。本模块按"一句"合成，
   ``MAX_TEXT_LENGTH`` 与百炼档一致（600）——切句是调用方的事，不在这里改粒度。
"""

from __future__ import annotations

import logging
import os

import httpx

from .tts_shared import TtsUnavailable, normalize_wav

logger = logging.getLogger(__name__)

#: 档位标识（前端持久化的就是这几个字符串，改名等于让用户已选的音色失效）。
PROVIDER = "deepseek"

#: 直连根地址。ASR 配置里的 base_url 属于另一条链路，这里**不读它**（见文件头的凭据说明）。
DEFAULT_API_BASE = "https://api.deepseek.com/v1"
TTS_PATH = "/tools/tts"

#: Key 只从环境变量读：与聊天模型同一份 Key，不新增第二处输入。
API_KEY_ENV = "DEEPSEEK_API_KEY"
#: 允许用环境变量改根地址（自建网关 / 联调假上游）；不配就是官方地址。
API_BASE_ENV = "DEEPSEEK_API_BASE"

MODEL = "deepseek-tts"

#: 界面下拉里给的音色。**顺序即默认排序**，第一项是默认值。
VOICES: tuple[tuple[str, str], ...] = (
    ("stella", "Stella · 丝黛拉（女声）"),
    ("tide", "Tide · 潮汐（男声）"),
)
DEFAULT_VOICE = VOICES[0][0]

# 单句上限与百炼档保持一致：调用方按句切分，正常一句 20–80 字。
MAX_TEXT_LENGTH = 600
# 合成超时：实测一句 1–6s。给到 20s 是为了容忍上游排队，而不是为了等更久。
TIMEOUT_SECONDS = 20.0


def api_key() -> str:
    """当前可用的 DeepSeek Key（未配置返回空串，**不回显、不落日志**）。"""
    return (os.environ.get(API_KEY_ENV) or "").strip()


def api_base() -> str:
    """合成根地址（末尾斜杠去掉；空值回落官方地址）。"""
    configured = (os.environ.get(API_BASE_ENV) or "").strip().rstrip("/")
    return configured or DEFAULT_API_BASE


def tts_endpoint() -> str:
    """拼出 ``POST {base}/tools/tts``；base 里已经带路径时（自建网关）不重复拼。"""
    base = api_base()
    if base.endswith(TTS_PATH):
        return base
    return f"{base}{TTS_PATH}"


def available() -> bool:
    """是否具备合成条件（只判断"有没有 Key"，不发请求）。"""
    return bool(api_key())


def voice_supported(voice: str) -> bool:
    """音色是否属于本档（前端持久化的旧值可能来自另一档）。"""
    return any(candidate == voice for candidate, _label in VOICES)


def request_audio(text: str, voice: str) -> bytes:
    """发一次合成请求，返回**已修好 RIFF 头**的 WAV 字节；失败抛 ``TtsUnavailable``。

    参数 ``text`` 已由调用方做过长度与空值校验；这里再判一次是因为本函数也可以被
    「测试连接」这类入口直接调用。
    """
    clean = (text or "").strip()
    if not clean:
        raise TtsUnavailable("没有可合成的文本")
    key = api_key()
    if not key:
        raise TtsUnavailable("没有可用的 DeepSeek Key（请在环境变量 DEEPSEEK_API_KEY 里配置）")
    payload = {"text": clean[:MAX_TEXT_LENGTH], "voice": voice or DEFAULT_VOICE, "format": "wav"}
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            response = client.post(tts_endpoint(), json=payload, headers=headers)
            if response.status_code >= 400:
                # 上游错误体可能带 request id：只截前 200 字进原因，不写 Key、不写全文。
                raise TtsUnavailable(f"语音服务返回 {response.status_code}：{response.text[:200]}")
            audio = response.content
    except TtsUnavailable:
        raise
    except httpx.TimeoutException as error:
        raise TtsUnavailable("语音合成超时") from error
    except httpx.HTTPError as error:
        raise TtsUnavailable(f"语音服务连接失败：{type(error).__name__}") from error
    if not audio:
        raise TtsUnavailable("语音服务返回了空音频")
    fixed = normalize_wav(audio)
    if len(fixed) <= 44:
        raise TtsUnavailable("语音服务返回了空音频")
    logger.info(
        "interview_tts provider=deepseek synthesized chars=%d voice=%s bytes=%d",
        len(clean),
        voice,
        len(fixed),
    )
    return fixed


__all__ = [
    "DEFAULT_API_BASE",
    "DEFAULT_VOICE",
    "MAX_TEXT_LENGTH",
    "MODEL",
    "PROVIDER",
    "TIMEOUT_SECONDS",
    "VOICES",
    "api_base",
    "api_key",
    "available",
    "request_audio",
    "tts_endpoint",
    "voice_supported",
]
