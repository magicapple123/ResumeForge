# SPDX-License-Identifier: Apache-2.0
"""设置「恢复默认」与快照接口（问题清单 I-10）。

独立成文件的原因与路由挂载方式见 ``register_settings_reset_routes``。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import settings_defaults
from ..services.settings_defaults import SettingsSnapshotError

_RESET_BATCH_LIMIT = 128


class ResetRequest(BaseModel):
    """恢复默认的入参：``scope`` 与 ``keys`` 二选一（都给或都不给 → 422）。"""

    scope: str | None = Field(default=None, max_length=32)
    keys: list[str] | None = Field(default=None, max_length=_RESET_BATCH_LIMIT)


class ResetEntryOut(BaseModel):
    key: str
    scope: str
    before: Any = None
    after: Any = None


class ResetResultOut(BaseModel):
    reset: list[ResetEntryOut] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    dataset_scoped: bool = True


class ResetTargetOut(BaseModel):
    key: str
    scope: str
    kind: str
    storage: str
    default: Any = None
    current: Any = None
    is_default: bool = False


class ResetTargetsOut(BaseModel):
    scopes: list[str] = Field(default_factory=list)
    entries: list[ResetTargetOut] = Field(default_factory=list)


def register_settings_reset_routes(router: APIRouter) -> None:
    """把四条路由挂到既有的 ``/api/settings`` router 上。

    - ``GET /reset-targets``：可重置项 + 当前值 + 出厂值（密钥键不在其中）；
    - ``POST /reset``：按 ``keys`` 或 ``scope`` 恢复默认，校验全部前置，非法 → 422 零写入；
    - ``GET /snapshot``：导出快照，**不含任何密钥**；
    - ``POST /snapshot``：导入快照，**先整份校验后写入**（ADR-0005）。
    """

    @router.get("/reset-targets", response_model=ResetTargetsOut)
    def read_reset_targets(
        scope: str | None = Query(default=None, max_length=32),
        db: Session = Depends(get_db),
    ):
        """列出可重置项（含当前值与出厂值）；密钥键不在列表里。"""
        if scope is not None and scope not in settings_defaults.scope_names():
            raise HTTPException(status_code=422, detail=f"未知的设置分组：{scope}")
        return {
            "scopes": settings_defaults.scope_names(),
            "entries": settings_defaults.reset_targets(db, scope),
        }

    @router.post("/reset", response_model=ResetResultOut)
    def reset_settings(payload: ResetRequest, db: Session = Depends(get_db)):
        """恢复默认：``{"keys": [...]}`` 或 ``{"scope": "model"}``。

        校验在写入之前全部完成：未知键、密钥类键、未知分组一律 422，且库里一行都不动。
        """
        has_scope = payload.scope is not None
        has_keys = payload.keys is not None
        if has_scope == has_keys:
            raise HTTPException(status_code=422, detail="scope 与 keys 必须二选一")
        if has_scope:
            scope = str(payload.scope)
            if scope not in settings_defaults.scope_names():
                raise HTTPException(status_code=422, detail=f"未知的设置分组：{scope}")
            targets = [entry.key for entry in settings_defaults.resettable_entries(scope)]
        else:
            requested = list(payload.keys or [])
            if not requested:
                raise HTTPException(status_code=422, detail="keys 不能为空")
            targets, rejected = settings_defaults.split_resettable(requested)
            if rejected:
                raise HTTPException(
                    status_code=422,
                    detail="不可重置的设置项：" + "、".join(sorted(rejected)),
                )
        result = settings_defaults.reset_keys(db, targets)
        return {**result, "dataset_scoped": True}

    @router.get("/snapshot")
    def export_settings_snapshot(db: Session = Depends(get_db)) -> dict[str, Any]:
        """导出设置快照（**不含密钥**）。导入端见下一条。"""
        return settings_defaults.build_snapshot(db)

    @router.post("/snapshot")
    def import_settings_snapshot(
        payload: dict[str, Any] = Body(default_factory=dict),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        """从快照恢复：**先校验后写入**。版本过新、含白名单外的键、类型不对 → 422。"""
        try:
            return settings_defaults.apply_snapshot(db, payload)
        except SettingsSnapshotError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


__all__ = ["register_settings_reset_routes"]
