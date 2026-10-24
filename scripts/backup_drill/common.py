#!/usr/bin/env python
# SPDX-License-Identifier: Apache-2.0
"""R01 演练的共享常量与纯函数（不 import app；pytest 可直接复用）。"""

from __future__ import annotations

import hashlib
import json
import secrets
import zipfile
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parents[1]
BACKEND_DIR = REPO_ROOT / "backend"

# 包内成员名（与 services.data_backup.paths 同值；脚本不 import app 就能读写它们）。
DATABASE_MEMBER = "resume_forge.db"
MANIFEST_MEMBER = "manifest.json"
GLOBAL_LLM_MEMBER = "global_llm.json"
GLOBAL_ASSETS_MEMBER = "global_assets.json"
FONTS_PREFIX = "fonts/"

ARCHIVE_FILES = {
    "single-default": "single-default.zip",
    "single-keys": "single-keys.zip",
    "single-globals": "single-globals.zip",
    "collection-all": "collection-all.zip",
}

# 合成数据（全部虚构；不含任何真实用户资料）。
DB_SECRET = "sk-r01-drill-db-key-0123456789abcdef-r01"
GLOBAL_SECRET = "sk-r01-drill-global-key-fedcba9876543210-r01"
USER_FILE_NAME = "r01-synthetic-user-file.txt"
USER_FILE_BYTES = b"R01 drill user file. Synthetic only, no real user data."
REFERRAL_IMAGE_NAME = "r01-synthetic-referral.png"
REFERRAL_IMAGE_BYTES = b"PNG R01 drill referral image (synthetic)"
EXTRA_FILE_NAME = "r01-synthetic-extra-file.txt"
EXTRA_FILE_BYTES = b"R01 drill second-dataset user file (synthetic)."
EXTRA_IMAGE_NAME = "r01-synthetic-extra-referral.png"
EXTRA_IMAGE_BYTES = b"PNG R01 drill second-dataset image (synthetic)"
FONT_A_NAME = "r01-synthetic-regular.ttf"
FONT_A_BYTES = b"R01 synthetic font bytes: regular"
FONT_B_NAME = "r01-synthetic-bold.ttf"
FONT_B_BYTES = b"R01 synthetic font bytes: bold subset"
UNCOVERED_DIR = "r01-synthetic-uncovered-dir"
UNCOVERED_FILE = "r01-synthetic-uncovered-file.txt"
RUNTIME_ONLY_DIR = "backups"  # 已知运行产物：必须**不**出现在 uncovered 里
_APP_ENV_KEYS = (
    "DATABASE_URL",
    "RF_DATA_DIR",
    "LOG_FILE_ENABLED",
    "AUTO_BACKUP_ENABLED",
    "RF_DESKTOP_SHELL",
)
_MAIN_PAYLOADS = {"user_files": USER_FILE_BYTES, "referral_images": REFERRAL_IMAGE_BYTES}
_EXTRA_PAYLOADS = {"user_files": EXTRA_FILE_BYTES, "referral_images": EXTRA_IMAGE_BYTES}
_FONTS = {FONT_A_NAME: FONT_A_BYTES, FONT_B_NAME: FONT_B_BYTES}

# 供同包其它模块使用的只读别名（下划线名保留在本模块内部）。
MAIN_PAYLOADS = _MAIN_PAYLOADS
EXTRA_PAYLOADS = _EXTRA_PAYLOADS
FONTS = _FONTS

# ===== 通用纯函数（pytest 可直接复用，不依赖 app 导入）=====


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bytes_sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


# SQLite 的运行时边车：内容随连接/共享内存变化，不是用户数据。核对"旧文件没被改动"
# 时必须排除它们，否则一条只读查询都会让 -shm 变成另一个字节序列。
_SQLITE_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")


def tree_fingerprints(root: Path, *, ignore_sqlite_sidecars: bool = False) -> dict[str, str]:
    """目录树里每个文件的相对路径 -> sha256（只读，不跟随符号链接）。"""
    table: dict[str, str] = {}
    if not root.exists():
        return table
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if ignore_sqlite_sidecars and path.name.endswith(_SQLITE_SIDECAR_SUFFIXES):
            continue
        try:
            table[str(path.relative_to(root))] = file_sha256(path)
        except OSError:
            table[str(path.relative_to(root))] = "unreadable"
    return table


def changed_files(before: dict[str, str], after: dict[str, str]) -> list[str]:
    """返回被修改或删除的相对路径（新增文件不算）。"""
    return sorted(name for name, digest in before.items() if after.get(name) != digest)


def added_files(before: dict[str, str], after: dict[str, str]) -> list[str]:
    return sorted(set(after) - set(before))


def read_member(archive_path: Path, member: str) -> bytes:
    with zipfile.ZipFile(archive_path) as archive:
        return archive.read(member)


def read_json_member(archive_path: Path, member: str) -> dict[str, Any]:
    payload = json.loads(read_member(archive_path, member))
    if not isinstance(payload, dict):
        raise ValueError(f"{member} 不是 JSON 对象")
    return payload


def member_digest(archive_path: Path, member: str) -> tuple[int, str]:
    with zipfile.ZipFile(archive_path) as archive:
        info = archive.getinfo(member)
        digest = hashlib.sha256()
        size = 0
        with archive.open(info) as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                size += len(chunk)
                digest.update(chunk)
    return size, digest.hexdigest()


def member_contains(archive_path: Path, member: str, needle: bytes) -> bool:
    try:
        payload = read_member(archive_path, member)
    except KeyError:
        return False
    return needle in payload


def rewrite_zip(
    source: Path,
    destination: Path,
    *,
    replacements: dict[str, bytes] | None = None,
    removals: Iterable[str] = (),
) -> Path:
    """复制一个 zip 并按成员替换/删除；其它成员原样搬运。"""
    replacements = replacements or {}
    removed = set(removals)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with (
        zipfile.ZipFile(source) as src,
        zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as dst,
    ):
        for info in src.infolist():
            if info.filename in removed:
                continue
            if info.filename in replacements:
                dst.writestr(info.filename, replacements[info.filename])
            else:
                dst.writestr(info.filename, src.read(info))
    return destination


def rewrite_manifest(
    source: Path, destination: Path, mutate: Callable[[dict[str, Any]], None]
) -> Path:
    manifest = read_json_member(source, MANIFEST_MEMBER)
    mutate(manifest)
    payload = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    return rewrite_zip(source, destination, replacements={MANIFEST_MEMBER: payload})


def rewrite_database(
    source: Path, destination: Path, staging: Path, mutate: Callable[[Path], None]
) -> Path:
    """把包内数据库成员解到临时文件、交给 mutate 改动，再写回新包。"""
    staging.mkdir(parents=True, exist_ok=True)
    database = staging / f"tamper-{secrets.token_hex(4)}.db"
    database.write_bytes(read_member(source, DATABASE_MEMBER))
    mutate(database)
    return rewrite_zip(source, destination, replacements={DATABASE_MEMBER: database.read_bytes()})


def within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return False
    return True


class Drill:
    """收集检查结果：失败不中断，最后统一报告；重复的检查 id 视为脚本 bug。"""

    def __init__(self, phase: str) -> None:
        self.phase = phase
        self.checks: list[dict[str, Any]] = []
        self._keys: set[str] = set()

    def check(self, key: str, ok: bool, detail: str = "") -> None:
        if key in self._keys:
            raise SystemExit(f"R01 演练脚本 bug：重复的检查 id {key}")
        self._keys.add(key)
        self.checks.append({"key": key, "ok": bool(ok), "detail": "" if ok else detail})
        if not ok:
            print(f"[FAIL] {key} — {detail}", flush=True)

    @property
    def ok(self) -> bool:
        return all(item["ok"] for item in self.checks)

    def report(self) -> dict[str, Any]:
        passed = sum(1 for item in self.checks if item["ok"])
        return {
            "phase": self.phase,
            "ok": self.ok,
            "passed": passed,
            "total": len(self.checks),
            "checks": self.checks,
        }
