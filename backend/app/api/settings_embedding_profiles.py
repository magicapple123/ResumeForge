# SPDX-License-Identifier: Apache-2.0
"""
语义检索命名配置的端点（清单第 1/16 条）：列表随 /status 下发，这里放写操作。

路由由装配层 application_routers 直接挂载（前缀与父模块相同：/api/settings/embedding），
父模块只在函数内惰性提供 loopback 守卫与状态/校验/切换的薄壳——两个 api 模块之间
只剩单向依赖，不再构成兄弟环。所有错误按服务层的 status_code 翻译：
重名 409、配置不存在 404、名称/上限/激活失败 400。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..services.llm import embedding_activation, embedding_profiles, embedding_profiles_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings/embedding", tags=["settings"])


class ProfileConfigIn(BaseModel):
    """一条命名配置的字段（不含 provider：远程配置固定 openai-http）。"""

    base_url: str = Field(default="", max_length=512)
    model: str = Field(default="", max_length=128)
    api_key: str = Field(default="", max_length=8192)
    batch_size: int = Field(default=25, ge=1, le=2048)
    endpoint_mode: str = Field(default="openai", max_length=16)
    request_url: str = Field(default="", max_length=1024)
    headers: list[dict[str, str]] = Field(default_factory=list)
    body_template: str = Field(default="", max_length=16384)
    response_path: str = Field(default="data[*].embedding", max_length=512)
    allow_private: bool = False


class ProfileIn(BaseModel):
    id: str = Field(default="", max_length=64)
    name: str = Field(default="", max_length=128)
    preset_id: str = Field(default="custom", max_length=32)
    config: ProfileConfigIn = Field(default_factory=ProfileConfigIn)


class ProfileTestIn(BaseModel):
    """编辑态未保存的草稿：空 key 借该条已存 key，绝不跨配置。"""

    config: ProfileConfigIn | None = None


def _core() -> Any:
    """父路由模块（loopback 守卫与状态/校验/切换薄壳）；惰性 import 保持单向依赖。"""
    from . import settings_embedding

    return settings_embedding


def _guard(request: Request) -> None:
    _core()._guard_loopback(request)


def _http_error(exc: Exception) -> HTTPException:
    status = int(getattr(exc, "status_code", 400) or 400)
    return HTTPException(status_code=status, detail=str(exc) or "语义检索配置操作失败")


def _check_template(config: dict[str, Any]) -> None:
    if str(config.get("endpoint_mode") or "openai") != "template":
        return
    try:
        _core()._validate_template(
            str(config.get("body_template") or ""),
            str(config.get("response_path") or "data[*].embedding"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/profiles")
def save_embedding_profile(payload: ProfileIn, request: Request) -> dict[str, Any]:
    """新建或按 id 更新一条命名配置；重名 409（不静默覆盖）。"""
    _guard(request)
    config = payload.config.model_dump()
    _check_template(config)
    try:
        profile = embedding_profiles_store.save_profile(
            profile_id=payload.id.strip(),
            name=payload.name,
            preset_id=payload.preset_id,
            config=config,
        )
    except embedding_profiles.ProfileError as exc:
        raise _http_error(exc) from exc
    payload_out = _core()._status_payload()
    payload_out["profile"] = profile
    return payload_out


@router.delete("/profiles/{profile_id}")
async def delete_embedding_profile(profile_id: str, request: Request) -> dict[str, Any]:
    """删除；删的是生效项时自动激活剩余第一条，没有剩余则停用并清空镜像。"""
    _guard(request)
    try:
        await embedding_profiles_store.delete_profile(profile_id)
    except embedding_profiles.ProfileError as exc:
        raise _http_error(exc) from exc
    return _core()._status_payload()


@router.post("/profiles/{profile_id}/activate")
async def activate_embedding_profile(profile_id: str, request: Request) -> dict[str, Any]:
    """切换 = 激活另一条：先探后写，失败时当前生效项不变（清单 §16.3）。"""
    _guard(request)
    try:
        await embedding_activation.activate_profile(profile_id)
    except embedding_profiles.ProfileError as exc:
        raise _http_error(exc) from exc
    _core()._log_switch("openai-http", "", 0)
    return _core()._status_payload()


@router.post("/profiles/{profile_id}/test")
async def test_embedding_profile(
    profile_id: str, payload: ProfileTestIn, request: Request
) -> dict[str, Any]:
    """用「该条已存 key + 草稿覆盖」探测，不落盘（返回 200 + ok:false 或 4xx 原因）。"""
    _guard(request)
    draft = payload.config.model_dump() if payload.config is not None else None
    try:
        return await embedding_activation.test_profile(profile_id, draft)
    except embedding_profiles.ProfileError as exc:
        raise _http_error(exc) from exc


@router.post("/profiles/{profile_id}/clear-key")
def clear_embedding_profile_key(profile_id: str, request: Request) -> dict[str, Any]:
    """只清这一条的密钥；若它是生效项则一并停用（不删除配置）。"""
    _guard(request)
    try:
        embedding_profiles_store.clear_profile_key(profile_id)
    except embedding_profiles.ProfileError as exc:
        raise _http_error(exc) from exc
    _core()._log_switch("disabled", "", 0)
    return _core()._status_payload()


__all__ = ["router"]
