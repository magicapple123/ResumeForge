# SPDX-License-Identifier: Apache-2.0
"""Cross-platform asset names, containment and atomic no-overwrite publication."""

from __future__ import annotations

import os
import re
import stat
import unicodedata
from contextlib import suppress
from pathlib import Path, PureWindowsPath
from typing import Any

from .paths import BackupError

_DEVICE_NAME = re.compile(
    r"^(?:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)",
    re.IGNORECASE,
)
_UNSAFE_CHARACTERS = frozenset('/\\:<>"|?*')


def safe_asset_name(value: Any, category: str = "asset") -> str:
    """Accept a real basename on both supported OS families, never a path or ADS."""
    if (
        not isinstance(value, str)
        or not value
        or value.startswith(".")
        or value != value.rstrip(" .")
        or len(value.encode("utf-8", errors="surrogatepass")) > 255
        or PureWindowsPath(value).anchor
        or any(
            char in _UNSAFE_CHARACTERS
            or ord(char) < 32
            or ord(char) == 127
            or 0xD800 <= ord(char) <= 0xDFFF
            for char in value
        )
        or _DEVICE_NAME.match(value.split(".", 1)[0].rstrip(" "))
    ):
        raise BackupError(f"备份包的资产清单里 {category} 有不合法的文件名，已停止恢复")
    # Keep all rejection rules above. Accepted values are already basenames;
    # returning the standard-library basename makes that boundary explicit to
    # callers and data-flow tools without silently renaming an invalid input.
    return os.path.basename(value)


def asset_name_key(value: str) -> str:
    """Portable collision key; do not rename a user's legitimate Unicode basename."""
    return unicodedata.normalize("NFC", value).casefold()


def _is_link(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024)
    )


def assert_safe_directory(directory: Path) -> Path:
    """Never traverse symlinks/junctions when publishing untrusted archive assets."""
    base = directory.absolute()
    for path in (base, *base.parents):
        if _is_link(path):
            raise BackupError("附件目录包含符号链接或目录联接，已停止恢复以保护本机文件")
    return base


def safe_asset_path(directory: Path, name: str) -> Path:
    base = assert_safe_directory(directory)
    canonical_base = os.path.abspath(base)
    normalized = os.path.abspath(os.path.join(canonical_base, safe_asset_name(name)))
    # A lexical Path.is_relative_to check alone accepts "base/../sibling".
    # Normalize first, then require the actual root plus its separator, not a
    # lookalike prefix such as "base-sibling". Do not resolve away target links.
    if not normalized.startswith(os.path.join(canonical_base, "")):
        raise BackupError("附件路径超出受控目录或包含符号链接，已停止恢复")
    target = Path(normalized)
    if _is_link(target):
        raise BackupError("附件路径超出受控目录或包含符号链接，已停止恢复")
    return target


def publish_new_file(source: Path, target: Path) -> None:
    """Atomic create-if-absent: FileExistsError is a conflict, never permission to replace."""
    target = safe_asset_path(target.parent, target.name)
    if os.name == "nt":
        # Windows rename fails when destination exists. Unlike replace it never overwrites.
        os.rename(source, target)
    else:
        # POSIX rename overwrites; an exclusive hard link instead claims the destination atomically.
        os.link(source, target, follow_symlinks=False)
        with suppress(OSError):
            source.unlink()


__all__ = [
    "assert_safe_directory",
    "asset_name_key",
    "publish_new_file",
    "safe_asset_name",
    "safe_asset_path",
]
