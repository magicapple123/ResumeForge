# SPDX-License-Identifier: Apache-2.0
"""`/api/settings/llm*` 的全部端点（C）：全局唯一的大模型配置。

R21 曾经并存两套东西：数据集级的「大模型 API 配置」与独立的「全局模型」profiles
（外加页头选择器）。本模块把它们合回一处——**保存即全局生效**，每条记录就是原模块
里的"已保存配置记录"，「使用中」= `active_profile_id`。

端点与语义：

======================  ============================================================
GET    /llm             生效配置（全局优先；没有全局时回退数据集旧配置并标 scope=dataset）
PUT    /llm             保存为生效记录（同时双写一份数据集快照作为备份/回退）
GET    /llm/records     全部记录（首次调用触发从数据集的一次性迁移）
POST   /llm/records     按名称 upsert 一条记录
DELETE /llm/records/{id} 删除记录
POST   /llm/records/{id}/activate  设为「使用中」
POST   /llm/api-key/reveal         本机查看当前密钥（不缓存）
======================  ============================================================

`/llm/models`、`/llm/test`、`/llm/thinking/check` 仍留在 `api/settings.py`：它们只做
"拿一份配置去探测服务商"，不参与配置存储，搬过来只会让本文件超预算。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.setting import (
    LLMApiKeyRevealResult,
    LLMConfig,
    LLMConfigOut,
    LLMGlobalRecordOut,
)
from ..services.api_key_crypto import ApiKeyEncryptionError
from ..services.api_key_session import get_session_key
from ..services.global_llm_profiles import (
    DEFAULT_RECORD_NAME,
    activate_profile,
    delete_record,
    list_records,
    migrate_from_dataset_once,
    read_global_llm,
    read_record_config,
    upsert_record,
    write_global_llm,
)
from ..services.llm_key_refs import API_KEY_MASK, PROFILE_API_KEY_PREFIX
from ..services.settings_service import (
    _strip_session_key,
    get_dataset_llm_config,
    get_llm_config,
    mask_llm_config,
    resolve_llm_config_api_key,
    save_llm_config,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _normalized_url(value: str) -> str:
    return (value or "").strip().rstrip("/")


def _guard_loopback(request: Request, detail: str = "模型配置只能在运行后端的本机修改") -> None:
    """密钥查看/写入只允许本机（与旧端点一致；局域网访问不该能改模型配置）。"""
    from .settings import _is_loopback_request

    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail=detail)


def _masked_global(config: LLMConfig, record_id: str, *, session_key: bool = False) -> LLMConfig:
    """全局配置的密钥一律换成引用：前端回传后仍能定位到同一条记录。

    会话密钥例外：它不属于任何记录（记录里存的是空串），只能回 ``********``；
    回记录引用会让前端下次写回时从记录里读到空密钥，误以为"密钥没了"。
    """
    if session_key:
        key = API_KEY_MASK if config.api_key else ""
    else:
        key = PROFILE_API_KEY_PREFIX + record_id if config.api_key else ""
    return config.model_copy(update={"api_key": key})


def _record_out(item: dict) -> LLMGlobalRecordOut:
    """记录对外的形态：附带"名字是否仍是内置默认名"，供界面翻译默认名。"""
    record = LLMGlobalRecordOut.model_validate(item)
    record.name_is_default = record.name == DEFAULT_RECORD_NAME
    return record


def _out_from_global() -> LLMConfigOut | None:
    """全局记录的对外形态；会话密钥只在内存里补上（绝不落盘、也不进响应本体）。"""
    global_llm = read_global_llm()
    if global_llm is None or not (global_llm.config.base_url and global_llm.config.model):
        return None
    config = global_llm.config
    session_key = get_session_key()
    if session_key:
        config = config.model_copy(update={"api_key": session_key})
    masked = _masked_global(config, global_llm.profile_id, session_key=bool(session_key))
    return LLMConfigOut(
        **masked.model_dump(),
        scope="global",
        record_id=global_llm.profile_id,
        record_name=global_llm.name,
    )


@router.get("/llm", response_model=LLMConfigOut)
def read_llm_config(db: Session = Depends(get_db)) -> LLMConfigOut:
    """读取**生效**配置：全局记录优先；没有全局时回退数据集旧配置。"""
    global_out = _out_from_global()
    if global_out is not None:
        return global_out
    masked = mask_llm_config(db, get_dataset_llm_config(db))
    return LLMConfigOut(**masked.model_dump(), scope="dataset")


@router.put("/llm", response_model=LLMConfigOut)
def write_llm_config(payload: LLMConfig, db: Session = Depends(get_db)) -> LLMConfigOut:
    """保存为**当前生效**的全局记录，并把同一份配置双写进当前数据集快照。

    双写的理由：`global_settings.json` 不进备份包。用户导出数据集时，至少还能在包内
    保留"当时生效的那份配置"（密钥按原有策略处理）；换机器导入后是回退快照，
    不会因为全局配置没跟过来而完全不能用。

    密钥三条规则（与旧端点一致）：留空 = 保留原密钥；`"__clear__"` = 显式清空；
    其余按真实密钥或引用占位符解析。
    """
    existing = read_global_llm()
    incoming = payload.api_key
    if incoming == "__clear__":
        config = payload.model_copy(update={"api_key": ""})
    elif not incoming:
        keep = (
            existing.config.api_key
            if existing is not None
            and _normalized_url(existing.config.base_url) == _normalized_url(payload.base_url)
            else ""
        )
        config = payload.model_copy(update={"api_key": keep})
    else:
        config = payload
    try:
        resolved = resolve_llm_config_api_key(db, config)
        # 会话密钥绝不落盘：全局文件与数据集快照都只存"去掉会话密钥"的形态；
        # 生成链路读配置时会由 get_llm_config 把内存里的临时密钥补回去。
        stored = _strip_session_key(resolved)
        save_llm_config(db, stored)
        saved = write_global_llm(stored)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ApiKeyEncryptionError as exc:
        # DPAPI 失败：密钥未落盘（服务层在 commit 前抛出），显式告知而不是伪装成功。
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # 响应按"本次解析出来的配置"脱敏：会话密钥场景下用户看到的仍是"已配置"。
    masked = _masked_global(resolved, saved.profile_id, session_key=bool(get_session_key()))
    return LLMConfigOut(
        **masked.model_dump(), scope="global", record_id=saved.profile_id, record_name=saved.name
    )


@router.get("/llm/records", response_model=list[LLMGlobalRecordOut])
def read_llm_records(db: Session = Depends(get_db)) -> list[LLMGlobalRecordOut]:
    """全部记录；首次调用把数据集里的旧记录一次性搬过来（之后不再自动导入）。"""
    migrate_from_dataset_once(db)
    return [_record_out(item) for item in list_records()]


@router.post("/llm/records", response_model=LLMGlobalRecordOut)
def write_llm_record(payload: dict, db: Session = Depends(get_db)) -> LLMGlobalRecordOut:
    """按名称 upsert 一条记录；名称相同即更新，不产生第二条。"""
    try:
        config = LLMConfig.model_validate(
            {key: value for key, value in payload.items() if key in LLMConfig.model_fields}
        )
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail="配置字段不合法") from exc
    name = str(payload.get("name") or "")
    incoming = str(payload.get("api_key", "") or "")
    if incoming == "__clear__":
        config = config.model_copy(update={"api_key": ""})
    elif not incoming:
        previous = read_record_config(name)
        keep = (
            previous.api_key
            if previous is not None
            and _normalized_url(previous.base_url) == _normalized_url(config.base_url)
            else ""
        )
        config = config.model_copy(update={"api_key": keep})
    try:
        resolved = resolve_llm_config_api_key(db, config)
        # 与 PUT /llm 同一条规则：会话密钥只存在于内存，记录里存空串。
        record = upsert_record(name, _strip_session_key(resolved), payload.get("models"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ApiKeyEncryptionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _record_out(record)


@router.delete("/llm/records/{record_id}", status_code=204)
def remove_llm_record(record_id: str) -> None:
    try:
        delete_record(record_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="配置记录不存在或已被删除") from exc


@router.post("/llm/records/{record_id}/activate", response_model=LLMGlobalRecordOut)
def activate_llm_record(record_id: str) -> LLMGlobalRecordOut:
    try:
        activate_profile(record_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="配置记录不存在或已被删除") from exc
    for item in list_records():
        if item.get("id") == record_id:
            return _record_out(item)
    raise HTTPException(status_code=404, detail="配置记录不存在或已被删除")


@router.post("/llm/api-key/reveal", response_model=LLMApiKeyRevealResult)
def reveal_llm_api_key(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> LLMApiKeyRevealResult:
    """仅在用户点击显示时临时返回**生效**配置的密钥，禁止缓存。"""
    _guard_loopback(request, "API Key 只能在运行后端的本机查看")
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    return LLMApiKeyRevealResult(api_key=get_llm_config(db).api_key)


# ---------------------------------------------------------------------------
# 主题偏好（R18）：与 llm 并列存在同一个全局文件里
# ---------------------------------------------------------------------------


@router.get("/global-theme")
def read_global_theme() -> dict:
    """跨数据集/浏览器的主题偏好；没存过返回 null，由前端本地值兜底。"""
    from ..services.global_settings import read_theme

    return {"theme": read_theme()}


@router.put("/global-theme")
def write_global_theme(payload: dict, request: Request) -> dict:
    """保存主题到 `global_settings.json` 顶层；非法值 400。"""
    from ..services.global_settings import write_theme

    _guard_loopback(request)
    mode = payload.get("theme")
    try:
        write_theme(str(mode))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"theme": str(mode)}
