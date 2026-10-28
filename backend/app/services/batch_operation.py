# SPDX-License-Identifier: Apache-2.0
"""批量操作参数的读写（存 ``app_setting``，不新增表/列）。

两套参数存在同一个 JSON 的两个节点下（``generation`` / ``export``），但**各自独立更新**：
保存生成参数不会碰导出参数，反之亦然。旧版（单份扁平配置）读到时按"两节都未配置"
处理——它本来就没有区分动作，强行猜一份映射只会让用户看到自己没设过的值。
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal, overload

from sqlalchemy.orm import Session

from ..models.profile import utcnow
from ..models.setting import AppSetting
from ..schemas.batch_operation import (
    BatchExportConfig,
    BatchExportConfigOut,
    BatchGenerationConfig,
    BatchGenerationConfigOut,
    BatchOperationConfigOut,
)
from .resume.resume_template_catalog import RESUME_TEMPLATES
from .resume.resume_template_store import custom_template_options

logger = logging.getLogger(__name__)

_KEY = "batch_operation_config"
_SECTION_KEYS = ("generation", "export")
BatchSection = Literal["generation", "export"]


def _read_payload(db: Session) -> dict[str, Any]:
    row = db.get(AppSetting, _KEY)
    if row is None or not row.value:
        return {}
    try:
        data = json.loads(row.value)
    except (json.JSONDecodeError, TypeError, ValueError):
        logger.warning("批量操作参数损坏，已按未配置处理")
        return {}
    if not isinstance(data, dict):
        return {}
    # 只认两节；旧版扁平结构（template / export_format 直接在顶层）视为未配置。
    return {key: data[key] for key in _SECTION_KEYS if isinstance(data.get(key), dict)}


# base_cls / out_cls 是**成对相关**的两个参数（generation 对 BatchGenerationConfigOut、
# export 对 BatchExportConfigOut）：单用联合类型签名会丢掉这份配对关系，pyright 无法在
# 调用点把联合窄化回正确的 Out 类型（reportArgumentType / reportReturnType 就是这么来的）。
# 用 overload 把"哪对进、哪对出"钉在签名上——调用方（read_batch_operation_config /
# _save_section 的两个分支）拿到的是确定的单一类型，不需要再断言。
@overload
def _section_out(
    node: dict[str, Any] | None,
    base_cls: type[BatchGenerationConfig],
    out_cls: type[BatchGenerationConfigOut],
) -> BatchGenerationConfigOut: ...


@overload
def _section_out(
    node: dict[str, Any] | None,
    base_cls: type[BatchExportConfig],
    out_cls: type[BatchExportConfigOut],
) -> BatchExportConfigOut: ...


def _section_out(
    node: dict[str, Any] | None,
    base_cls: type[BatchGenerationConfig] | type[BatchExportConfig],
    out_cls: type[BatchGenerationConfigOut] | type[BatchExportConfigOut],
):
    if not isinstance(node, dict):
        return out_cls(configured=False)
    data = dict(node)
    updated_at = data.pop("updated_at", None)
    try:
        config = base_cls.model_validate(data)
    except (TypeError, ValueError):
        logger.warning("批量操作某一节参数损坏，已按未配置处理")
        return out_cls(configured=False)
    return out_cls(
        **config.model_dump(),
        configured=True,
        updated_at=updated_at if isinstance(updated_at, str) else None,
    )


def read_batch_operation_config(db: Session) -> BatchOperationConfigOut:
    payload = _read_payload(db)
    return BatchOperationConfigOut(
        generation=_section_out(
            payload.get("generation"), BatchGenerationConfig, BatchGenerationConfigOut
        ),
        export=_section_out(payload.get("export"), BatchExportConfig, BatchExportConfigOut),
    )


def _validate_template(db: Session, template: str) -> None:
    # 允许内置模板（含已隐藏但老简历仍在用的 3 套）与用户自制模板；其余名字拒绝，
    # 避免一条写错的参数把之后每一批都静默回落成"经典"。
    allowed = set(RESUME_TEMPLATES)
    allowed.update(str(option.get("name", "")) for option in custom_template_options(db))
    if template not in allowed:
        raise ValueError("这个版式模板不在可选清单里，请重新选择")


# 同 _section_out：写哪一节（section 的字面量值）决定返回哪份 Out——联合签名会丢掉
# 这份对应关系，让两个 save_* 入口拿到联合返回而报 reportReturnType。overload 把
# "generation 进 → generation 出"钉在签名上，入口无需断言。
@overload
def _save_section(
    db: Session,
    section: Literal["generation"],
    config: BatchGenerationConfig,
) -> BatchGenerationConfigOut: ...


@overload
def _save_section(
    db: Session,
    section: Literal["export"],
    config: BatchExportConfig,
) -> BatchExportConfigOut: ...


def _save_section(
    db: Session,
    section: BatchSection,
    config: BatchGenerationConfig | BatchExportConfig,
) -> BatchGenerationConfigOut | BatchExportConfigOut:
    _validate_template(db, config.template)
    payload = _read_payload(db)
    payload[section] = {**config.model_dump(), "updated_at": utcnow().isoformat()}
    serialized = json.dumps(payload, ensure_ascii=False)
    row = db.get(AppSetting, _KEY)
    if row is None:
        db.add(AppSetting(key=_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    if section == "generation":
        return _section_out(payload["generation"], BatchGenerationConfig, BatchGenerationConfigOut)
    return _section_out(payload["export"], BatchExportConfig, BatchExportConfigOut)


def save_batch_generation_config(
    db: Session, config: BatchGenerationConfig
) -> BatchGenerationConfigOut:
    return _save_section(db, "generation", config)


def save_batch_export_config(db: Session, config: BatchExportConfig) -> BatchExportConfigOut:
    return _save_section(db, "export", config)


__all__ = [
    "BatchSection",
    "read_batch_operation_config",
    "save_batch_export_config",
    "save_batch_generation_config",
]
