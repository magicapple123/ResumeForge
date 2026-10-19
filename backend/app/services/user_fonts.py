"""自定义简历字体（R10）：上传到数据目录，导出 PDF 时优先使用。

为什么是"导出字体"而不是"整站字体"：界面字体由系统与 CSS 决定，用户真正在意的是
**投出去的那份 PDF 用的是什么字**。这里只解决这一件事，并在界面上如实写明。

文件放在 `data/fonts/`，选择记在同目录的 `active.json`（不是全局设置——字体是
跟着"这台机器上有没有这个文件"走的，换个文件就失效，不适合跟模型配置混在一起）。

**永不自动删除用户字体**：删除是显式动作；被删的是当前字体时，active 一并清空，
导出回到系统字体。上传限制 20MB 与 ttf/otf/ttc，是为了避免把 .exe 或超大文件
塞进数据目录——不是安全扫描，做不到也不必假装。
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import DATA_DIR

DIR_NAME = "fonts"
# 随包分发的内置字体（OFL）：放在 backend/assets/fonts，git archive 会带进安装包。
# 只写"文件名 → 中文名"的对照，字体本身与许可证都在同一个目录里。
ASSETS_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"
BUILTIN_FONTS: tuple[tuple[str, str], ...] = (
    ("NotoSansSC-Regular.ttf", "思源黑体"),
    ("NotoSerifSC-Regular.ttf", "思源宋体"),
    ("LXGWWenKai-Regular.ttf", "霞鹜文楷"),
    ("ZCOOLXiaoWei-Regular.ttf", "站酷小薇"),
)
ACTIVE_FILENAME = "active.json"
MAX_BYTES = 20 * 1024 * 1024
ALLOWED_SUFFIXES = {".ttf", ".otf", ".ttc"}

# 文件名里允许的字符：中英文、数字、点、下划线、连字符、空格。其余一律替换成下划线，
# 顺带挡掉路径分隔符与 ".."（拼路径时再做一次只取 basename 的兜底）。
_UNSAFE = re.compile(r"[^\w.\- ]+", re.UNICODE)


class FontError(Exception):
    """可直接展示给用户的字体错误。"""


def fonts_dir() -> Path:
    return Path(DATA_DIR) / DIR_NAME


def _active_file() -> Path:
    return fonts_dir() / ACTIVE_FILENAME


def _normalize_name(filename: str) -> str:
    base = Path(filename).name.strip()
    safe = _UNSAFE.sub("_", base).strip(" ._")
    if not safe:
        raise FontError("字体文件名不合法")
    suffix = Path(safe).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise FontError(f"只支持 {' / '.join(sorted(ALLOWED_SUFFIXES))} 字体文件")
    return safe[:80]


def list_fonts() -> list[dict[str, Any]]:
    """已上传的字体列表（按修改时间倒序），带"是不是当前使用"的标记。"""
    directory = fonts_dir()
    if not directory.is_dir():
        return []
    active = active_font_name()
    items: list[dict[str, Any]] = []
    for path in directory.iterdir():
        if not path.is_file() or path.name == ACTIVE_FILENAME:
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        items.append(
            {
                "name": path.name,
                "size": stat.st_size,
                "uploaded_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                "active": path.name == active,
            }
        )
    items.sort(key=lambda item: item["uploaded_at"], reverse=True)
    return items


def builtin_font_path(name: str) -> Path | None:
    path = ASSETS_DIR / name
    return path if path.is_file() else None


def list_builtin_fonts() -> list[dict[str, Any]]:
    """随包分发的内置字体。缺失的（精简安装）直接不列出，而不是给一个点不动的选项。"""
    items: list[dict[str, Any]] = []
    for filename, label in BUILTIN_FONTS:
        path = builtin_font_path(filename)
        if path is None:
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        items.append({"name": filename, "label": label, "size": size, "builtin": True})
    return items


def active_font_info() -> dict[str, Any] | None:
    """当前选中的字体：``{"name","builtin"}``；没有选就是 None。"""
    try:
        data = json.loads(_active_file().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    name = data.get("name")
    if not isinstance(name, str) or not name:
        return None
    # 旧文件只有 name（那时的选择必然是自定义字体），builtin 默认 False。
    return {"name": name, "builtin": bool(data.get("builtin"))}


def active_font_name() -> str | None:
    info = active_font_info()
    return info["name"] if info else None


def active_font_path() -> Path | None:
    """当前字体文件的真实路径；文件不存在时返回 None（不要回落到一个坏路径）。"""
    info = active_font_info()
    if info is None:
        return None
    if info["builtin"]:
        return builtin_font_path(info["name"])
    path = fonts_dir() / info["name"]
    return path if path.is_file() else None


def save_font(filename: str, data: bytes) -> dict[str, Any]:
    if len(data) > MAX_BYTES:
        raise FontError(f"字体文件不能超过 {MAX_BYTES // (1024 * 1024)}MB")
    if not data:
        raise FontError("字体文件是空的")
    name = _normalize_name(filename)
    directory = fonts_dir()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / name
    temp = target.with_suffix(target.suffix + ".tmp")
    temp.write_bytes(data)
    temp.replace(target)
    return {"name": name, "size": len(data), "active": name == active_font_name()}


def set_active(name: str | None, *, builtin: bool = False) -> None:
    """设置当前字体；`None` 表示回到系统字体。

    ``builtin=True`` 时 ``name`` 是随包分发的文件名，否则是用户自己上传的。
    """
    if name is None:
        _active_file().unlink(missing_ok=True)
        return
    if builtin:
        if builtin_font_path(name) is None:
            raise FontError("内置字体不存在，可能安装包被精简过")
    else:
        path = fonts_dir() / name
        if not path.is_file():
            raise FontError("字体文件不存在，请重新上传")
    _active_file().parent.mkdir(parents=True, exist_ok=True)
    _active_file().write_text(
        json.dumps({"name": name, "builtin": builtin}, ensure_ascii=False), encoding="utf-8"
    )


def delete_font(name: str) -> None:
    path = fonts_dir() / name
    if not path.is_file():
        raise FontError("字体文件不存在")
    path.unlink()
    info = active_font_info()
    if info is not None and not info["builtin"] and info["name"] == name:
        _active_file().unlink(missing_ok=True)


__all__ = [
    "ASSETS_DIR",
    "BUILTIN_FONTS",
    "DIR_NAME",
    "MAX_BYTES",
    "FontError",
    "active_font_info",
    "active_font_name",
    "active_font_path",
    "builtin_font_path",
    "list_builtin_fonts",
    "delete_font",
    "list_fonts",
    "save_font",
    "set_active",
]
