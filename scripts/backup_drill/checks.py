#!/usr/bin/env python
# SPDX-License-Identifier: Apache-2.0
"""R01 演练的核对辅助：资产清单 / 字体 / 恢复后磁盘字节。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import (
    FONTS_PREFIX,
    GLOBAL_ASSETS_MEMBER,
    Drill,
    bytes_sha256,
    file_sha256,
    member_digest,
    read_json_member,
)


def expected_assets(section: Any, payloads: dict[str, bytes]) -> dict[str, dict[str, bytes]]:
    """从清单段的资产名 + 合成字节表构造"应该恢复成什么"。"""
    result: dict[str, dict[str, bytes]] = {}
    if not isinstance(section, dict):
        return result
    for category, payload in payloads.items():
        names = [str(entry.get("name")) for entry in section.get(category) or []]
        if len(names) == 1:
            result[category] = {names[0]: payload}
    return result


def check_assets(
    drill: Drill,
    key: str,
    archive: Path,
    section: Any,
    expected: dict[str, dict[str, bytes]],
    *,
    prefix: str = "",
) -> None:
    """核对一个资产清单段：版本、名字集合、每个成员的 size/sha256、缺失名单为空。"""
    from app.services.data_backup import ASSET_MANIFEST_VERSION

    ok = isinstance(section, dict) and section.get("manifest_version") == ASSET_MANIFEST_VERSION
    drill.check(f"{key}.version", ok, "资产清单段缺失或版本不符")
    if not ok:
        return
    for category, files in expected.items():
        entries = section.get(category) or []
        names = {str(entry.get("name")) for entry in entries if isinstance(entry, dict)}
        drill.check(f"{key}.{category}.names", names == set(files), f"{sorted(names)}")
        drill.check(f"{key}.{category}.missing", not section.get(f"{category}_missing"))
        for name, payload in files.items():
            member = f"{prefix}{category}/{name}"
            try:
                size, digest = member_digest(archive, member)
            except KeyError:
                drill.check(f"{key}.{category}.{name}", False, f"包内缺少成员 {member}")
                continue
            drill.check(
                f"{key}.{category}.{name}",
                size == len(payload) and digest == bytes_sha256(payload),
                "包内字节与合成数据不一致",
            )


def check_disk_assets(
    drill: Drill,
    key: str,
    assets_root: Path,
    expected: dict[str, dict[str, bytes]],
) -> None:
    for category, files in expected.items():
        for name, payload in files.items():
            path = assets_root / category / name
            try:
                digest = file_sha256(path)
            except OSError:
                drill.check(f"{key}.{category}.{name}", False, "恢复后文件不存在")
                continue
            drill.check(
                f"{key}.{category}.{name}",
                path.stat().st_size == len(payload) and digest == bytes_sha256(payload),
                "恢复后字节与源数据不一致",
            )


def check_fonts(drill: Drill, key: str, archive: Path, fonts: dict[str, bytes]) -> dict | None:
    """核对 global_assets.json 段与字体成员字节。"""
    try:
        payload = read_json_member(archive, GLOBAL_ASSETS_MEMBER)
    except (KeyError, ValueError):
        drill.check(f"{key}.member", False, "包内缺少 global_assets.json")
        return None
    entries = {str(entry.get("name")): entry for entry in payload.get("fonts") or []}
    drill.check(f"{key}.names", set(entries) == set(fonts), f"{sorted(entries)}")
    for name, payload_bytes in fonts.items():
        expected = entries.get(name) or {}
        try:
            size, digest = member_digest(archive, f"{FONTS_PREFIX}{name}")
        except KeyError:
            drill.check(f"{key}.{name}", False, "包内缺少字体成员")
            continue
        drill.check(
            f"{key}.{name}",
            size == len(payload_bytes) and digest == bytes_sha256(payload_bytes),
            "字体字节与合成数据不一致",
        )
        drill.check(
            f"{key}.{name}.manifest",
            expected.get("sha256") == digest and expected.get("size_bytes") == size,
            "字体清单与包内字节不一致",
        )
    return payload
