# SPDX-License-Identifier: Apache-2.0
"""把本次生成请求解析成冻结的场景上下文快照（A1/A5，契约 §2.5/§6）。

三条硬约束，改动前先读：

1. **只读**：解析不写任何业务数据（不产生场景、不碰简历、不修改目录）；在途任务只读
   创建时冻结的快照，不重新查当前场景。
2. **显式引用**：保存场景按 id + `expected_revision` 引用，内置场景按 key + 
   `catalog_version` 引用；存在、未归档、版本匹配才解析，否则抛
   :class:`CareerContextError`（400 参数 / 404 不存在 / 409 状态或版本冲突）。
   跨数据集引用在各自库里天然是"不存在"，不自动落到别的场景。
3. **默认不外发就业状态**：`resolved_dimensions` 里是否出现 `employment_status` 只由
   **请求**的 `include_employment_status` 决定；保存配置里的同名字段只是偏好。
   任何情况下快照都不含姓名、联系方式、证号、家庭或健康信息。

哈希口径：`context_sha256` 对除 `captured_at` / `context_sha256` 之外的全部语义字段做
`json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)` 后 sha256；
时间戳与展示无关字段不参与，所以同一语义输入得到同一 hash（计划 §7.4）。
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ...schemas.career_scenario import (
    CAREER_SCENARIO_ARCHIVED,
    CAREER_SCENARIO_CATALOG_VERSION_CONFLICT,
    CAREER_SCENARIO_CONFIG_INVALID,
    CAREER_SCENARIO_NOT_FOUND,
    CAREER_SCENARIO_PRESET_NOT_FOUND,
    CAREER_SCENARIO_REVISION_CONFLICT,
    CAREER_SCENARIO_SCHEMA_UNSUPPORTED,
    SCENARIO_SCHEMA_VERSION,
    CareerScenarioConfig,
)
from ...schemas.generation_context import (
    SNAPSHOT_SCHEMA_VERSION,
    CareerContextRequest,
    GenerationContextSnapshot,
)
from . import catalog, store
from .guidance import derived_guidance, merge_guidance

logger = logging.getLogger(__name__)

RESOLVER_VERSION = "1"
PROMPT_FRAGMENT_VERSION = "1"

# 允许进入 resolved_dimensions 的维度键。employment_status 刻意不在此表：
# 只有披露允许时才单独加入，默认连键都不出现（契约 §2.5）。
DIMENSION_KEYS: tuple[str, ...] = (
    "career_stage",
    "purpose",
    "target_industries",
    "target_function",
    "cooperation_form",
    "content_language",
    "work_region",
    "preferred_sections",
    "expression_preferences",
)
_LIST_DIMENSIONS = frozenset({"target_industries", "preferred_sections"})
_DEFAULT_VALUES = {
    "career_stage": "unset",
    "purpose": "general",
    "cooperation_form": "unset",
    "content_language": "unset",
}
class CareerContextError(Exception):
    """解析引用失败：API/生成入口据此返回可解释错误（不创建成功任务）。"""

    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str,
        *,
        current_revision: int | None = None,
    ) -> None:
        super().__init__(f"{code}: {detail}")
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.current_revision = current_revision

    def to_response(self) -> JSONResponse:
        """转成 `{"detail", "code"}` 响应（冲突时附库里当前 revision）。"""
        content: dict[str, Any] = {"detail": self.detail, "code": self.code}
        if self.current_revision is not None:
            content["revision"] = self.current_revision
        return JSONResponse(status_code=self.status_code, content=content)


def resolve_context(
    db: Session, request: CareerContextRequest | None
) -> GenerationContextSnapshot | None:
    """解析本次生成的场景引用；`request is None` 时返回 None 且不做任何读写。

    只读数据库：调用方（生成入口）负责把返回的快照写进 task/record。
    """
    if request is None:
        return None
    if request.preset_key is not None:
        return _resolve_preset(request)
    return _resolve_saved(db, request)


def context_sha256(snapshot: dict[str, Any]) -> str:
    """规范化语义配置的 sha256；`captured_at` 与既有 hash 字段不参与。"""
    semantic = {
        key: value
        for key, value in snapshot.items()
        if key not in {"captured_at", "context_sha256"}
    }
    canonical = json.dumps(
        semantic, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _resolve_preset(request: CareerContextRequest) -> GenerationContextSnapshot:
    try:
        builtin = catalog.load_catalog()
    except catalog.CatalogError as exc:
        # 目录损坏：明确失败，不猜 / 不静默忽略用户的显式选择（计划 §7.3）。
        raise CareerContextError(503, exc.detail, exc.code) from exc

    preset = builtin.preset(request.preset_key or "")
    if preset is None:
        raise CareerContextError(
            404,
            f"内置场景 {request.preset_key!r} 不存在，请刷新场景目录后重试",
            CAREER_SCENARIO_PRESET_NOT_FOUND,
        )
    if request.catalog_version != builtin.catalog_version:
        raise CareerContextError(
            409,
            "内置场景目录已更新，请刷新后重新选择",
            CAREER_SCENARIO_CATALOG_VERSION_CONFLICT,
        )

    config = _validated_config(preset.config)
    guidance = [*preset.guidance, *derived_guidance(config)]
    payload: dict[str, Any] = {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "scenario_origin": "preset",
        "scenario_id": None,
        "preset_key": preset.key,
        "scenario_revision": None,
        "catalog_version": builtin.catalog_version,
        "display_name": preset.name,
        "resolved_dimensions": _resolved_dimensions(
            config, include_employment_status=request.include_employment_status
        ),
        "approved_guidance": merge_guidance(guidance),
        "disclosure": {
            "include_employment_status": bool(request.include_employment_status)
        },
        "resolver_version": RESOLVER_VERSION,
        "prompt_fragment_version": PROMPT_FRAGMENT_VERSION,
    }
    return _freeze(payload)


def _resolve_saved(db: Session, request: CareerContextRequest) -> GenerationContextSnapshot:
    row = store.get_scenario(db, request.scenario_id or 0)
    if row is None:
        raise CareerContextError(
            404,
            "场景不存在，可能已在其他窗口删除；请刷新后重新选择",
            CAREER_SCENARIO_NOT_FOUND,
        )
    if row.schema_version != SCENARIO_SCHEMA_VERSION:
        raise CareerContextError(
            409,
            f"该场景由更新版本创建（结构版本 {row.schema_version}），当前版本无法解析",
            CAREER_SCENARIO_SCHEMA_UNSUPPORTED,
        )
    if row.archived:
        raise CareerContextError(
            409,
            "场景已归档，取消归档后才能用于生成",
            CAREER_SCENARIO_ARCHIVED,
        )
    if row.revision != request.expected_revision:
        raise CareerContextError(
            409,
            "场景已在其他窗口修改，请刷新后重新选择",
            CAREER_SCENARIO_REVISION_CONFLICT,
            current_revision=row.revision,
        )

    config = _validated_config(row.config, scenario_id=row.id)
    payload: dict[str, Any] = {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "scenario_origin": "saved",
        "scenario_id": row.id,
        "preset_key": None,
        "scenario_revision": row.revision,
        "catalog_version": None,
        "display_name": row.name,
        "resolved_dimensions": _resolved_dimensions(
            config, include_employment_status=request.include_employment_status
        ),
        "approved_guidance": merge_guidance(derived_guidance(config)),
        "disclosure": {
            "include_employment_status": bool(request.include_employment_status)
        },
        "resolver_version": RESOLVER_VERSION,
        "prompt_fragment_version": PROMPT_FRAGMENT_VERSION,
    }
    return _freeze(payload)


def _validated_config(raw: dict[str, Any], *, scenario_id: int | None = None) -> CareerScenarioConfig:
    """配置在写入前已校验；读取侧再校验一次，防止旧数据/手工改库静默降级。"""
    try:
        return CareerScenarioConfig.model_validate(raw)
    except ValidationError as exc:
        where = f"场景 {scenario_id}" if scenario_id is not None else "内置场景"
        # 只记定位与原因，不记 input（可能含就业状态等私密维度值，见计划 §15.3）。
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", ()))
        logger.warning("%s配置无法解析：%s %s", where, location, first.get("msg", ""))
        raise CareerContextError(
            409,
            "场景配置无法解析，请重新保存该场景后再用于生成",
            CAREER_SCENARIO_CONFIG_INVALID,
        ) from exc


def _resolved_dimensions(
    config: CareerScenarioConfig, *, include_employment_status: bool
) -> dict[str, Any]:
    """只保留有意义的维度值；未设置/空值不写进快照（避免"看似下发了一堆默认值"）。"""
    dimensions: dict[str, Any] = {}
    for key in DIMENSION_KEYS:
        value = getattr(config, key)
        if key in _LIST_DIMENSIONS:
            if not value:
                continue
        elif key in _DEFAULT_VALUES:
            if value == _DEFAULT_VALUES[key]:
                continue
        elif not value:
            continue
        dimensions[key] = list(value) if isinstance(value, list) else value
    if include_employment_status and config.employment_status != "unset":
        dimensions["employment_status"] = config.employment_status
    return dimensions


def _freeze(payload: dict[str, Any]) -> GenerationContextSnapshot:
    """补 hash 与时间戳并做最终结构校验。hash 不含 captured_at（时间戳不参与）。"""
    digest = context_sha256(payload)
    frozen = {
        **payload,
        "context_sha256": digest,
        "captured_at": datetime.now(UTC).isoformat(),
    }
    return GenerationContextSnapshot.model_validate(frozen)


__all__ = [
    "DIMENSION_KEYS",
    "PROMPT_FRAGMENT_VERSION",
    "RESOLVER_VERSION",
    "CareerContextError",
    "context_sha256",
    "resolve_context",
]
