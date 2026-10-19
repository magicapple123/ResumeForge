"""全局模型 profiles 接口（R21）。

单独成文件是为了守住 500 行预算：`api/settings.py` 还承载数据集、搜索、助手、
导出位置等大量端点。这里只做 HTTP 层，读写一律走 `services/global_settings`。

所有写操作都只允许运行后端的本机客户端（与密钥查看同一套回环校验）。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from ..schemas.setting import LLMConfig
from ..services.api_key_crypto import ApiKeyEncryptionError

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _guard(request: Request) -> None:
    # 延迟导入：本模块在 application.py 注册，模块级互相导入会形成环。
    from .settings import _is_loopback_request

    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="模型配置只能在运行后端的本机修改")


def _profile_config(payload: dict) -> LLMConfig:
    """校验 ``config`` 并把顶层 ``api_key`` 合并进去（空 = 保留，由服务层处理）。"""
    config = LLMConfig.model_validate(payload.get("config") or {})
    incoming_key = str(payload.get("api_key", "") or "")
    if incoming_key and incoming_key != "__clear__":
        config = config.model_copy(update={"api_key": incoming_key})
    return config


@router.put("/global-llm")
def write_global_llm_settings(payload: dict, request: Request) -> dict:
    """保存全局模型配置：更新**当前 active profile**，对所有数据集生效。

    ``api_key`` 为空时**保留**原来的密钥（与"重新保存表单不要我重填密钥"一致）；
    传 ``"__clear__"`` 才显式清空。
    """
    from ..services.global_settings import (
        global_llm_summary,
        read_global_llm,
        write_global_llm,
    )

    _guard(request)
    try:
        config = LLMConfig.model_validate(payload.get("config") or {})
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail="配置字段不合法") from exc

    incoming_key = str(payload.get("api_key", "") or "")
    if incoming_key == "__clear__":
        config = config.model_copy(update={"api_key": ""})
    elif not incoming_key:
        existing = read_global_llm()
        if existing is not None:
            config = config.model_copy(update={"api_key": existing.config.api_key})
    else:
        config = config.model_copy(update={"api_key": incoming_key})

    try:
        write_global_llm(config, enabled=bool(payload.get("enabled", True)))
    except ApiKeyEncryptionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return global_llm_summary()


@router.post("/global-llm/activate")
def activate_global_llm_profile(payload: dict, request: Request) -> dict:
    """切换当前生效的全局模型 profile。"""
    from ..services.global_settings import activate_profile

    _guard(request)
    profile_id = str(payload.get("id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=400, detail="缺少 profile id")
    try:
        return activate_profile(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="配置不存在或已被删除") from exc


@router.post("/global-llm/profiles")
def create_global_llm_profile(payload: dict, request: Request) -> dict:
    """新建一个全局模型 profile（可有多套，页头切换）。"""
    from ..services.global_settings import create_profile

    _guard(request)
    try:
        config = _profile_config(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail="配置字段不合法") from exc
    try:
        return create_profile(str(payload.get("name") or ""), config, payload.get("models"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ApiKeyEncryptionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.put("/global-llm/profiles/{profile_id}")
def update_global_llm_profile(profile_id: str, payload: dict, request: Request) -> dict:
    """更新 profile；``api_key`` 空 = 保留原密钥，``"__clear__"`` = 清空。"""
    from ..services.global_settings import update_profile

    _guard(request)
    name = payload.get("name") if "name" in payload else None
    models = payload.get("models") if "models" in payload else None
    config: LLMConfig | None = None
    if "config" in payload:
        try:
            config = _profile_config(payload)
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail="配置字段不合法") from exc
    if name is None and config is None and models is None:
        raise HTTPException(status_code=400, detail="没有要更新的字段")
    try:
        return update_profile(
            profile_id,
            name=str(name) if name is not None else None,
            config=config,
            models=models,
            clear_api_key=str(payload.get("api_key", "") or "") == "__clear__",
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="配置不存在或已被删除") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ApiKeyEncryptionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/global-llm/profiles/{profile_id}")
def remove_global_llm_profile(profile_id: str, request: Request) -> dict:
    """删除 profile 并返回新的摘要（前端要立刻拿到剩余列表）。"""
    from ..services.global_settings import delete_profile

    _guard(request)
    try:
        return delete_profile(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="配置不存在或已被删除") from exc


@router.delete("/global-llm", status_code=204)
def remove_global_llm_settings(request: Request) -> None:
    """清除全局配置：各数据集回到自己那份。"""
    from ..services.global_settings import clear_global_llm

    _guard(request)
    clear_global_llm()


@router.get("/global-llm")
def read_global_llm_settings() -> dict:
    """全局模型配置摘要（R21）：不返回密钥，只说有没有、开着没、哪套在生效。"""
    from ..services.global_settings import global_llm_summary

    return global_llm_summary()


@router.get("/global-theme")
def read_global_theme() -> dict:
    """跨数据集/浏览器的主题偏好；没存过返回 null，由前端本地值兜底。"""
    from ..services.global_settings import read_theme

    return {"theme": read_theme()}


@router.put("/global-theme")
def write_global_theme(payload: dict, request: Request) -> dict:
    """保存主题到 `global_settings.json` 顶层；非法值 400。"""
    from ..services.global_settings import write_theme

    _guard(request)
    mode = payload.get("theme")
    try:
        write_theme(str(mode))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"theme": str(mode)}
