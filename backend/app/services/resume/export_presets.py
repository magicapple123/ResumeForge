# SPDX-License-Identifier: Apache-2.0
"""W19 命名导出配置（D18）：数据集级 CRUD、默认项、命名模板校验。

预设只保存格式组合/命名/后处理选项，**不含内容与版式**；按数据集独立库隔离、随备份走。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.resume_export import ResumeExportPreset
from .export_naming import NamingError, validate_naming

MAX_PRESETS = 50
ALLOWED_FORMATS = {"json", "md", "html", "pdf", "docx", "txt"}
DEFAULT_FORMATS = ("pdf", "docx", "html", "md", "txt")
_MAX_CONFIG_TEXT = 200


class PresetError(ValueError):
    """保存预设时的用户可读错误。"""


def _validate_config(config: dict[str, Any] | None) -> dict[str, Any]:
    raw = config if isinstance(config, dict) else {}
    formats = raw.get("formats") or list(DEFAULT_FORMATS)
    if not isinstance(formats, list) or not formats:
        raise PresetError("至少选择一种导出格式")
    cleaned_formats: list[str] = []
    for item in formats:
        if not isinstance(item, str) or item not in ALLOWED_FORMATS:
            raise PresetError(f"不支持的导出格式：{item}")
        if item not in cleaned_formats:
            cleaned_formats.append(item)
    try:
        naming = validate_naming(str(raw.get("naming") or ""))
    except NamingError as exc:
        raise PresetError(str(exc)) from exc
    watermark = str(raw.get("watermark") or "")[:200]
    redact = bool(raw.get("redact"))
    include_photo = True if raw.get("include_photo") is None else bool(raw.get("include_photo"))
    archive_original = bool(raw.get("archive_original"))
    max_artifacts = raw.get("max_artifacts_per_resume", 20)
    if not isinstance(max_artifacts, int) or not 1 <= max_artifacts <= 20:
        raise PresetError("归档上限必须是 1–20")
    return {
        "formats": cleaned_formats,
        "naming": naming,
        "watermark": watermark,
        "redact": redact,
        "include_photo": include_photo,
        "archive_original": archive_original,
        "max_artifacts_per_resume": max_artifacts,
    }


def preset_brief(preset: ResumeExportPreset) -> dict[str, Any]:
    return {
        "id": preset.id,
        "name": preset.name,
        "description": preset.description or "",
        "config": preset.config or {},
        "is_default": bool(preset.is_default),
        "created_at": preset.created_at,
        "updated_at": preset.updated_at,
    }


def list_presets(db: Session) -> list[ResumeExportPreset]:
    return list(
        db.execute(
            select(ResumeExportPreset).order_by(
                ResumeExportPreset.is_default.desc(), ResumeExportPreset.id
            )
        )
        .scalars()
        .all()
    )


def get_preset(db: Session, preset_id: int) -> ResumeExportPreset | None:
    return db.get(ResumeExportPreset, preset_id)


def _clean_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise PresetError("预设名称不能为空")
    if len(cleaned) > 64:
        raise PresetError("预设名称最长 64 个字符")
    return cleaned


def _find_by_name(
    db: Session, name: str, *, exclude_id: int | None = None
) -> ResumeExportPreset | None:
    preset = db.execute(
        select(ResumeExportPreset).where(ResumeExportPreset.name == name)
    ).scalar_one_or_none()
    if preset is not None and exclude_id is not None and preset.id == exclude_id:
        return None
    return preset


def _apply_default(db: Session, preset: ResumeExportPreset) -> None:
    for other in db.execute(select(ResumeExportPreset)).scalars().all():
        if other.id != preset.id and other.is_default:
            other.is_default = False


def create_preset(
    db: Session,
    *,
    name: str,
    description: str = "",
    config: dict[str, Any] | None = None,
    is_default: bool = False,
) -> ResumeExportPreset:
    if len(list_presets(db)) >= MAX_PRESETS:
        raise PresetError(f"导出配置最多 {MAX_PRESETS} 个")
    cleaned = _clean_name(name)
    if _find_by_name(db, cleaned) is not None:
        raise PresetError("同名导出配置已存在")
    preset = ResumeExportPreset(
        name=cleaned,
        description=(description or "").strip()[:_MAX_CONFIG_TEXT],
        config=_validate_config(config),
        is_default=bool(is_default),
    )
    db.add(preset)
    db.flush()
    if preset.is_default:
        _apply_default(db, preset)
    db.commit()
    db.refresh(preset)
    return preset


def update_preset(
    db: Session,
    preset: ResumeExportPreset,
    *,
    name: str | None = None,
    description: str | None = None,
    config: dict[str, Any] | None = None,
    is_default: bool | None = None,
) -> ResumeExportPreset:
    if name is not None:
        cleaned = _clean_name(name)
        if _find_by_name(db, cleaned, exclude_id=preset.id) is not None:
            raise PresetError("同名导出配置已存在")
        preset.name = cleaned
    if description is not None:
        preset.description = description.strip()[:_MAX_CONFIG_TEXT]
    if config is not None:
        preset.config = _validate_config(config)
    if is_default is not None:
        preset.is_default = bool(is_default)
        if preset.is_default:
            _apply_default(db, preset)
    db.commit()
    db.refresh(preset)
    return preset


def delete_preset(db: Session, preset: ResumeExportPreset) -> None:
    """删除预设不动已归档原件（artifact.preset 不建 FK，归档独立保留）。"""
    db.delete(preset)
    db.commit()
