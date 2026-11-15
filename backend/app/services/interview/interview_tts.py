# SPDX-License-Identifier: Apache-2.0
"""面试官语音合成（两档并列：百炼 ``qwen3-tts-flash`` / DeepSeek ``deepseek-tts``）。

## 两档怎么分工（2026-11-15 新增 DeepSeek 档）

- **百炼档**（默认，``provider="dashscope"``）：4 个中文音色 ``Cherry / Serena / Ethan /
  Chelsie``，凭据沿用 ASR 配置活动 profile 的 Key（同属百炼，不新增第二套输入）；
- **DeepSeek 档**（``provider="deepseek"``）：只有 ``stella / tide``，凭据**只认环境变量**
  ``DEEPSEEK_API_KEY``（见 ``interview_tts_deepseek``）。

**选择语义**：档位与音色都是前端持久化的字符串，所以两条不能互相污染——
``resolve_voice()`` 在"音色不属于当前档"时回落到该档默认音色，并把回落事实交回调用方
（``synthesize`` 返回的音频不带这信息，所以 `api/interview_voice.py` 先用它一次再合成），
界面上要显式说出来：静默变声等同于"设置坏了"。旧值一个都不删——选回百炼档时
``Cherry`` 等四个音色原样可用。

## 为什么需要它

实时语音房间里面试官一直用浏览器 ``speechSynthesis`` 发声，而那里**从来没有设置过
``utterance.voice``** —— 实际发出的是操作系统给 ``zh-CN`` 配的默认音色（缺中文音色时
甚至会拿英文音色念中文）。"选音色的能力"从未交付过，所以这里补的是能力本身，不是"改默认值"。

## 三条实测约束（2026-11-11 与 2026-11-13 两次实测；DeepSeek 为 2026-11-15）

1. **首句优先**：60 字约 1.0–2.5s，整段 300 字会到 10s+。调用方按句切分后**并发**请求，
   第一句先播，后面的接上；本模块只负责单句合成，不做切分。
2. **下载抖动大**：同样几十 KB，实测 129ms–3595ms 无规律。所以合成与下载都带超时，
   失败一律抛 :class:`TtsUnavailable`，由调用方回落到浏览器音色（不许静默无声）。
3. **返回的 WAV 头是流式占位符**：百炼实测 ``data`` 块长度写的是 ``0x7FFFFF9B``，
   DeepSeek 实测 ``nframes = 0x7FFFFFFF``（播放器算出 89478 秒）。落盘/回传前**必须重写
   RIFF 头**，两档共用 ``tts_shared.normalize_wav``。

## 凭据与隐私

- 百炼档：凭据复用 ``global_settings.json`` 里 ``asr_profiles`` 的**活动配置**的 ``api_key``
  （同属百炼，不新增第二套密钥输入）。**这段默认值一个字符都没改**：DeepSeek 档不是从它
  推导出来的，而是新开一套解析（环境变量），见 ``interview_tts_deepseek``。
- **合成结果只缓存在进程内**，不写盘：与 ``interviewVoice.hint.privacy``「音频只在内存里
  逐段识别，不在本地留存」保持一致。缓存键含 ``provider``——否则换档后会命中另一档的音频。
"""

from __future__ import annotations

import hashlib
import logging
import threading
from collections import OrderedDict

import httpx

from ..asr_profiles import active_profile_settings
from . import interview_tts_deepseek
from .tts_shared import TtsUnavailable, normalize_wav

logger = logging.getLogger(__name__)

#: 档位标识。**前端持久化的就是这个字符串**，改名等于让用户已选的档位与音色失效。
PROVIDER_DASHSCOPE = "dashscope"
PROVIDER_DEEPSEEK = interview_tts_deepseek.PROVIDER
DEFAULT_PROVIDER = PROVIDER_DASHSCOPE
#: 下拉里的档位顺序（第一项是默认档）。界面显示名走前端语言包，这里只给 id。
PROVIDER_IDS: tuple[str, ...] = (PROVIDER_DASHSCOPE, PROVIDER_DEEPSEEK)

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


_cache: OrderedDict[str, bytes] = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key(text: str, voice: str, provider: str) -> str:
    """缓存键含档位：同一句在两个 provider 下的音频不同，混用会"换档不生效"。"""
    digest = hashlib.sha256(f"{provider}\x00{voice}\x00{text}".encode()).hexdigest()
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


# ===== 档位清单（一个地方回答"这一档有哪些音色 / 默认是谁 / 怎么算可用"）=====


def normalize_provider(value: str | None) -> str:
    """把外部传入的档位收成合法值：不认识（含空/旧客户端不传）回落默认档。

    为什么回落而不是报错：档位是"这台机器上我怎么听"的偏好，写坏了不该让通话打不开；
    前端下拉永远只提交上面两个 id 之一。
    """
    candidate = (value or "").strip()
    return candidate if candidate in PROVIDER_IDS else DEFAULT_PROVIDER


def voices_of(provider: str = DEFAULT_PROVIDER) -> tuple[tuple[str, str], ...]:
    """该档的音色清单（id, 显示名）；顺序即默认排序。"""
    if normalize_provider(provider) == PROVIDER_DEEPSEEK:
        return interview_tts_deepseek.VOICES
    return VOICES


def default_voice_of(provider: str = DEFAULT_PROVIDER) -> str:
    """该档的默认音色。"""
    if normalize_provider(provider) == PROVIDER_DEEPSEEK:
        return interview_tts_deepseek.DEFAULT_VOICE
    return DEFAULT_VOICE


def model_of(provider: str = DEFAULT_PROVIDER) -> str:
    """该档对应的模型标识（DeepSeek 的 ``deepseek-tts`` 只是口径名，请求体里没有它）。"""
    if normalize_provider(provider) == PROVIDER_DEEPSEEK:
        return interview_tts_deepseek.MODEL
    return MODEL


def voice_supported(provider: str, voice: str) -> bool:
    """这个音色是否属于这一档（前端持久化的旧值可能来自另一档）。"""
    return any(candidate == (voice or "") for candidate, _label in voices_of(provider))


def resolve_voice(provider: str, voice: str) -> tuple[str, bool]:
    """``(实际使用的音色, 是否发生了回落)``。

    **不静默变声**：回落事实交回调用方，界面必须说出来（"X 在 Y 档不可用，已改用 Z"）。
    空音色也走回落分支——那说明前端还没写过值，用默认值不是"变化"。
    """
    target = normalize_provider(provider)
    chosen = (voice or "").strip()
    if not chosen:
        return default_voice_of(target), False
    if voice_supported(target, chosen):
        return chosen, False
    return default_voice_of(target), True


# ===== 百炼档的凭据与请求 =====


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
    """百炼档凭据：**沿用既有推导**（ASR 活动配置的 origin + Key），默认值不改。"""
    settings = active_profile_settings()
    if settings is None or not settings.api_key:
        raise TtsUnavailable("没有可用的语音服务凭据")
    return _origin_of(settings.base_url), settings.api_key


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


# ===== 档位分派 =====


def available(provider: str = DEFAULT_PROVIDER) -> bool:
    """是否具备合成条件（只判断"有没有配凭据"，不发请求）。"""
    target = normalize_provider(provider)
    if target == PROVIDER_DEEPSEEK:
        return interview_tts_deepseek.available()
    try:
        _credentials()
    except TtsUnavailable:
        return False
    return True


def _request_for(provider: str, text: str, voice: str) -> bytes:
    if provider == PROVIDER_DEEPSEEK:
        return interview_tts_deepseek.request_audio(text, voice)
    return _request_audio(text, voice)


def synthesize(text: str, voice: str = DEFAULT_VOICE, provider: str = DEFAULT_PROVIDER) -> bytes:
    """合成一句，返回**已修好 RIFF 头**的 WAV 字节。命中进程内缓存时 0 延迟。

    ``voice`` 不属于当前档时按该档默认音色合成（同 ``resolve_voice``）：调用方应当在
    界面上一并说明，方法本身不抛错——把"音色写错"变成"没声音"是更差的结果。
    """
    target = normalize_provider(provider)
    clean = text.strip()
    if not clean:
        raise TtsUnavailable("没有可合成的文本")
    if len(clean) > MAX_TEXT_LENGTH:
        clean = clean[:MAX_TEXT_LENGTH]
    name, _fell_back = resolve_voice(target, voice)
    key = _cache_key(clean, name, target)
    hit = _cached(key)
    if hit is not None:
        return hit
    audio = normalize_wav(_request_for(target, clean, name))
    if len(audio) <= 44:
        raise TtsUnavailable("语音服务返回了空音频")
    _remember(key, audio)
    # 计量（T16）：只在**真的发了一次上游请求**之后记，缓存命中不重复计费。
    # 记失败不影响合成（用户要的是声音，账目问题不该把声音变成错误）。
    from ..usage_counters import KIND_TTS, record_external_usage
    from ..usage_units import tts_billable_chars

    try:
        record_external_usage(
            KIND_TTS,
            tts_billable_chars(clean),
            source=f"interview_tts:{target}",
            dedupe_key=key,
        )
    except Exception:  # noqa: BLE001 - 计量是旁路
        logger.warning("TTS 用量记录失败 provider=%s", target, exc_info=True)
    logger.info(
        "interview_tts synthesized provider=%s chars=%d voice=%s bytes=%d",
        target,
        len(clean),
        name,
        len(audio),
    )
    return audio


def prewarm(voice: str = DEFAULT_VOICE, provider: str = DEFAULT_PROVIDER) -> None:
    """预热：首次冷启动实测 6.4s（模型冷启），进房间前先打一发固定话术。

    失败**吞掉**：预热是优化，不该把错误抛到请求线程里；真正播放时会再试一次并给出兜底说明。
    """
    target = normalize_provider(provider)
    name, _fell_back = resolve_voice(target, voice)

    def run() -> None:
        try:
            synthesize("你好，我们开始吧。", name, target)
        except TtsUnavailable as error:
            logger.info("interview_tts prewarm skipped: %s", error)

    threading.Thread(
        target=run, name=f"interview-tts-prewarm-{target}", daemon=True
    ).start()


def provider_status(provider: str) -> dict[str, object]:
    """档位的一次性快照（`GET /voice/tts/status` 的 ``providers[]`` 一项）。

    只读配置、不发请求：音色清单与默认值必须与 ``synthesize`` 用同一份来源，
    否则下拉里会有"点了没声音"的项。
    """
    target = normalize_provider(provider)
    return {
        "id": target,
        "model": model_of(target),
        "default_voice": default_voice_of(target),
        "available": available(target),
        "voices": [{"id": key, "label": label} for key, label in voices_of(target)],
    }


__all__ = [
    "CACHE_LIMIT",
    "DEFAULT_PROVIDER",
    "DEFAULT_VOICE",
    "MAX_TEXT_LENGTH",
    "MODEL",
    "PROVIDER_DASHSCOPE",
    "PROVIDER_DEEPSEEK",
    "PROVIDER_IDS",
    "TtsUnavailable",
    "VOICES",
    "available",
    "cache_size",
    "clear_cache",
    "default_voice_of",
    "model_of",
    "normalize_provider",
    "normalize_wav",
    "prewarm",
    "provider_status",
    "resolve_voice",
    "synthesize",
    "voice_supported",
    "voices_of",
]
