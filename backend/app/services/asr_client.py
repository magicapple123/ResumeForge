# SPDX-License-Identifier: Apache-2.0
"""语音转写客户端：按 ``protocol`` 分派到两套互不兼容的上游口径。

| protocol    | 端点                          | 请求体                                        |
| ----------- | ----------------------------- | --------------------------------------------- |
| ``openai``  | ``POST {base}/audio/transcriptions`` | ``multipart/form-data``：``file`` + ``model`` + ``language`` |
| ``dashscope`` | ``POST {base}/chat/completions``   | JSON：``messages[0].content=[{type:"input_audio",...}]`` |

为什么必须显式建模协议：阿里云百炼的 OpenAI 兼容地址（``/compatible-mode/v1``）**不实现**
``/audio/transcriptions``，Qwen-ASR 只走 chat + ``input_audio``（只接受公网 URL 或
Base64 Data URI，不接受本地路径，所以音频必须由后端转 base64）。靠地址猜协议必然出错，
协议是配置字段（见 ``schemas/asr.py``）。

错误分类是这个模块存在的主要理由：上层要把 400 上游原因 / 401 / 404 / 413 / 超时 / 空结果
分别翻成**各不相同、且能给下一步**的中文提示（"失败"两个字对用户没有用）。

安全边界：日志与异常消息不携带 Key、不携带音频内容；Key 只出现在发给上游的
``Authorization`` 头里；上游返回的错误消息只截断脱敏后使用。
"""

from __future__ import annotations

import base64
import re
import struct
import time

import httpx

from ..schemas.asr import AsrProtocol

# 单次转写的上游超时：60 秒（计划 §6）。3 分钟音频在这段时间内足够转完；
# 拨高只会让"服务不可用"时用户多等。
DEFAULT_TIMEOUT_SECONDS = 60.0
TRANSCRIBE_PATH = "/audio/transcriptions"
CHAT_COMPLETIONS_PATH = "/chat/completions"
MODELS_PATH = "/models"

# 拉模型列表的上限：三家目录都过百条，界面只需要"能点到的候选"。
MAX_MODEL_COUNT = 100
# 拉模型列表的超时比转写短：它只是一次 GET，用户盯着按钮等。
MODELS_TIMEOUT_SECONDS = 15.0

# 上游错误消息的截断长度与脱敏规则：把 400 的原文给用户看是排查的唯一入口，
# 但整段 HTML / 超长 JSON 会撑爆前端 Alert，且可能带出 Key 片段。
_UPSTREAM_DETAIL_MAX = 300
_SECRET_LIKE = re.compile(r"(sk-[A-Za-z0-9_\-]{6,}|Bearer\s+[A-Za-z0-9._\-]{6,})")

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
    empty（200 但没有文本）、network（连不上）、bad_request（400，带上游原文）、
    upstream（其它非 2xx / 响应不是 JSON）。
    """

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def transcribe_endpoint(base_url: str) -> str:
    """把用户填的 Base URL 拼成 whisper 式转写端点。"""
    return f"{(base_url or '').strip().rstrip('/')}{TRANSCRIBE_PATH}"


def chat_endpoint(base_url: str) -> str:
    """把用户填的 Base URL 拼成 Qwen-ASR 的 chat 端点。"""
    return f"{(base_url or '').strip().rstrip('/')}{CHAT_COMPLETIONS_PATH}"


def models_endpoint(base_url: str) -> str:
    """模型目录端点（两家都是 ``GET {base}/models``）。"""
    return f"{(base_url or '').strip().rstrip('/')}{MODELS_PATH}"


def _file_name_for(content_type: str) -> str:
    return _FILE_NAME_BY_CONTENT_TYPE.get(
        (content_type or "").split(";")[0].strip().lower(), "audio.bin"
    )


def _audio_data_url(content: bytes, content_type: str) -> str:
    """``data:<mime>;base64,<payload>``：Qwen-ASR 的 ``input_audio.data`` 只认这个或公网 URL。"""
    mime = (content_type or "audio/webm").split(";")[0].strip() or "audio/webm"
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _sanitize_upstream_text(text: str) -> str:
    """压平空白 + 抹掉像密钥的片段 + 截断：只保留可读的排查信息。"""
    flattened = " ".join((text or "").split())
    return _SECRET_LIKE.sub("***", flattened)[:_UPSTREAM_DETAIL_MAX]


def _upstream_detail(response: httpx.Response) -> str:
    """取上游 ``error.message``（也兼容 ``message`` / ``detail`` 与错误体是纯文本）。

    400 是唯一一类"用户必须看到上游原话"的失败：地址对了、模型名打错、音频被判无效，
    都只能从上游那句里看出来。取不到就退回空串，调用方用自己的兜底文案。
    """
    try:
        payload = response.json()
    except ValueError:
        return _sanitize_upstream_text(response.text or "")
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if isinstance(error, dict):
        message = str(error.get("message") or "")
    elif isinstance(error, str):
        message = error
    else:
        message = ""
    if not message:
        message = str(payload.get("message") or payload.get("detail") or "")
    return _sanitize_upstream_text(message)


def _message_of(payload: dict) -> str:
    """从 chat 响应里取文本：``choices[0].message.content`` 可能是字符串或分段数组。"""
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # 分段数组：[{type: "text", text: "..."}, ...]（也兼容 {"text": {"value": ...}} 这类嵌套）。
        parts: list[str] = []
        for segment in content:
            if isinstance(segment, str):
                parts.append(segment)
                continue
            if not isinstance(segment, dict):
                continue
            text = segment.get("text")
            if isinstance(text, str):
                parts.append(text)
            elif isinstance(text, dict) and isinstance(text.get("value"), str):
                parts.append(text["value"])
        return "".join(parts)
    return ""


def _raise_for_status(response: httpx.Response) -> None:
    """把非 2xx 翻成带 ``kind`` 的 :class:`AsrError`（两家协议共用）。"""
    status = response.status_code
    if status in (401, 403):
        raise AsrError("auth", "语音服务鉴权失败（401），请检查设置 → 语音转写里的 Key 是否正确")
    if status == 404:
        raise AsrError(
            "not_found", "语音服务地址不存在（404），请检查地址是否包含服务商要求的路径前缀"
        )
    if status == 413:
        raise AsrError("too_large", "语音服务拒绝了这个音频（413），单段录音请控制在 3 分钟内")
    if status == 400:
        detail = _upstream_detail(response)
        suffix = f"：{detail}" if detail else ""
        raise AsrError("bad_request", f"语音服务拒绝了这次请求（HTTP 400）{suffix}")
    if status >= 400:
        detail = _upstream_detail(response)
        suffix = f"（{detail}）" if detail else ""
        raise AsrError("upstream", f"语音服务返回异常（HTTP {status}）{suffix}，请稍后重试")


async def _post_openai_compatible(
    *, base_url: str, api_key: str, model: str, content: bytes, content_type: str, language: str,
    timeout: float,
) -> str:
    """whisper 式 ``multipart/form-data`` 转写（OpenAI / Groq / 硅基流动）。"""
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {"file": (_file_name_for(content_type), content, content_type or "audio/webm")}
    data = {"model": model, "language": language, "response_format": "json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            transcribe_endpoint(base_url), headers=headers, data=data, files=files
        )
    _raise_for_status(response)
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


async def _post_dashscope(
    *, base_url: str, api_key: str, model: str, content: bytes, content_type: str, language: str,
    timeout: float,
) -> str:
    """Qwen-ASR 式 ``chat/completions`` 转写（阿里云百炼）。"""
    body: dict[str, object] = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {"data": _audio_data_url(content, content_type)},
                    }
                ],
            }
        ],
        "stream": False,
    }
    # language 可选：不填时由上游自动判定；填了必须是 ISO 码（API 层已校验）。
    if language:
        body["asr_options"] = {"language": language}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(chat_endpoint(base_url), headers=headers, json=body)
    _raise_for_status(response)
    try:
        payload = response.json()
    except ValueError as exc:
        raise AsrError(
            "upstream", "语音服务返回的内容不是合法 JSON，请检查地址是否指向阿里云百炼兼容服务"
        ) from exc
    text = _message_of(payload if isinstance(payload, dict) else {})
    if not text.strip():
        raise AsrError("empty", "没有识别到语音内容，请靠近麦克风重说一遍")
    return text.strip()


async def transcribe_audio(
    *,
    base_url: str,
    api_key: str,
    model: str,
    content: bytes,
    content_type: str = "audio/webm",
    language: str = "zh",
    protocol: AsrProtocol = "openai",
    timeout: float | None = None,
) -> str:
    """调上游转写，返回识别文本；失败抛 :class:`AsrError`。

    ``timeout`` 显式传入是为了让测试能在毫秒级验证超时分支（真机走 60 秒默认值）。
    ``protocol`` 决定走哪套请求体（见模块头的表），默认 ``openai``。
    """
    effective_timeout = DEFAULT_TIMEOUT_SECONDS if timeout is None else timeout
    callback = _post_dashscope if protocol == "dashscope" else _post_openai_compatible
    try:
        return await callback(
            base_url=base_url,
            api_key=api_key,
            model=model,
            content=content,
            content_type=content_type,
            language=language,
            timeout=effective_timeout,
        )
    except httpx.TimeoutException as exc:
        raise AsrError(
            "timeout", f"语音服务响应超时（{effective_timeout:g} 秒），请稍后重试"
        ) from exc
    except httpx.HTTPError as exc:
        raise AsrError("network", "连不上语音服务，请检查网络与语音服务地址") from exc


def silent_wav_bytes(milliseconds: int = 1000) -> bytes:
    """生成一段静音 WAV（8 kHz 单声道 16 bit），供「测试连接」探测上游可达性。

    为什么用合成音频而不是要求用户先录一段：设置页通常是在**录音之前**打开的。
    静音样本对 OpenAI 兼容服务是合法输入（返回空文本），足以验证地址、Key 与模型名；
    识别质量不在这条链路的验证范围内。

    长度 1000ms 而不是 300ms：Qwen-ASR 这类服务会把过短的样本直接判成"无有效语音"并回
    400，1 秒能显著降低这种误判（计划 §6 的随访结论）。
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


# 上游对"静音样本"的抱怨：命中这些词说明它已经读到音频，只是内容里没有人声。
_AUDIO_COMPLAINT_HINTS = (
    "audio",
    "音频",
    "语音",
    "no speech",
    "too short",
    "empty",
    "silence",
    "无声",
    "无效",
    "invalid",
)


def _looks_like_audio_complaint(message: str) -> bool:
    lowered = (message or "").lower()
    return any(hint in lowered for hint in _AUDIO_COMPLAINT_HINTS)


async def probe_asr_connection(
    *,
    base_url: str,
    api_key: str,
    model: str,
    protocol: AsrProtocol = "openai",
    timeout: float | None = None,
) -> tuple[bool, str, int]:
    """「测试连接」：发一段静音看上游是否可达、鉴权是否通过。

    返回 ``(ok, message, latency_ms)``。**空结果算成功**——静音本来就识别不出字，
    能拿到 200 就说明地址/Key/模型都是对的；只有鉴权、404、网络、超时才算失败。
    400 且上游原话指向音频内容（"no speech" / "too short" / 无效音频）同样算可达：
    这条链路验的是配置，不是识别质量。
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
            protocol=protocol,
            timeout=timeout,
        )
    except AsrError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        if exc.kind == "empty":
            return True, "连接成功（静音样本没有识别出文字，属正常）", latency_ms
        if exc.kind == "bad_request" and _looks_like_audio_complaint(str(exc)):
            return True, "连接成功（上游读到了音频，只是静音样本没有语音）", latency_ms
        return False, str(exc), latency_ms
    latency_ms = int((time.perf_counter() - started) * 1000)
    return True, "连接成功", latency_ms


async def fetch_asr_models(
    *,
    base_url: str,
    api_key: str,
    protocol: AsrProtocol = "openai",
    timeout: float | None = None,
) -> list[str]:
    """拉取模型目录（``GET {base}/models`` → ``data[].id``）。

    与语义检索的 ``rag_remote_setup.fetch_models`` 同一模式：**任何失败都返回空列表**，
    界面退回手填。拉不到列表不该让"填地址 + 手打模型名"这条路消失。

    ``protocol`` 目前不影响端点（两家都用 ``/models``），但保留在签名里：协议决定解析
    口径时（未来出现只返回 ``models[]`` 的服务）调用方不需要改。**不做关键词过滤**——
    目录里混着 LLM 与图像模型，按词裁剪会误杀自定义服务的模型名，分组交给前端。
    """
    del protocol  # 两家端点一致，见 docstring
    effective_timeout = MODELS_TIMEOUT_SECONDS if timeout is None else timeout
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
            response = await client.get(models_endpoint(base_url), headers=headers)
    except httpx.HTTPError:
        return []
    if response.status_code >= 400:
        return []
    try:
        payload = response.json()
    except ValueError:
        return []
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []
    names: list[str] = []
    seen: set[str] = set()
    for item in data:
        model_id = item.get("id") if isinstance(item, dict) else None
        if not isinstance(model_id, str):
            continue
        cleaned = model_id.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        names.append(cleaned)
        if len(names) >= MAX_MODEL_COUNT:
            break
    return names
