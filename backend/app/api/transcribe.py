# SPDX-License-Identifier: Apache-2.0
"""语音听写接口：ASR 配置读写 + 测试连接 + 拉模型列表 + ``POST /api/transcribe``。

为什么配置端点（``/api/settings/asr``）也放在这个文件：本文件归语音线独占，而
``api/settings.py`` 是其它线在看管的写入面。继续往那个 429 行的文件里加会同时带来
行数预算与写入冲突两个风险；ASR 的端点放在一起也更像一套完整能力。

三条硬边界（计划 §6）：

1. **不回显 Key**：读取只返回掩码；PUT 的掩码/空值按"沿用旧 Key"处理（地址或协议变了才清）；
2. **不记录音频**：日志只有 ``status / bytes / ms / host``，不写文件名、内容与 Key；
3. **限额在服务端再拦一道**：上限**按协议取值**（``asr_deepseek.audio_limits_for``），
   前端能绕过，后端不能信。``deepseek`` 是 120 秒 / 8 MiB（它不支持流式，所以 120 秒是
   硬上限）；``openai`` / ``dashscope`` 维持 180 秒 / 10 MB。

上游错误按"让用户知道下一步怎么办"分类：鉴权失败指向 Key、404 指向地址前缀、400 带上
上游原话（模型名打错、音频被判无效、格式不支持只能从原话看出）、413 指向时长、超时与空结果
各有独立文案——前端据此出互不相同的提示。

「沿用旧 Key」的解析只写一份（``_resolve_key``）：测试连接、拉模型列表、保存三处判据必须
逐字一致，否则会出现"测试能用、拉模型说没 Key"这种谁都说不清的分歧。
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..runtime.blocking import run_sync
from ..schemas.asr import (
    MAX_AUDIO_BYTES,
    MAX_AUDIO_SECONDS,
    AsrModelsRequest,
    AsrModelsResult,
    AsrProfileIn,
    AsrProfilesOut,
    AsrProfileTestRequest,
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
from ..services.asr_deepseek import PROTOCOL as DEEPSEEK_PROTOCOL
from ..services.asr_deepseek import AudioLimits, audio_limits_for
from ..services.asr_profiles import (
    AsrProfileError,
    AsrProfileNameConflict,
    AsrProfileNotFound,
    activate_asr_profile,
    clear_asr_profile_key,
    delete_asr_profile,
    list_asr_profiles,
    resolve_probe_target,
    save_asr_profile,
)
from ..services.asr_settings import (
    CLEAR_API_KEY,
    binding_changed,
    get_asr_runtime_settings,
    get_asr_settings,
    is_asr_configured,
    migrate_legacy_asr_once,
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


def _limits_for(protocol: AsrProtocol, limits: AudioLimits) -> tuple[int, int]:
    """``(max_seconds, max_bytes)``：这一档真正生效的上限。

    ``openai`` / ``dashscope`` 走本模块的常量（= 既有 180 秒 / 10 MB，行为不变）；
    ``deepseek`` 用它自己的硬上限（120 秒 / 8 MiB）——**不是**把 180 砍成 120 的"顺手
    收紧"，而是上游不支持流式、单请求就只收 120 秒。
    """
    if protocol == DEEPSEEK_PROTOCOL:
        return limits.seconds, limits.bytes
    return MAX_AUDIO_SECONDS, MAX_AUDIO_BYTES


def _too_large_detail(protocol: AsrProtocol, max_bytes: int) -> str:
    """超大文案：老协议保持原句（既有用例与用户认知都对着它），新协议按真实上限写。"""
    if protocol == DEEPSEEK_PROTOCOL:
        return f"音频超过 {max_bytes // (1024 * 1024)} MB，无法转写"
    return _TOO_LARGE_DETAIL


def _too_long_detail(protocol: AsrProtocol, max_seconds: int) -> str:
    """超长文案：DeepSeek 的 120 秒不是整分钟，用秒写才不会让人以为能录到 119.99 秒。"""
    if protocol == DEEPSEEK_PROTOCOL:
        return f"单段录音最长 {max_seconds} 秒，请缩短后重试"
    return _TOO_LONG_DETAIL

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


def _ensure_asr_migrated(db: Session) -> None:
    """设置入口先跑一次旧数据迁移（幂等；失败只记日志，不让页面 500）。"""
    migrate_legacy_asr_once(db)


@contextmanager
def _profile_errors() -> Iterator[None]:
    """把服务层的配置异常翻成对得上的 HTTP 状态（重名 409 / 不存在 404 / 其余 400）。"""
    try:
        yield
    except AsrProfileNameConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AsrProfileNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (AsrProfileError, ApiKeyEncryptionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


def _prepare_settings_probe(
    db: Session, payload: AsrSettings
) -> AsrSettings | AsrSettingsTestResult:
    """「测试连接」的**准备段**：跑一次旧数据迁移、合并已存配置、解析出真实 Key。

    整段都碰请求会话，所以在同一个 worker 里做完并归还连接；随后那次探测是一次真发
    音频的远端调用，不该继续占着 SQLite 连接。要素不全时直接把最终结果返回，路由据此
    提前返回（与改造前同一份文案）。
    """
    try:
        _ensure_asr_migrated(db)
        stored = get_asr_runtime_settings(db)
        base_url = payload.base_url or stored.base_url
        model = payload.model or stored.model
        protocol = _resolve_protocol(payload, stored)
        api_key = _resolve_key(db, payload, protocol)
        candidate = AsrSettings(base_url=base_url, model=model, api_key=api_key, protocol=protocol)
        if not is_asr_configured(candidate):
            # deepseek 没有 model 参数：向它要模型名会让用户永远填不完这一格。
            message = (
                "请先填写语音服务地址与 Key"
                if protocol == DEEPSEEK_PROTOCOL
                else "请先填写语音服务地址、模型与 Key"
            )
            return AsrSettingsTestResult(ok=False, message=message)
        return candidate
    finally:
        db.close()


def _prepare_models_probe(db: Session, payload: AsrModelsRequest) -> AsrSettings | None:
    """「拉模型列表」的**准备段**：解析地址/协议/Key；缺一即返回 ``None``（空列表）。"""
    try:
        stored = get_asr_runtime_settings(db)
        base_url = payload.base_url or stored.base_url
        protocol = _resolve_protocol(payload, stored)
        api_key = _resolve_key(db, payload, protocol)
        if not (base_url and api_key):
            return None
        return AsrSettings(base_url=base_url, api_key=api_key, protocol=protocol)
    finally:
        db.close()


def _prepare_profile_probe(
    db: Session, profile_id: str, payload: AsrProfileTestRequest
) -> AsrSettings | None:
    """命名配置「测试连接」的**准备段**：迁移 + 解析「已存 Key + 草稿覆盖」。"""
    try:
        _ensure_asr_migrated(db)
        with _profile_errors():
            return resolve_probe_target(profile_id, payload)
    finally:
        db.close()


def _load_asr_runtime(db: Session) -> AsrSettings:
    """转写入口的**准备段**：读出这一档真正生效的运行时配置，然后归还连接。"""
    try:
        return get_asr_runtime_settings(db)
    finally:
        db.close()


def _record_asr_usage(db: Session, seconds: float, *, source: str, host: str) -> None:
    """转写入口的**收尾段**：记一条非 token 用量账（旁路，失败只记日志）。"""
    from ..services.usage_counters import KIND_ASR, record_external_usage

    try:
        record_external_usage(KIND_ASR, seconds, source=source, db=db)
    except Exception:  # noqa: BLE001 - 计量是旁路，不能让已成功的转写变成失败
        logger.warning("ASR 用量记录失败 host=%s", host, exc_info=True)


@router.get("/settings/asr", response_model=AsrSettingsOut)
def read_asr_settings(db: Session = Depends(get_db)) -> AsrSettingsOut:
    """读取语音服务配置：``api_key`` 只可能是掩码或空串。"""
    _ensure_asr_migrated(db)
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
    prepared = await run_sync(_prepare_settings_probe, db, payload)
    if isinstance(prepared, AsrSettingsTestResult):
        return prepared
    ok, message, latency_ms = await probe_asr_connection(
        base_url=prepared.base_url,
        api_key=prepared.api_key,
        model=prepared.model,
        protocol=prepared.protocol,
    )
    return AsrSettingsTestResult(ok=ok, latency_ms=latency_ms, message=message)


@router.post("/settings/asr/models", response_model=AsrModelsResult)
async def list_asr_models(
    payload: AsrModelsRequest, db: Session = Depends(get_db)
) -> AsrModelsResult:
    """拉取上游模型目录；失败返回空列表（界面退回手填，不打断保存与测试）。

    与「测试连接」共用 :func:`_resolve_key`：两处对"沿用旧 Key"的判据必须一致。
    """
    target = await run_sync(_prepare_models_probe, db, payload)
    if target is None:
        return AsrModelsResult(models=[])
    models = await fetch_asr_models(
        base_url=target.base_url, api_key=target.api_key, protocol=target.protocol
    )
    return AsrModelsResult(models=models)


@router.get("/settings/asr/profiles", response_model=AsrProfilesOut)
def read_asr_profiles(db: Session = Depends(get_db)) -> AsrProfilesOut:
    """命名配置列表（脱敏）+ 生效项；首次读取时把当前数据集的旧配置导入一次。"""
    _ensure_asr_migrated(db)
    return list_asr_profiles()


@router.post("/settings/asr/profiles", response_model=AsrProfilesOut)
def write_asr_profile(payload: AsrProfileIn, db: Session = Depends(get_db)) -> AsrProfilesOut:
    """新建（无 id）或按 id 更新一条配置；**新建不自动设为生效**。"""
    _ensure_asr_migrated(db)
    with _profile_errors():
        return save_asr_profile(payload)


@router.delete("/settings/asr/profiles/{profile_id}", response_model=AsrProfilesOut)
def remove_asr_profile(profile_id: str, db: Session = Depends(get_db)) -> AsrProfilesOut:
    """删除一条；删的是生效项时自动切到剩下的第一条，删光则语音输入不可用。"""
    _ensure_asr_migrated(db)
    with _profile_errors():
        return delete_asr_profile(profile_id)


@router.post("/settings/asr/profiles/{profile_id}/activate", response_model=AsrProfilesOut)
def activate_asr_profile_endpoint(
    profile_id: str, db: Session = Depends(get_db)
) -> AsrProfilesOut:
    """设为「使用中」：只校验三要素齐全并写 active_profile_id，**不探测网络**。"""
    _ensure_asr_migrated(db)
    with _profile_errors():
        return activate_asr_profile(profile_id)


@router.post("/settings/asr/profiles/{profile_id}/clear-key", response_model=AsrProfilesOut)
def clear_asr_profile_key_endpoint(
    profile_id: str, db: Session = Depends(get_db)
) -> AsrProfilesOut:
    """只清这一条的 Key（其它配置不受影响）。"""
    _ensure_asr_migrated(db)
    with _profile_errors():
        return clear_asr_profile_key(profile_id)


@router.post("/settings/asr/profiles/{profile_id}/test", response_model=AsrSettingsTestResult)
async def test_asr_profile(
    profile_id: str, payload: AsrProfileTestRequest, db: Session = Depends(get_db)
) -> AsrSettingsTestResult:
    """用「该条已存 Key + 草稿覆盖」探测一次上游，**不落盘**。

    ``profile_id`` 允许传 ``new``（新建弹窗里还没有 id）：此时不读取任何已存 Key，
    避免"新建时留空却测通了上一条配置的 Key"这种误判。
    """
    target = await run_sync(_prepare_profile_probe, db, profile_id, payload)
    if target is None:
        return AsrSettingsTestResult(ok=False, message="请先填写语音服务地址、模型与 Key")
    ok, message, latency_ms = await probe_asr_connection(
        base_url=target.base_url,
        api_key=target.api_key,
        model=target.model,
        protocol=target.protocol,
    )
    return AsrSettingsTestResult(ok=ok, latency_ms=latency_ms, message=message)


@router.get("/transcribe/status", response_model=AsrStatus)
def read_transcribe_status(db: Session = Depends(get_db)) -> AsrStatus:
    """麦克风组件启动前的探测：是否可用、音频会发到哪台主机、服务端限额。

    ``max_seconds`` / ``max_bytes`` **按当前协议给**（不是写死 180 / 10 MB）：前端用它
    决定录音上限定到哪里，并在 ``deepseek`` 时说明为什么只有 120 秒。三套数字
    （前端滑块 60–300、服务端 180 秒、DeepSeek 120 秒）只在这里收敛成一套。
    """
    runtime = get_asr_runtime_settings(db)
    configured = is_asr_configured(runtime)
    limits = audio_limits_for(runtime.protocol)
    return AsrStatus(
        configured=configured,
        provider_host=provider_host(runtime.base_url) if configured else "",
        model=runtime.model if configured else "",
        protocol=runtime.protocol,
        max_seconds=limits.seconds,
        max_bytes=limits.bytes,
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
    请求体按落库的 ``protocol`` 分派（whisper 式 multipart / Qwen-ASR 的 chat /
    DeepSeek 的 ``/tools/asr``）。上限也按协议取：``deepseek`` 是 120 秒 / 8 MiB。
    """
    started = time.perf_counter()
    runtime = await run_sync(_load_asr_runtime, db)
    host = provider_host(runtime.base_url)
    if not is_asr_configured(runtime):
        raise HTTPException(status_code=409, detail=_NOT_CONFIGURED_DETAIL)
    if not _LANGUAGE_PATTERN.fullmatch(language or ""):
        raise HTTPException(status_code=422, detail=_BAD_LANGUAGE_DETAIL)
    limits = audio_limits_for(runtime.protocol)
    max_seconds, max_bytes = _limits_for(runtime.protocol, limits)
    if duration_ms is not None:
        if duration_ms < 0:
            raise HTTPException(status_code=422, detail=_BAD_DURATION_DETAIL)
        if duration_ms > max_seconds * 1000:
            raise HTTPException(
                status_code=413, detail=_too_long_detail(runtime.protocol, max_seconds)
            )

    raw = await file.read(max_bytes + 1)
    if not raw:
        raise HTTPException(status_code=422, detail=_EMPTY_AUDIO_DETAIL)
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=413, detail=_too_large_detail(runtime.protocol, max_bytes)
        )

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
            "asr status=error kind=%s bytes=%d ms=%d duration_ms=%d host=%s",
            exc.kind,
            len(raw),
            elapsed_ms,
            duration_ms if duration_ms is not None else -1,
            host,
        )
        raise HTTPException(
            status_code=_ASR_ERROR_STATUS.get(exc.kind, 502), detail=str(exc)
        ) from exc

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    # 计量（T16）：只记**音频秒数**，不折算金额。用前端报的 duration_ms 除以 1000
    # （那是真实录音时长，也是上限校验的同一个数）；没报就不记——用字节数反推时长
    # 会随编码格式漂移（1.5 KB 的 opus 只有 0.25 秒），宁可少一条也不写错账。
    # 落账同样是一次写库，交给 worker：转写刚回来，事件循环要先能接下一个请求。
    if duration_ms:
        await run_sync(
            _record_asr_usage,
            db,
            duration_ms / 1000,
            source=f"transcribe:{host}",
            host=host,
        )
    # duration_ms 是"录音被掐断"的唯一直接证据（需求 #8：之前只能拿 bytes 反推时长，
    # 1.5 KB 的 opus 折算 0.25 秒才定位到"用户连点两下"）。缺省记 -1，与"0 毫秒"区分开。
    logged_duration = duration_ms if duration_ms is not None else -1
    logger.info(
        "asr status=ok bytes=%d ms=%d duration_ms=%d host=%s",
        len(raw),
        elapsed_ms,
        logged_duration,
        host,
    )
    return TranscribeResult(text=text, provider_host=host)
