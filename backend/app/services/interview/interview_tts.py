# SPDX-License-Identifier: Apache-2.0
"""面试官语音合成（百炼 ``qwen3-tts-flash``）。

## 为什么需要它

实时语音房间里面试官一直用浏览器 ``speechSynthesis`` 发声，而那里**从来没有设置过
``utterance.voice``** —— 实际发出的是操作系统给 ``zh-CN`` 配的默认音色（缺中文音色时
甚至会拿英文音色念中文）。"选音色的能力"从未交付过，所以这里补的是能力本身，不是"改默认值"。

## 三条实测约束（2026-11-11 与 2026-11-13 两次实测）

1. **首句优先**：60 字约 1.0–2.5s，整段 300 字会到 10s+。调用方按句切分后**并发**请求，
   第一句先播，后面的接上；本模块只负责单句合成，不做切分。
2. **下载抖动大**：同样几十 KB，实测 129ms–3595ms 无规律。所以合成与下载都带超时，
   失败一律抛 :class:`TtsUnavailable`，由调用方回落到浏览器音色（不许静默无声）。
3. **返回的 WAV 头是流式占位符**：``data`` 块长度写的是 ``0x7FFFFF9B``（实测；
   文档里也有 ``0xFFFFFFFF`` 的版本），播放器会算出几万秒。落盘/回传前**必须重写 RIFF 头**，
   见 :func:`normalize_wav`。

## 凭据与隐私

- 凭据复用 ``global_settings.json`` 里 ``asr_profiles`` 的**活动配置**的 ``api_key``
  （同属百炼，不新增第二套密钥输入）。
- **合成结果只缓存在进程内**，不写盘：与 ``interviewVoice.hint.privacy``「音频只在内存里
  逐段识别，不在本地留存」保持一致。
"""

from __future__ import annotations

import hashlib
import logging
import struct
import threading
from collections import OrderedDict

import httpx

from ..asr_profiles import active_profile_settings

logger = logging.getLogger(__name__)

# 后端直连百炼的根地址。ASR 配置里的 base_url 是 OpenAI 兼容路径（``/compatible-mode/v1``），
# 多模态生成走的是另一套路径，所以只取 origin，路径写死在这里。
_DEFAULT_ORIGIN = "https://dashscope.aliyuncs.com"
_GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation"
MODEL = "qwen3-tts-flash"
DEFAULT_VOICE = "Cherry"

#: 界面下拉里给的音色。**顺序即默认排序**，第一项是默认值。
#: 只放实测可用的中文音色；写错的名字上游会直接 400，不会静默降级。
VOICES: tuple[tuple[str, str], ...] = (
    ("Cherry", "Cherry · 芊悦（女声，亲和）"),
    ("Serena", "Serena · 苏瑶（女声，沉稳）"),
    ("Ethan", "Ethan · 晨煦（男声，明亮）"),
    ("Chelsie", "Chelsie · 千雪（女声，轻柔）"),
)

# 单句上限：调用方按句切分，正常一句 20–80 字。留够余量但不允许一次塞整篇。
MAX_TEXT_LENGTH = 600
# 合成（拿 URL）与下载分开计时：实测前者 0.6–1.6s、后者 0.13–3.6s，合成超时没必要等下载。
SYNTH_TIMEOUT_SECONDS = 12.0
DOWNLOAD_TIMEOUT_SECONDS = 20.0
# 进程内缓存条数：一句约 100–300KB，24 条最坏 ~7MB，够覆盖开场 / 追问 / 结束语这套有限集合。
CACHE_LIMIT = 24


class TtsUnavailable(RuntimeError):
    """合成不可用（没配 Key / 上游报错 / 超时 / 下载失败）。

    带一句**可直接展示**的原因：界面上要说明"为什么这次是浏览器音色"，
    静默无声比音色不对更难排查。
    """


_cache: OrderedDict[str, bytes] = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key(text: str, voice: str) -> str:
    digest = hashlib.sha256(f"{voice}\x00{text}".encode()).hexdigest()
    return digest[:32]


def _cached(key: str) -> bytes | None:
    with _cache_lock:
        value = _cache.get(key)
        if value is None:
            return None
        _cache.move_to_end(key)
        return value


def _remember(key: str, audio: bytes) -> None:
    with _cache_lock:
        _cache[key] = audio
        _cache.move_to_end(key)
        while len(_cache) > CACHE_LIMIT:
            _cache.popitem(last=False)


def clear_cache() -> None:
    """清空进程内缓存（换音色后旧音频不该再被命中；测试也用它隔离状态）。"""
    with _cache_lock:
        _cache.clear()


def cache_size() -> int:
    with _cache_lock:
        return len(_cache)


def normalize_wav(raw: bytes) -> bytes:
    """把流式 WAV 的占位长度改写成真实长度。

    只重写 ``RIFF`` 与 ``data`` 两个长度字段，**不动采样数据一个字节**：上游是 24kHz /
    单声道 / 16bit，重采样只会掉质量。找不到 ``data`` 块时原样返回（不是 WAV 的话交给播放器报错，
    比在这里猜格式更诚实）。
    """
    if len(raw) < 44 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        return raw
    pos = 12
    while pos + 8 <= len(raw):
        chunk_id = raw[pos : pos + 4]
        size = struct.unpack("<I", raw[pos + 4 : pos + 8])[0]
        if chunk_id == b"data":
            payload = len(raw) - (pos + 8)
            header = bytearray(raw[: pos + 8])
            header[4:8] = struct.pack("<I", len(raw) - 8)
            header[pos + 4 : pos + 8] = struct.pack("<I", payload)
            return bytes(header) + raw[pos + 8 :]
        # 其它块按声明长度跳过；声明长度明显超出文件时停下，避免死循环。
        if size in (0xFFFFFFFF, 0x7FFFFF9B) or pos + 8 + size > len(raw):
            return raw
        pos += 8 + size + (size % 2)
    return raw


def _origin_of(base_url: str) -> str:
    """从 ASR 配置的 base_url 取 origin；解析不出来就用百炼默认域名。"""
    try:
        parsed = httpx.URL(base_url)
    except Exception:  # noqa: BLE001 - 配置写坏了不该让整条链路崩
        return _DEFAULT_ORIGIN
    if not parsed.scheme or not parsed.host:
        return _DEFAULT_ORIGIN
    return f"{parsed.scheme}://{parsed.host}"


def _credentials() -> tuple[str, str]:
    settings = active_profile_settings()
    if settings is None or not settings.api_key:
        raise TtsUnavailable("没有可用的语音服务凭据")
    return _origin_of(settings.base_url), settings.api_key


def available() -> bool:
    """是否具备合成条件（只判断"有没有配 Key"，不发请求）。"""
    try:
        _credentials()
    except TtsUnavailable:
        return False
    return True


def _request_audio(text: str, voice: str) -> bytes:
    origin, api_key = _credentials()
    url = f"{origin}{_GENERATION_PATH}"
    payload = {"model": MODEL, "input": {"text": text, "voice": voice}}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=SYNTH_TIMEOUT_SECONDS) as client:
            response = client.post(url, json=payload, headers=headers)
            if response.status_code >= 400:
                # 上游的错误体里有 code/message，但可能带请求 id；只取前 200 字进日志与原因。
                raise TtsUnavailable(f"语音服务返回 {response.status_code}：{response.text[:200]}")
            data = response.json()
            audio_url = ((data.get("output") or {}).get("audio") or {}).get("url") or ""
            if not audio_url:
                raise TtsUnavailable("语音服务没有返回音频地址")
            download = client.get(audio_url, timeout=DOWNLOAD_TIMEOUT_SECONDS)
            if download.status_code >= 400:
                raise TtsUnavailable(f"音频下载失败（{download.status_code}）")
            return download.content
    except TtsUnavailable:
        raise
    except httpx.TimeoutException as error:
        raise TtsUnavailable("语音合成超时") from error
    except httpx.HTTPError as error:
        raise TtsUnavailable(f"语音服务连接失败：{type(error).__name__}") from error
    except ValueError as error:  # response.json() 不是 JSON
        raise TtsUnavailable("语音服务返回了无法解析的内容") from error


def synthesize(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """合成一句，返回**已修好 RIFF 头**的 WAV 字节。命中进程内缓存时 0 延迟。"""
    clean = text.strip()
    if not clean:
        raise TtsUnavailable("没有可合成的文本")
    if len(clean) > MAX_TEXT_LENGTH:
        clean = clean[:MAX_TEXT_LENGTH]
    name = voice or DEFAULT_VOICE
    key = _cache_key(clean, name)
    hit = _cached(key)
    if hit is not None:
        return hit
    audio = normalize_wav(_request_audio(clean, name))
    if len(audio) <= 44:
        raise TtsUnavailable("语音服务返回了空音频")
    _remember(key, audio)
    logger.info(
        "interview_tts synthesized chars=%d voice=%s bytes=%d", len(clean), name, len(audio)
    )
    return audio


def prewarm(voice: str = DEFAULT_VOICE) -> None:
    """预热：首次冷启动实测 6.4s（模型冷启），进房间前先打一发固定话术。

    失败**吞掉**：预热是优化，不该把错误抛到请求线程里；真正播放时会再试一次并给出兜底说明。
    """

    def run() -> None:
        try:
            synthesize("你好，我们开始吧。", voice)
        except TtsUnavailable as error:
            logger.info("interview_tts prewarm skipped: %s", error)

    threading.Thread(target=run, name="interview-tts-prewarm", daemon=True).start()


__all__ = [
    "CACHE_LIMIT",
    "DEFAULT_VOICE",
    "MAX_TEXT_LENGTH",
    "MODEL",
    "TtsUnavailable",
    "VOICES",
    "available",
    "cache_size",
    "clear_cache",
    "normalize_wav",
    "prewarm",
    "synthesize",
]
