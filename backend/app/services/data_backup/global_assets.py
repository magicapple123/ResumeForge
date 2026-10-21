# SPDX-License-Identifier: Apache-2.0
"""全局资产（自定义字体）在备份包里的载体（P2，格式 6）。

字体落在 ``DATA_DIR/fonts/``：**跨数据集共用**，与 ``global_llm.json`` 同性质，所以按
"全局成员"走，**不能**塞进 :data:`ASSET_CATEGORIES`——那两类的语义是"每份数据集各带
各的"，塞进去会让多份数据集各存一份字体、恢复时互相覆盖。

包结构（全部在顶层，不进嵌套子包）::

    global_assets.json     # 清单段：版本 + 逐文件 size/sha256 + active / names 旗标
    fonts/<字体文件名>      # binary，扁平存放
    fonts/active.json      # 当前字体（只在本机没有选择时采用）
    fonts/names.json       # 文件名 → 显示名（只补本机缺失的键）

冲突策略（D2）：**不覆盖本机同名**——字体是用户的偏好，换机恢复不该把本机正在用
的那款换掉；同名计入 ``skipped``。字体属于附加物，恢复失败**不回滚**数据集导入，
只写进 ``asset_issues`` 让界面说清"字体未完全恢复"。

密钥策略无关：字体里没有任何凭据，``include_api_keys`` 不影响这一层。
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import shutil
import zipfile
from pathlib import Path
from typing import Any

from .. import user_fonts
from .asset_manifest import file_digest
from .asset_safety import publish_new_file, safe_asset_name

logger = logging.getLogger(__name__)

GLOBAL_ASSETS_MEMBER = "global_assets.json"
GLOBAL_ASSETS_VERSION = 1
FONTS_PREFIX = "fonts/"
ACTIVE_MEMBER = f"{FONTS_PREFIX}{user_fonts.ACTIVE_FILENAME}"
NAMES_MEMBER = f"{FONTS_PREFIX}{user_fonts.NAMES_FILENAME}"

_CHUNK_BYTES = 1 << 20


def _list_font_files() -> list[Path]:
    """字体目录下真正可用的字体文件（跳过 active.json / names.json 与临时文件）。"""
    directory = user_fonts.fonts_dir()
    try:
        entries = sorted(directory.iterdir(), key=lambda item: item.name)
    except OSError:
        return []
    fonts: list[Path] = []
    for path in entries:
        try:
            if not path.is_file():
                continue
        except OSError:
            continue
        if path.name in {user_fonts.ACTIVE_FILENAME, user_fonts.NAMES_FILENAME}:
            continue
        if path.suffix.lower() not in user_fonts.ALLOWED_SUFFIXES:
            continue
        fonts.append(path)
    return fonts


def build_global_assets_payload() -> dict[str, Any] | None:
    """把字体目录打包成可写入 zip 的清单；一个字体都没有时返回 None。

    返回 None 是关键：**字体目录为空时格式号保持 5**（内容分级，不虚升）。
    """
    fonts: list[dict[str, Any]] = []
    for path in _list_font_files():
        try:
            size, digest = file_digest(path)
        except OSError:
            logger.warning("字体文件读取失败，已排除出备份：%s", path.name, exc_info=True)
            continue
        fonts.append({"name": path.name, "size_bytes": size, "sha256": digest})
    if not fonts:
        return None
    active = user_fonts.active_font_name()
    names = user_fonts._read_names()  # noqa: SLF001 - names.json 的读写归 user_fonts 所有
    return {
        "version": GLOBAL_ASSETS_VERSION,
        "font_count": len(fonts),
        "fonts": fonts,
        "active": active if isinstance(active, str) else "",
        "names_included": bool(names),
    }


def manifest_section(font_count: int) -> dict[str, Any]:
    """写进 ``manifest.json`` 的摘要段：导入侧据此 fail-closed 校验版本。"""
    return {"version": GLOBAL_ASSETS_VERSION, "fonts": int(font_count)}


def write_global_assets_members(archive: zipfile.ZipFile, payload: dict[str, Any] | None) -> int:
    """把清单段、字体字节、active/names 写进 zip，返回写入的字体数（0 = 没写）。"""
    if payload is None:
        return 0
    archive.writestr(GLOBAL_ASSETS_MEMBER, json.dumps(payload, ensure_ascii=False, indent=2))
    written = 0
    for entry in payload.get("fonts") or []:
        if not isinstance(entry, dict):
            continue
        name = safe_asset_name(entry.get("name"), "fonts")
        _write_font_member(archive, name, entry)
        written += 1
    names = user_fonts._read_names()  # noqa: SLF001 - 同 build：一份实现一处读写
    if names:
        archive.writestr(NAMES_MEMBER, json.dumps(names, ensure_ascii=False, indent=2))
    active = payload.get("active")
    if isinstance(active, str) and active:
        archive.writestr(ACTIVE_MEMBER, json.dumps({"name": active}, ensure_ascii=False))
    return written


def _write_font_member(archive: zipfile.ZipFile, name: str, entry: dict[str, Any]) -> None:
    """逐块写出字体并复核 size/sha256：导出期间字体被改动就中止，不写一份错位的包。"""
    from .paths import BackupError

    source = user_fonts.fonts_dir() / name
    expected_size = entry.get("size_bytes")
    expected_digest = entry.get("sha256")
    digest, size = hashlib.sha256(), 0
    try:
        with source.open("rb") as handle, archive.open(f"{FONTS_PREFIX}{name}", "w") as out:
            for chunk in iter(lambda: handle.read(_CHUNK_BYTES), b""):
                size += len(chunk)
                if type(expected_size) is int and size > expected_size:
                    raise BackupError("备份导出期间字体发生变化，已停止导出，请重试")
                digest.update(chunk)
                out.write(chunk)
    except OSError as exc:
        raise BackupError("备份导出期间字体不可读取，已停止导出，请重试") from exc
    if size != expected_size or digest.hexdigest() != expected_digest:
        raise BackupError("备份导出期间字体发生变化，已停止导出，请重试")


def read_global_assets_payload(archive_path: Path) -> dict[str, Any] | None:
    """从备份包里读全局资产段；没有该成员（格式 ≤5 的旧包）时返回 None。"""
    try:
        with zipfile.ZipFile(archive_path) as archive:
            raw = archive.read(GLOBAL_ASSETS_MEMBER)
    except KeyError:
        return None
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValueError(f"备份包里的字体清单不可读：{exc}") from exc
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("备份包里的字体清单不是合法 JSON") from exc
    if not isinstance(payload, dict) or payload.get("version") != GLOBAL_ASSETS_VERSION:
        raise ValueError(
            "备份包里的字体清单版本不受支持，可能来自其它版本的 ResumeForge；请先升级应用再导入"
        )
    if not isinstance(payload.get("fonts"), list):
        raise ValueError("备份包里的字体清单结构不正确")
    return payload


def payload_summary(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """给界面/清单用的摘要（不含任何字体内容）。"""
    if not payload:
        return None
    fonts = payload.get("fonts")
    return {"fonts": len(fonts) if isinstance(fonts, list) else 0}


def restore_global_assets(archive_path: Path, payload: dict[str, Any] | None) -> dict[str, Any]:
    """把包里的字体恢复进本机字体目录，返回计数与问题清单。

    语义（D2）：同名文件**不覆盖**（计入 ``skipped``）；``names.json`` 只补缺失键；
    ``active.json`` 仅在本机尚无选择时写入。任何单个文件失败都只记进 ``issues``，
    不抛异常——字体是附加物，不能让它把已经落盘的数据集拖回去。
    """
    result: dict[str, Any] = {
        "restored": 0,
        "skipped": 0,
        "active_set": False,
        "names_added": 0,
        "issues": [],
    }
    if not isinstance(payload, dict):
        return result
    directory = user_fonts.fonts_dir()
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        result["issues"].append(f"无法创建字体目录（{exc}）")
        return result

    staging = directory.parent / f".rf-fonts-{secrets.token_hex(8)}"
    try:
        staging.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        result["issues"].append(f"无法创建字体暂存目录（{exc}）")
        return result
    try:
        with zipfile.ZipFile(archive_path) as archive:
            _restore_font_files(archive, payload, directory, staging, result)
            _restore_names(archive, directory, result)
            _restore_active(archive, directory, result)
    except (OSError, zipfile.BadZipFile) as exc:
        result["issues"].append(f"字体恢复中断（{exc}）")
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return result


def _restore_font_files(
    archive: zipfile.ZipFile,
    payload: dict[str, Any],
    directory: Path,
    staging: Path,
    result: dict[str, Any],
) -> None:
    from .paths import BackupError

    for entry in payload.get("fonts") or []:
        if not isinstance(entry, dict):
            continue
        try:
            name = safe_asset_name(entry.get("name"), "fonts")
        except BackupError:
            result["issues"].append("备份包里有一个字体文件名不合法，已跳过")
            continue
        if Path(name).suffix.lower() not in user_fonts.ALLOWED_SUFFIXES:
            result["issues"].append(f"字体「{name}」的类型不受支持，已跳过")
            continue
        member = f"{FONTS_PREFIX}{name}"
        try:
            info = archive.getinfo(member)
        except KeyError:
            result["issues"].append(f"备份包里缺少字体「{name}」的内容")
            continue
        temporary = staging / name
        try:
            digest, size = _extract_verified(archive, info, temporary)
        except BackupError as exc:
            temporary.unlink(missing_ok=True)
            result["issues"].append(f"字体「{name}」校验失败（{exc}）")
            continue
        expected_size = entry.get("size_bytes")
        if size != expected_size or digest != entry.get("sha256"):
            temporary.unlink(missing_ok=True)
            result["issues"].append(f"字体「{name}」的内容与清单不符，已跳过")
            continue
        try:
            publish_new_file(temporary, directory / name)
            result["restored"] += 1
        except FileExistsError:
            # 本机已有同名字体：保留本机那份（可能是用户自己换过的版本）。
            result["skipped"] += 1
        except OSError as exc:
            result["issues"].append(f"字体「{name}」写入失败（{exc}）")


def _extract_verified(
    archive: zipfile.ZipFile, info: zipfile.ZipInfo, destination: Path
) -> tuple[str, int]:
    """把成员写到 destination 并返回 (sha256, 字节数)；读坏了删半成品再抛。"""
    from .paths import BackupError

    digest, size = hashlib.sha256(), 0
    try:
        with archive.open(info) as source, destination.open("xb") as target:
            for chunk in iter(lambda: source.read(_CHUNK_BYTES), b""):
                size += len(chunk)
                digest.update(chunk)
                target.write(chunk)
    except (zipfile.BadZipFile, OSError) as exc:
        destination.unlink(missing_ok=True)
        raise BackupError("包内字体已损坏，无法读取") from exc
    return digest.hexdigest(), size


def _read_json_member(archive: zipfile.ZipFile, member: str) -> dict[str, Any]:
    try:
        raw = archive.read(member)
    except KeyError:
        return {}
    try:
        parsed = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _restore_names(archive: zipfile.ZipFile, directory: Path, result: dict[str, Any]) -> None:
    """只补缺失键：本机已经改过的显示名优先。"""
    exported = _read_json_member(archive, NAMES_MEMBER)
    if not exported:
        return
    local = user_fonts._read_names()  # noqa: SLF001 - names.json 的唯一读写入口
    added = 0
    for name, label in exported.items():
        if not isinstance(name, str) or not isinstance(label, str):
            continue
        label = label.strip()
        if not label or name in local:
            continue
        if not (directory / name).is_file():
            continue
        local[name] = label[: user_fonts.MAX_DISPLAY_NAME]
        added += 1
    if not added:
        return
    try:
        user_fonts._write_names(local)  # noqa: SLF001 - 同上
        result["names_added"] = added
    except OSError as exc:
        result["issues"].append(f"字体显示名写入失败（{exc}）")


def _restore_active(archive: zipfile.ZipFile, directory: Path, result: dict[str, Any]) -> None:
    """仅在本机没有选择时采用包里的当前字体（不替换用户正在用的那款）。"""
    exported = _read_json_member(archive, ACTIVE_MEMBER)
    name = exported.get("name")
    if not isinstance(name, str) or not name:
        return
    if user_fonts.active_font_name():
        return
    if not (directory / name).is_file():
        return
    try:
        user_fonts.set_active(name)
        result["active_set"] = True
    except (OSError, user_fonts.FontError) as exc:
        result["issues"].append(f"当前字体未能设置（{exc}）")


__all__ = [
    "GLOBAL_ASSETS_MEMBER",
    "GLOBAL_ASSETS_VERSION",
    "build_global_assets_payload",
    "manifest_section",
    "payload_summary",
    "read_global_assets_payload",
    "restore_global_assets",
    "write_global_assets_members",
]
