# SPDX-License-Identifier: Apache-2.0
"""核对本地语义检索（RAG）资源的分发契约。

本地 embedding 的权重与运行时**不随应用安装包/源码包分发**（默认关闭、按需下载），
它们挂在仓库里一个独立的资源 Release 上，地址由 ``config.rag_asset_base_url`` 指向，
文件名 / 大小 / sha256 由 ``backend/app/data/rag-assets.json`` 钉死。

这个脚本就是那条链路的体检：

    python scripts/check_rag_assets.py              # 离线：清单自洽 + 与 config 的地址一致
    python scripts/check_rag_assets.py --online     # 另外逐个 HEAD，核对 HTTP 200 与体积
    python scripts/check_rag_assets.py --dist       # 另外核对 dist/rag-assets/ 里的实体文件

**为什么需要它**：2026-11-10 发布 2.1.0 时发现 ``config`` 指向的 ``rag-assets-v1``
Release 根本不存在（模型与运行时都 404），而代码、测试、CI 全绿——因为「Release 存在性」
是仓库外部的事实，离线测试证明不了，只能靠发布前后的显式体检。运行时的包没有 HuggingFace
逐文件备用源，这个 Release 一旦缺失，本地语义检索就是完全不可用的。

CI 不跑 ``--online``：它依赖公网与 GitHub，抖动会被误判成仓库坏了。放在发布清单里人工执行。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
MANIFEST_PATH = BACKEND_DIR / "app" / "data" / "rag-assets.json"
DIST_DIR = REPO_ROOT / "dist" / "rag-assets"

# 与 backend/tests/test_rag_local_assets.py 同一份预期：新增平台要两边一起改。
EXPECTED_PLATFORMS = ("windows-x64", "macos-arm64", "linux-x64", "linux-arm64")

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _fail(problems: list[str], message: str) -> None:
    problems.append(message)
    print(f"  FAIL  {message}")


def _asset_base_url() -> str:
    """当前生效的下载根地址（含 tag）。"""
    from app.config import get_settings

    return str(get_settings().rag_asset_base_url or "").rstrip("/")


def _release_tag(base_url: str) -> str:
    """``.../releases/download/<tag>`` 里的 tag；认不出来时返回空串。"""
    marker = "/releases/download/"
    if marker not in base_url:
        return ""
    return base_url.split(marker, 1)[1].split("/", 1)[0]


def _expected_files(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    files = {str(manifest["model"]["file"]): manifest["model"]}
    for platform, info in manifest["runtime"]["platforms"].items():
        files[str(info["file"])] = dict(info, platform=platform)
    return files


def check_manifest(problems: list[str]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    print("=== 1. 清单自洽 ===")
    if not MANIFEST_PATH.is_file():
        _fail(problems, f"清单不存在：{MANIFEST_PATH}")
        return {}, {}
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    print(
        f"  schema_version = {manifest.get('schema_version')}  generated_at = {manifest.get('generated_at')}"
    )

    for label, entry in (
        ("model", manifest.get("model")),
        *manifest.get("runtime", {}).get("platforms", {}).items(),
    ):
        if not isinstance(entry, dict):
            _fail(problems, f"{label} 段缺失")
            continue
        name = str(entry.get("file") or "")
        if not name.endswith(".zip"):
            _fail(problems, f"{label} 的 file 不是 zip：{name!r}")
        digest = str(entry.get("sha256") or "")
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            _fail(problems, f"{label} 的 sha256 不是 64 位小写十六进制：{digest!r}")
        if int(entry.get("bytes") or 0) <= 0:
            _fail(problems, f"{label} 的 bytes 缺失或非正数")

    platforms = tuple(manifest.get("runtime", {}).get("platforms", {}))
    if set(platforms) != set(EXPECTED_PLATFORMS):
        _fail(problems, f"runtime 平台集合是 {platforms}，期望 {EXPECTED_PLATFORMS}")

    files = _expected_files(manifest) if manifest else {}
    if not problems:
        print(f"  OK    {len(files)} 个分发包（模型 1 + 运行时 {len(platforms)}）")
    return manifest, files


def check_base_url(problems: list[str], files: dict[str, dict[str, Any]]) -> str:
    print("=== 2. 下载地址 ===")
    base = _asset_base_url()
    tag = _release_tag(base)
    print(f"  base = {base}")
    if not tag:
        _fail(
            problems, "rag_asset_base_url 里认不出 release tag（形如 .../releases/download/<tag>）"
        )
        return base
    print(f"  tag  = {tag}（{len(files)} 个资产应挂在这里）")
    return base


def _head(url: str) -> tuple[int, int]:
    """HEAD 一次，返回 (status, Content-Length)。重定向由 urllib 自动跟随。

    重试一次：大文件会 302 到 objects.githubusercontent.com，偶发 SSL 握手 EOF
    （2026-11-10 实测过一次），那是网络抖动而不是资产坏了——体检脚本不该因此报警。
    """
    last: Exception | None = None
    for attempt in range(2):
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "rf-rag-check"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, int(response.headers.get("Content-Length") or 0)
        except urllib.error.HTTPError:
            raise
        except Exception as exc:  # noqa: BLE001 - 网络类错误统一重试后报出
            last = exc
            if attempt == 0:
                time.sleep(1.5)
    assert last is not None
    raise last


def check_online(problems: list[str], base: str, files: dict[str, dict[str, Any]]) -> None:
    print("=== 3. Release 在线可达性（--online）===")
    for name, entry in sorted(files.items()):
        url = f"{base}/{name}"
        try:
            status, length = _head(url)
        except urllib.error.HTTPError as exc:
            hint = "该 Release 或资产不存在" if exc.code == 404 else "上游返回错误"
            _fail(problems, f"{name} → HTTP {exc.code}（{hint}）：{url}")
            continue
        except Exception as exc:  # noqa: BLE001 - 网络问题一律算体检失败
            _fail(problems, f"{name} → 请求失败（{exc}）")
            continue
        expected = int(entry.get("bytes") or 0)
        if status != 200:
            _fail(problems, f"{name} → HTTP {status}")
        elif length and length != expected:
            _fail(problems, f"{name} → 线上 {length} B，清单写 {expected} B")
        else:
            print(f"  OK    {name}  {length or '?'} B")


def check_dist(problems: list[str], files: dict[str, dict[str, Any]]) -> None:
    print("=== 4. 本地构建产物（--dist）===")
    if not DIST_DIR.is_dir():
        print(f"  跳过：{DIST_DIR} 不存在（先跑 scripts/build_rag_assets.py）")
        return
    present = {path.name for path in DIST_DIR.glob("*.zip")}
    missing = sorted(set(files) - present)
    extra = sorted(present - set(files))
    for name in missing:
        _fail(problems, f"dist/rag-assets 缺少 {name}")
    for name in extra:
        _fail(problems, f"dist/rag-assets 里有多余文件 {name}（清单没登记，别上传）")
    for name in sorted(set(files) & present):
        path = DIST_DIR / name
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        expected = str(files[name].get("sha256") or "")
        if digest != expected:
            _fail(problems, f"{name} 的 sha256 与清单不符（重新构建，别手改清单）")
        elif path.stat().st_size != int(files[name].get("bytes") or 0):
            _fail(problems, f"{name} 的体积与清单不符")
        else:
            print(f"  OK    {name}  {path.stat().st_size} B")


def main() -> int:
    parser = argparse.ArgumentParser(description="核对本地语义检索资源的分发契约")
    parser.add_argument("--online", action="store_true", help="逐个 HEAD 资源地址，核对 200 与体积")
    parser.add_argument("--dist", action="store_true", help="另外核对 dist/rag-assets/ 的实体文件")
    args = parser.parse_args()

    problems: list[str] = []
    _, files = check_manifest(problems)
    base = check_base_url(problems, files)
    if files and args.online:
        check_online(problems, base, files)
    if files and args.dist:
        check_dist(problems, files)

    print()
    if problems:
        print(f"FAILED：{len(problems)} 个问题")
        return 1
    print(
        "OK：清单、地址"
        + ("、线上资产" if args.online else "")
        + ("、本地产物" if args.dist else "")
        + " 一致"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
