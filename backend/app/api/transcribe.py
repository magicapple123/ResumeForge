# SPDX-License-Identifier: Apache-2.0
"""语音听写接口：ASR 配置读写 + 测试连接 + 拉模型列表 + ``POST /api/transcribe``。

为什么配置端点（``/api/settings/asr``）也放在这个文件：本文件归语音线独占，而
``api/settings.py`` 是其它线在看管的写入面。继续往那个 429 行的文件里加会同时带来
行数预算与写入冲突两个风险；ASR 的端点放在一起也更像一套完整能力。

三条硬边界（计划 §6）：

1. **不回显 Key**：读取只返回掩码；PUT 的掩码/空值按"沿用旧 Key"处理（地址或协议变了才清）；
2. **不记录音频**：日志只有 ``status / bytes / ms / host``，不写文件名、内容与 Key；
3. **限额在服务端再拦一道**：10 MB + 180 秒，前端能绕过，后端不能信。

上游错误按"让用户知道下一步怎么办"分类：鉴权失败指向 Key、404 指向地址前缀、400 带上
上游原话（模型名打错、音频被判无效只能从原话看出）、413 指向时长、超时与空结果各有独立
文案——前端据此出互不相同的提示。

「沿用旧 Key」的解析只写一份（``_resolve_key``）：测试连接、拉模型列表、保存三处判据必须
逐字一致，否则会出现"测试能用、拉模型说没 Key"这种谁都说不清的分歧。
"""

from __future__ import annotations

import logging
import re
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.asr import (
    MAX_AUDIO_BYTES,
    MAX_AUDIO_SECONDS,
    AsrModelsRequest,
    AsrModelsResult,
    AsrProtocol,
    AsrSettings,
    AsrSettingsOut,
    AsrSettingsTestResult,
    AsrStatus,
    TranscribeResult,
)
from ..services.api_key_crypto import ApiKeyEncryptionError
from ..services.asr_client import (
    AsrError,
    fetch_asr_models,
    probe_asr_connection,
    transcribe_audio,
)
from ..services.asr_settings import (
    CLEAR_API_KEY,
    binding_changed,
    get_asr_runtime_settings,
    get_asr_settings,
    is_asr_configured,
    provider_host,
    resolve_asr_api_key,
    save_asr_settings,
)
from ..services.llm_key_refs import API_KEY_MASK

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["voice"])

MAX_AUDIO_MS = MAX_AUDIO_SECONDS * 1000

_NOT_CONFIGURED_DETAIL = "未配置语音服务，请到 设置 → 语音转写 填写地址与 Key"
_TOO_LARGE_DETAIL = "音频超过 10 MB，无法转写"
_TOO_LONG_DETAIL = f"单段录音最长 {MAX_AUDIO_SECONDS // 60} 分钟，请缩短后重试"
_EMPTY_AUDIO_DETAIL = "没有读到音频数据，请重新录音"
_BAD_LANGUAGE_DETAIL = "语言代码不合法，请使用 zh / en 这类 ISO 语言码"
_BAD_DURATION_DETAIL = "录音时长不合法，请重新录音"

# 语言只接受 ISO 语言码（zh / en / zh-CN / en-US）：它会被原样放进上游客体的表单字段，
# 不做白名单校验等于把任意字符串交给上游。
_LANGUAGE_PATTERN = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$")

# 上游失败 → 本地状态码。鉴权/404/网络这类"配置或环境问题"统一 502（网关错），
# 超时单独 504，用户自己录的音频过大 413、空结果 422、400 原样 400——前端按状态出不同文案。
_ASR_ERROR_STATUS = {
    "auth": 502,
    "not_found": 502,
    "network": 502,
    "upstream": 502,
    "bad_request": 400,
    "timeout": 504,
    "too_large": 413,
    "empty": 422,
}


def _resolve_protocol(payload: AsrSettings | AsrModelsRequest, stored: AsrSettings) -> AsrProtocol:
    """协议也有"沿用已保存值"这一档：老客户端不传 protocol 时用落库的那套。

    判据用 ``model_fields_set`` 而不是 `payload.protocol or stored.protocol`：协议默认值是
    ``"openai"``（真值），`or` 永远走不到右边，落库的 ``dashscope`` 会被静默改掉。
    """
    if "protocol" in payload.model_fields_set:
        return payload.protocol
    return stored.protocol


def _resolve_key(
    db: Session, payload: AsrSettings | AsrModelsRequest, protocol: AsrProtocol
) -> str:
    """把前端提交的 ``api_key`` 解析成真正要用的 Key（三种写入口径的唯一实现）。

    - ``__clear__`` → 空串（用户点了「清除 Key」）；
    - 掩码或空串 → 前端回显的旧值。**地址与协议都没变**才允许复用已保存的 Key：把旧
      服务商的 Key 发给用户新填的主机（或换一套协议时的另一条路径）是越权外发，宁可让他重填；
    - 其它字符串 → 就是新 Key。
    """
    raw_key = payload.api_key
    if raw_key == CLEAR_API_KEY:
        return ""
    if raw_key.startswith(API_KEY_MASK) or not raw_key:
        stored = get_asr_runtime_settings(db)
        unchanged = not payload.base_url or not binding_changed(
            stored, payload.base_url, protocol
        )
        return resolve_asr_api_key(db) if unchanged else ""
    return raw_key


@router.get("/settings/asr", response_model=AsrSettingsOut)
def read_asr_settings(db: Session = Depends(get_db)) -> AsrSettingsOut:
    """读取语音服务配置：``api_key`` 只可能是掩码或空串。"""
    return get_asr_settings(db)


@router.put("/settings/asr", response_model=AsrSettingsOut)
def write_asr_settings(payload: AsrSettings, db: Session = Depends(get_db)) -> AsrSettingsOut:
    """保存语音服务配置；DPAPI 加密失败时显式报错，不落明文。"""
    try:
        return save_asr_settings(db, payload)
    except ApiKeyEncryptionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/asr/test", response_model=AsrSettingsTestResult)
async def test_asr_settings(
    payload: AsrSettings, db: Session = Depends(get_db)
) -> AsrSettingsTestResult:
    """用表单当前值探测一次上游（发一段静音），不要求先保存。"""
    stored = get_asr_runtime_settings(db)
    base_url = payload.base_url or stored.base_url
    model = payload.model or stored.model
    protocol = _resolve_protocol(payload, stored)
    api_key = _resolve_key(db, payload, protocol)
    if not (base_url and model and api_key):
        return AsrSettingsTestResult(ok=False, message="请先填写语音服务地址、模型与 Key")
    ok, message, latency_ms = await probe_asr_connection(
        base_url=base_url, api_key=api_key, model=model, protocol=protocol
    )
    return AsrSettingsTestResult(ok=ok, latency_ms=latency_ms, message=message)


@router.post("/settings/asr/models", response_model=AsrModelsResult)
async def list_asr_models(
    payload: AsrModelsRequest, db: Session = Depends(get_db)
) -> AsrModelsResult:
    """拉取上游模型目录；失败返回空列表（界面退回手填，不打断保存与测试）。

    与「测试连接」共用 :func:`_resolve_key`：两处对"沿用旧 Key"的判据必须一致。
    """
    stored = get_asr_runtime_settings(db)
    base_url = payload.base_url or stored.base_url
    protocol = _resolve_protocol(payload, stored)
    api_key = _resolve_key(db, payload, protocol)
    if not (base_url and api_key):
        return AsrModelsResult(models=[])
    models = await fetch_asr_models(base_url=base_url, api_key=api_key, protocol=protocol)
    return AsrModelsResult(models=models)


@router.get("/transcribe/status", response_model=AsrStatus)
def read_transcribe_status(db: Session = Depends(get_db)) -> AsrStatus:
    """麦克风组件启动前的探测：是否可用、音频会发到哪台主机、服务端限额。"""
    runtime = get_asr_runtime_settings(db)
    configured = is_asr_configured(runtime)
    return AsrStatus(
        configured=configured,
        provider_host=provider_host(runtime.base_url) if configured else "",
        model=runtime.model if configured else "",
        protocol=runtime.protocol,
        max_seconds=MAX_AUDIO_SECONDS,
        max_bytes=MAX_AUDIO_BYTES,
    )


@router.post("/transcribe", response_model=TranscribeResult)
async def transcribe(
    file: UploadFile = File(...),
    duration_ms: int | None = Form(default=None),
    language: str = Form(default="zh"),
    db: Session = Depends(get_db),
) -> TranscribeResult:
    """把一段录音转成文字。

    ``duration_ms`` 由前端按真实录音时长传入；服务端只做上限校验，不解析音频内容。
    请求体按落库的 ``protocol`` 分派（whisper 式 multipart / Qwen-ASR 的 chat）。
    """
    started = time.perf_counter()
    runtime = get_asr_runtime_settings(db)
    host = provider_host(runtime.base_url)
    if not is_asr_configured(runtime):
        raise HTTPException(status_code=409, detail=_NOT_CONFIGURED_DETAIL)
    if not _LANGUAGE_PATTERN.fullmatch(language or ""):
        raise HTTPException(status_code=422, detail=_BAD_LANGUAGE_DETAIL)
    if duration_ms is not None:
        if duration_ms < 0:
            raise HTTPException(status_code=422, detail=_BAD_DURATION_DETAIL)
        if duration_ms > MAX_AUDIO_MS:
            raise HTTPException(status_code=413, detail=_TOO_LONG_DETAIL)

    raw = await file.read(MAX_AUDIO_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=422, detail=_EMPTY_AUDIO_DETAIL)
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail=_TOO_LARGE_DETAIL)

    content_type = (file.content_type or "audio/webm").strip()
    try:
        text = await transcribe_audio(
            base_url=runtime.base_url,
            api_key=runtime.api_key,
            model=runtime.model,
            content=raw,
            content_type=content_type,
            language=language,
            protocol=runtime.protocol,
        )
    except AsrError as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        # 只记状态/字节/耗时/主机：音频内容、文件名、Key 一律不落日志。
        logger.warning(
            "asr status=error kind=%s bytes=%d ms=%d host=%s",
            exc.kind,
            len(raw),
            elapsed_ms,
            host,
        )
        raise HTTPException(
            status_code=_ASR_ERROR_STATUS.get(exc.kind, 502), detail=str(exc)
        ) from exc

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.info("asr status=ok bytes=%d ms=%d host=%s", len(raw), elapsed_ms, host)
    return TranscribeResult(text=text, provider_host=host)
