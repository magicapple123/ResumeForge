# SPDX-License-Identifier: Apache-2.0
"""自定义简历字体（R10）：上传到数据目录，导出 PDF 时优先使用。

为什么是"导出字体"而不是"整站字体"：界面字体由系统与 CSS 决定，用户真正在意的是
**投出去的那份 PDF 用的是什么字**。这里只解决这一件事，并在界面上如实写明。

文件放在 `data/fonts/`，选择记在同目录的 `active.json`（不是全局设置——字体是
跟着"这台机器上有没有这个文件"走的，换个文件就失效，不适合跟模型配置混在一起）。

**永不自动删除用户字体**：删除是显式动作；被删的是当前字体时，active 一并清空，
导出回到系统字体。字体文件的来源只有两条：内置思源黑体（按需下载，见
``resume_font_builtin``）与本机已有的历史文件——**上传接口已于 2026-11 下线**。
``MAX_BYTES`` 保留下来只用于接口里回给前端的体积上限提示。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import DATA_DIR
from .resume_font_builtin import BUILTIN_FILES

DIR_NAME = "fonts"
ACTIVE_FILENAME = "active.json"
# 自定义显示名单独存一份：**文件名保持不动**——它就是磁盘上的真实文件、也是
# `format_config.font` 里存的键，改文件名会让所有引用它的简历一起断掉。
NAMES_FILENAME = "names.json"
MAX_DISPLAY_NAME = 40
MAX_BYTES = 30 * 1024 * 1024
ALLOWED_SUFFIXES = {".ttf", ".otf", ".ttc"}

# 内置字体（思源黑体）的文件名清单与"常规 → 粗体"配对。清单的唯一来源是
# ``resume_font_builtin.BUILTIN_FILES``（下载模块），这里只做形状转换——
# 两处各写一份文件名，早晚会有一处漏改。
BUILTIN_FONT_NAMES = frozenset(str(item["name"]) for item in BUILTIN_FILES)
BUILTIN_PAIR: dict[str, str] = {
    str(BUILTIN_FILES[0]["name"]): str(BUILTIN_FILES[1]["name"]),
}


class FontError(Exception):
    """可直接展示给用户的字体错误。"""


def fonts_dir() -> Path:
    return Path(DATA_DIR) / DIR_NAME


def _active_file() -> Path:
    return fonts_dir() / ACTIVE_FILENAME


def _names_file() -> Path:
    return fonts_dir() / NAMES_FILENAME


def _read_names() -> dict[str, str]:
    """读「文件名 → 自定义显示名」。坏文件按空处理，不让字体列表整体挂掉。"""
    try:
        raw = json.loads(_names_file().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        key: value.strip()
        for key, value in raw.items()
        if isinstance(key, str) and isinstance(value, str) and value.strip()
    }


def _write_names(names: dict[str, str]) -> None:
    directory = fonts_dir()
    directory.mkdir(parents=True, exist_ok=True)
    _names_file().write_text(
        json.dumps(names, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def font_path(name: str) -> Path:
    """按文件名取字体路径（拒绝任何目录成分，调用方不必再拼路径）。"""
    safe = Path(name).name
    if not safe or safe != name or safe == ACTIVE_FILENAME:
        raise FontError("字体文件名不合法")
    path = fonts_dir() / safe
    if not path.is_file():
        raise FontError("字体文件不存在")
    return path


def list_fonts(include_builtin: bool = False) -> list[dict[str, Any]]:
    """已上传的字体列表（按修改时间倒序），带"是不是当前使用"的标记。

    ``name`` 永远是**磁盘上的真实文件名**（`format_config.font` 存的也是它）；
    ``display_name`` 是用户可改的展示名，没改过时默认取文件名去扩展名。

    ``include_builtin=False``（默认）会把**内置思源黑体**的两个文件滤掉：它们在界面上
    只出现一条"思源黑体（可下载）"，由 ``api/fonts.py`` 手动插到列表首位。要是留在这里，
    用户会看到"Regular"和"Bold"两条互不相干的字体，还能单独选走 Bold——那是把一个字重
    当成一款字体。备份与体检走目录遍历，不走这里，所以不受影响。
    """
    directory = fonts_dir()
    if not directory.is_dir():
        return []
    active = active_font_name()
    names = _read_names()
    items: list[dict[str, Any]] = []
    for path in directory.iterdir():
        if not path.is_file() or path.name in {ACTIVE_FILENAME, NAMES_FILENAME}:
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        if not include_builtin and path.name in BUILTIN_FONT_NAMES:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        items.append(
            {
                "name": path.name,
                "display_name": names.get(path.name) or path.stem,
                "size": stat.st_size,
                "uploaded_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                "active": path.name == active,
            }
        )
    items.sort(key=lambda item: item["uploaded_at"], reverse=True)
    return items


def active_font_name() -> str | None:
    """当前选中的字体文件名；没有选就是 None。"""
    try:
        data = json.loads(_active_file().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    name = data.get("name") if isinstance(data, dict) else None
    return name if isinstance(name, str) and name else None


def active_font_path() -> Path | None:
    """当前字体文件的真实路径；文件不存在时返回 None（不要回落到一个坏路径）。"""
    name = active_font_name()
    if not name:
        return None
    path = fonts_dir() / name
    return path if path.is_file() else None


def font_pair(name: str) -> tuple[Path, Path]:
    """字体文件名 → ``(常规字面, 粗体字面)``。

    内置思源黑体带两个文件，返回各自路径（PDF 的粗体因此是**真字面**，不是描边）。
    其它字体（用户历史上传的 ttf/otf/ttc）只有一个文件，常规与粗体都是它——行为与本
    功能上线前**完全一致**。

    Raises:
        FontError: 文件不存在（与 ``font_path`` 同语义）。
    """
    regular = font_path(name)
    bold_name = BUILTIN_PAIR.get(regular.name)
    if bold_name:
        bold = fonts_dir() / bold_name
        if bold.is_file():
            return regular, bold
    return regular, regular


def active_font_paths() -> tuple[Path, Path] | None:
    """当前字体的 ``(常规, 粗体)``；没有选中或文件缺失时返回 None。"""
    path = active_font_path()
    if path is None:
        return None
    try:
        return font_pair(path.name)
    except FontError:
        return None


def set_active(name: str | None) -> None:
    """设置当前字体；`None` 表示回到系统字体。"""
    if name is None:
        _active_file().unlink(missing_ok=True)
        return
    font_path(name)  # 只做存在性/路径校验：字体文件必须已上传
    _active_file().parent.mkdir(parents=True, exist_ok=True)
    _active_file().write_text(json.dumps({"name": name}, ensure_ascii=False), encoding="utf-8")


def rename_font(name: str, display_name: str) -> dict[str, Any]:
    """改字体的**展示名**，文件名一个字节都不动。

    为什么不让用户直接改文件名：`format_config.font` 存的就是文件名，所有用过它的
    简历都会被写死在这个键上；换名字等于把那些简历的字体一起弄丢。展示名单独存，
    想叫什么都行，底下的文件仍然可定位。
    """
    path = font_path(name)
    label = (display_name or "").strip()
    if not label:
        raise FontError("字体名称不能为空")
    label = label[:MAX_DISPLAY_NAME]
    names = _read_names()
    names[path.name] = label
    _write_names(names)
    return {"name": path.name, "display_name": label}


def delete_font(name: str) -> None:
    path = font_path(name)
    path.unlink()
    if active_font_name() == name:
        _active_file().unlink(missing_ok=True)
    names = _read_names()
    if names.pop(path.name, None) is not None:
        _write_names(names)


__all__ = [
    "BUILTIN_FONT_NAMES",
    "BUILTIN_PAIR",
    "DIR_NAME",
    "MAX_BYTES",
    "FontError",
    "active_font_name",
    "active_font_path",
    "active_font_paths",
    "delete_font",
    "font_pair",
    "font_path",
    "list_fonts",
    "rename_font",
    "set_active",
]
