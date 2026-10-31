# SPDX-License-Identifier: Apache-2.0
"""纸面限长与照片解析（paper_content_builder 的内部协作层，独立成文件控行数）。

**不静默截断**（R-44）：承载区超长时保留默认正文，追加行按顺序放得下多少放多少，
其余进 warnings（code=carrier_overflow）；单行/槽位超长同样截断并 warning。
**照片**只做"引用存在则透传"：data URL 原样，资源 id 交给调用方注入的解析器；
解析不了留空 + warning photo_unresolved（不自动用旧 primary 照片）。

限长从 pydantic 字段读（不维护第二份长度表）：pydantic 2.13 把 Field(max_length=...)
收进 FieldInfo.metadata 的 MaxLen，而不是 FieldInfo.max_length。
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

from ...schemas.profile import validate_photo_data_url
from ...schemas.profile_projection import ProjectionWarningOut

# 照片解析回调：资源引用（非 data URL）→ data URL；解析不了返回 None。
PhotoResolver = Callable[[str], str | None]

# 与 ResumeLine / ResumeCustom* 的结构上限一致；超长时截断并 warning。
MAX_RESUME_LINE_CHARS = 20_000
MAX_CARRIER_LINES = 500

_SPLIT_LINES = re.compile(r"[\r\n]+")
_SPLIT_ITEMS = re.compile(r"[\r\n,，、;；|]+")

__all__ = [
    "MAX_CARRIER_LINES",
    "MAX_RESUME_LINE_CHARS",
    "PhotoResolver",
    "clip_text",
    "fit_lines",
    "fit_scalar",
    "has_value",
    "resolve_photo",
    "slot_limit",
    "split_items",
    "split_lines",
    "warn",
    "warn_slot_clip",
]


def warn(
    warnings: list[ProjectionWarningOut],
    code: str,
    section_key: str,
    entry_id: str,
    message: str,
) -> None:
    warnings.append(
        ProjectionWarningOut(code=code, section_key=section_key, entry_id=entry_id, message=message)
    )


def has_value(value: object) -> bool:
    """槽位值是否真的有内容（空串/空列表/空模型都不算）。"""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return bool(value)


def clip_text(text: str, limit: int | None) -> tuple[str, bool]:
    if not limit or len(text) <= limit:
        return text, False
    return text[:limit], True


def slot_limit(model: type, attr: str) -> int | None:
    """从 pydantic 字段读限长；列表字段读的是条目数上限。"""
    info = getattr(model, "model_fields", {}).get(attr)
    for item in getattr(info, "metadata", ()) if info is not None else ():
        limit = getattr(item, "max_length", None)
        if isinstance(limit, int):
            return limit
    return None


def split_lines(text: str) -> list[str]:
    if not text:
        return []
    return [item.strip() for item in _SPLIT_LINES.split(text) if item.strip()]


def split_items(text: str) -> list[str]:
    if not text:
        return []
    return [item.strip() for item in _SPLIT_ITEMS.split(text) if item.strip()]


def fit_lines(
    base: str,
    extras: Sequence[tuple[str, str]],
    model: type,
    carrier_attr: str,
    section_key: str,
    entry_id: str,
    warnings: list[ProjectionWarningOut],
) -> list[str]:
    """无总长度上限的列表承载区：逐行放，超出槽位行数/单行上限的部分进 warning。"""
    limit = slot_limit(model, carrier_attr) or MAX_CARRIER_LINES
    lines = split_lines(base)
    dropped: list[str] = []
    if len(lines) > limit:
        dropped.append("默认正文（超出部分）")
        # 文字不丢：超出上限的行并入最后一行（列表仍 ≤ 上限，不静默丢整行）；
        # warning 仍如实说明这些行未按独立行上纸面。
        lines = lines[: limit - 1] + ["\n".join(lines[limit - 1 :])]
    for label, text in extras:
        if len(lines) >= limit:
            dropped.append(label)
            continue
        fitted, cut = clip_text(text, MAX_RESUME_LINE_CHARS)
        if cut:
            dropped.append(label)
        lines.append(fitted)
    if dropped:
        warn(
            warnings,
            "carrier_overflow",
            section_key,
            entry_id,
            "承载区放不下这些内容，未上纸面：" + "、".join(dropped),
        )
    return lines


def fit_scalar(
    base: str,
    extras: Sequence[tuple[str, str]],
    limit: int,
    scope: tuple[str, str],
    warnings: list[ProjectionWarningOut],
) -> str:
    """标量承载区：默认正文优先，追加行按顺序放到上限，其余进 warning（R-44）。"""
    text, cut = clip_text(base, limit)
    if cut:
        warn(
            warnings,
            "carrier_overflow",
            scope[0],
            scope[1],
            f"承载区正文超过 {limit} 字符上限，超出部分未上纸面；请缩短后重新填充",
        )
    dropped: list[str] = []
    for label, line in extras:
        separator = "\n" if text else ""
        if len(text) + len(separator) + len(line) > limit:
            dropped.append(label)
            continue
        text = f"{text}{separator}{line}"
    if dropped:
        warn(
            warnings,
            "carrier_overflow",
            scope[0],
            scope[1],
            "承载区放不下这些字段行，未上纸面：" + "、".join(dropped),
        )
    return text


def warn_slot_clip(
    warnings: list[ProjectionWarningOut], section_key: str, entry_id: str, labels: list[str]
) -> None:
    if not labels:
        return
    warn(
        warnings,
        "carrier_overflow",
        section_key,
        entry_id,
        "字段内容超过纸面槽位上限，已截断：" + "、".join(labels),
    )


def resolve_photo(
    reference: str,
    resolver: PhotoResolver | None,
    section_key: str,
    entry_id: str,
    warnings: list[ProjectionWarningOut],
) -> str:
    """照片引用：data URL 原样透传；资源引用交给注入的解析器，失败留空 + warning。"""
    reference = reference.strip()
    if not reference:
        return ""
    resolved = reference
    if not reference.lower().startswith("data:"):
        resolved = ""
        if resolver is not None:
            try:
                resolved = resolver(reference) or ""
            except Exception:  # noqa: BLE001 - 解析器由调用方注入，失败只影响照片
                resolved = ""
        if not resolved:
            warn(
                warnings,
                "photo_unresolved",
                section_key,
                entry_id,
                "照片引用无法解析，纸面已留空；请在资料页重新选择照片",
            )
            return ""
    try:
        return validate_photo_data_url(resolved)
    except ValueError:
        warn(
            warnings,
            "photo_unresolved",
            section_key,
            entry_id,
            "照片内容不是可用的图片，纸面已留空；请重新上传照片",
        )
        return ""
