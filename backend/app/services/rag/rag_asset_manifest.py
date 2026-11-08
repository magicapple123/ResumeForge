# SPDX-License-Identifier: Apache-2.0
"""本地 embedding 资产清单：文件名 / 大小 / sha256 / 适用平台 / 精确运行时版本。

**清单是唯一的事实来源**：下载地址由 ``Settings.rag_asset_base_url`` 拼出来（不写死在
清单里），镜像换地址不需要重新生成清单；但文件内容（大小 + sha256）一旦发布就不再改，
换模型/换 ORT/重新打包都必须同时更新清单与资产。

本轮平台矩阵（任务书 §3.1）：Windows x64 / macOS 14+ arm64 / Linux x86_64 / Linux aarch64
统一 onnxruntime 1.31.1。**macOS x64（Intel）没有任何现代 ORT wheel**：``platform_key()``
对它返回 None（``platform_label()`` 返回 "macos-x64"），``local_supported()`` 为 False，
设置页据此只允许远程 provider，不显示下载按钮。
"""

from __future__ import annotations

import hashlib
import json
import platform
import sys
from pathlib import Path
from typing import Any

#: 清单位置：``backend/app/data/rag-assets.json``（随源码发布；权重/运行时不进 git）。
ASSETS_MANIFEST_PATH = Path(__file__).resolve().parents[2] / "data" / "rag-assets.json"

MANIFEST_SCHEMA_VERSION = 1

#: 平台键 ↔ (sys.platform, machine) 的映射。**只列真正支持本地模型的组合**：
#: Windows arm64 与 macOS x64 都不在矩阵里，平台识别返回 None 由上层走远程。
_PLATFORM_KEYS: tuple[tuple[str, frozenset[str], str], ...] = (
    ("win32", frozenset({"amd64", "x86_64"}), "windows-x64"),
    ("darwin", frozenset({"arm64", "aarch64"}), "macos-arm64"),
    ("linux", frozenset({"x86_64", "amd64"}), "linux-x64"),
    ("linux", frozenset({"aarch64", "arm64"}), "linux-arm64"),
)

#: 识别得到但**不受支持**的平台显示名（Intel Mac 是产品级决定，不是漏配）。
_UNSUPPORTED_LABELS: tuple[tuple[str, frozenset[str], str], ...] = (
    ("darwin", frozenset({"x86_64", "amd64", "i386"}), "macos-x64"),
    ("win32", frozenset({"arm64", "aarch64"}), "windows-arm64"),
)


class AssetUnavailable(RuntimeError):
    """清单缺失/损坏，或当前平台没有可用资产。消息可直接展示给用户。"""


def load_manifest() -> dict[str, Any]:
    """读取并做最小结构校验；任何问题都转成可展示的 :class:`AssetUnavailable`。"""
    path = Path(ASSETS_MANIFEST_PATH)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise AssetUnavailable("本地 embedding 资产清单缺失") from exc
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise AssetUnavailable("本地 embedding 资产清单损坏") from exc
    if not isinstance(data, dict):
        raise AssetUnavailable("本地 embedding 资产清单损坏")
    for key in ("model", "runtime"):
        section = data.get(key)
        if not isinstance(section, dict):
            raise AssetUnavailable(f"本地 embedding 资产清单缺少 {key} 段")
    runtime = data["runtime"]
    if not isinstance(runtime.get("platforms"), dict) or not runtime.get("version"):
        raise AssetUnavailable("本地 embedding 资产清单缺少 runtime 平台表")
    return data


def _machine() -> str:
    return (platform.machine() or "").strip().casefold()


def _match(table: tuple[tuple[str, frozenset[str], str], ...]) -> str | None:
    system = (sys.platform or "").casefold()
    machine = _machine()
    for expected_system, machines, label in table:
        if system.startswith(expected_system) and machine in machines:
            return label
    return None


def platform_key() -> str | None:
    """当前平台的资产键（windows-x64 | macos-arm64 | linux-x64 | linux-arm64）。

    不在矩阵里的平台（macOS x64 / Windows arm64 / 未知系统）返回 None。
    """
    return _match(_PLATFORM_KEYS)


def platform_label() -> str:
    """当前平台的可展示标识；支持与不支持都给出稳定名字（用于状态与日志）。"""
    supported = platform_key()
    if supported is not None:
        return supported
    unsupported = _match(_UNSUPPORTED_LABELS)
    if unsupported is not None:
        return unsupported
    return f"unsupported-{(sys.platform or 'unknown').casefold()}-{_machine() or 'unknown'}"


def local_supported() -> bool:
    """当前平台能否跑本地模型（清单里有对应 runtime 才算支持）。"""
    key = platform_key()
    if key is None:
        return False
    try:
        platforms = load_manifest()["runtime"]["platforms"]
    except AssetUnavailable:
        return False
    return isinstance(platforms, dict) and key in platforms


def select_assets() -> dict[str, Any]:
    """当前平台的 {model, runtime} 资产描述；平台不支持或清单缺项抛 AssetUnavailable。"""
    key = platform_key()
    if key is None:
        raise AssetUnavailable(f"当前平台不支持本地模型（{platform_label()}）")
    manifest = load_manifest()
    runtime_table = manifest["runtime"]["platforms"]
    runtime = runtime_table.get(key)
    if not isinstance(runtime, dict):
        raise AssetUnavailable(f"资产清单没有当前平台的运行时（{key}）")
    return {
        "platform": key,
        "model": dict(manifest["model"]),
        "runtime": dict(runtime),
        "variant": str(manifest["model"].get("variant") or ""),
        "ort_version": str(manifest["runtime"].get("version") or ""),
    }


def asset_total_bytes() -> int:
    """当前平台首次下载总字节（模型包 + 运行时包）；平台不支持返回 0。"""
    try:
        assets = select_assets()
    except AssetUnavailable:
        return 0
    return _bytes(assets["model"]) + _bytes(assets["runtime"])


def _bytes(asset: dict[str, Any]) -> int:
    try:
        return max(0, int(asset.get("bytes") or 0))
    except (TypeError, ValueError):
        return 0


def verify_file(path: Path, expected_sha256: str) -> bool:
    """按 sha256 校验一个已落盘文件；不存在/读不了/不匹配一律 False（不抛）。"""
    expected = (expected_sha256 or "").strip().casefold()
    if not expected:
        return False
    digest = hashlib.sha256()
    try:
        with Path(path).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return False
    return digest.hexdigest() == expected


def runtime_package_versions() -> dict[str, str]:
    """清单里登记的运行时精确依赖版本（用于导入后做版本自检）。"""
    manifest = load_manifest()
    packages = manifest["runtime"].get("packages")
    if not isinstance(packages, dict):
        return {}
    return {str(name): str(version) for name, version in packages.items()}


__all__ = [
    "ASSETS_MANIFEST_PATH",
    "MANIFEST_SCHEMA_VERSION",
    "AssetUnavailable",
    "asset_total_bytes",
    "load_manifest",
    "local_supported",
    "platform_key",
    "platform_label",
    "runtime_package_versions",
    "select_assets",
    "verify_file",
]
