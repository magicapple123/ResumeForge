# SPDX-License-Identifier: Apache-2.0
"""本地 embedding 资产层测试：清单 / 平台选择 / sha256 / 下载状态机 / 安全解包。

全部离线：假 httpx 与合成清单来自 ``rag_local_download_support``（zip 都在 tmp 里现造），
不下载真实权重、不联网、不 import 真实 onnxruntime（用 tmp site-packages 里的小 stub）。

"主源失败 → HF 逐文件备用 / HTTP 状态码文案"那一组用例在
``test_rag_local_download_sources.py``（2026-11 按行数预算拆分，共用同一份夹具与假传输层）。
"""

from __future__ import annotations

import sys
import time
from types import SimpleNamespace

import pytest
from app.services.rag import rag_asset_manifest as manifest
from app.services.rag import rag_model_download as download
from rag_local_download_support import (
    HF_PAYLOADS,
    HF_TARGETS,
    MODEL_ZIP_URL,
    RUNTIME_ENTRY,
    RUNTIME_ZIP_URL,
    build_asset_env,
    disable_hf,
    hold_streams,
    model_dir_of,
    runtime_dir_of,
    serve_url,
    sha,
    wait_settled,
    zip_bytes,
)


@pytest.fixture
def asset_env(tmp_path, monkeypatch):
    """共享夹具（实现在 ``rag_local_download_support``，两个测试文件同一份）。"""
    yield from build_asset_env(tmp_path, monkeypatch)


# ===== 清单与平台选择 =====


def test_real_manifest_is_present_and_complete():
    assert manifest.ASSETS_MANIFEST_PATH.is_file()
    assert manifest.ASSETS_MANIFEST_PATH.stat().st_size > 0
    data = manifest.load_manifest()
    assert data["model"]["id"] == "granite-embedding-97m-multilingual-r2"
    assert len(data["model"]["sha256"]) == 64
    assert set(data["runtime"]["platforms"]) == {
        "windows-x64",
        "macos-arm64",
        "linux-x64",
        "linux-arm64",
    }
    assert "macos-x64" in data["unsupported_platforms"]
    assert manifest.verify_file(
        manifest.ASSETS_MANIFEST_PATH, sha(manifest.ASSETS_MANIFEST_PATH.read_bytes())
    )


@pytest.mark.parametrize(
    ("system", "machine", "expected"),
    [
        ("win32", "AMD64", "windows-x64"),
        ("darwin", "arm64", "macos-arm64"),
        ("linux", "x86_64", "linux-x64"),
        ("linux", "aarch64", "linux-arm64"),
        ("darwin", "x86_64", None),
        ("win32", "ARM64", None),
        ("freebsd", "amd64", None),
    ],
)
def test_platform_selection_matrix(monkeypatch, system, machine, expected):
    monkeypatch.setattr(sys, "platform", system)
    monkeypatch.setattr(manifest.platform, "machine", lambda: machine)
    assert manifest.platform_key() == expected
    assert manifest.local_supported() is (expected is not None)


def test_verify_file_rejects_missing_and_mismatch(tmp_path):
    path = tmp_path / "asset.bin"
    path.write_bytes(b"payload")
    assert manifest.verify_file(path, sha(b"payload")) is True
    assert manifest.verify_file(path, "0" * 64) is False
    assert manifest.verify_file(tmp_path / "missing.bin", sha(b"payload")) is False


# ===== 下载状态机（假 httpx + 现造 zip） =====


def test_download_success_extracts_both_assets(asset_env, tmp_path):  # noqa: ARG001
    download.start_download()
    final = wait_settled()
    assert final["state"] == "ready"
    assert final["progress"] == 1.0
    model = model_dir_of(tmp_path)
    assert (model / "tiny.onnx").read_bytes() == HF_PAYLOADS["onnx/tiny.onnx"]
    assert (runtime_dir_of(tmp_path) / RUNTIME_ENTRY).is_file()
    assert list((tmp_path / "data").rglob("*.tmp*")) == []


def test_checksum_mismatch_fails_without_residue(asset_env, monkeypatch, tmp_path):
    disable_hf(monkeypatch)
    asset_env["model"]["sha256"] = "0" * 64
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert "校验失败" in final["error"]
    assert list((tmp_path / "data").rglob("*.tmp*")) == []
    assert not model_dir_of(tmp_path).exists()


def test_broken_zip_fails_readably(asset_env, tmp_path):
    serve_url(RUNTIME_ZIP_URL, b"not-a-zip")
    asset_env["runtime"]["sha256"] = sha(b"not-a-zip")
    asset_env["runtime"]["bytes"] = len(b"not-a-zip")
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert "损坏" in final["error"]


def test_zip_traversal_is_rejected(asset_env, monkeypatch, tmp_path):
    disable_hf(monkeypatch)
    evil = zip_bytes(tmp_path / "evil.zip", {"../evil.txt": b"pwn"})
    serve_url(MODEL_ZIP_URL, evil)
    asset_env["model"]["sha256"] = sha(evil)
    asset_env["model"]["bytes"] = len(evil)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert "路径穿越" in final["error"]
    assert not (tmp_path / "data" / "evil.txt").exists()


def test_huggingface_fallback_downloads_every_model_file(asset_env, tmp_path):  # noqa: ARG001
    """主源坏掉后必须**逐文件全下完**（曾经的 bug：只下第一个就算完成）。"""
    serve_url(MODEL_ZIP_URL, b"corrupted")
    download.start_download()
    final = wait_settled()
    assert final["state"] == "ready"
    model = model_dir_of(tmp_path)
    for upstream, payload in HF_PAYLOADS.items():
        target = model.joinpath(*HF_TARGETS[upstream].split("/"))
        assert target.read_bytes() == payload, f"缺少或字节不对：{upstream}"


def test_cancel_mid_download_returns_idle(asset_env, tmp_path):
    hold_streams()
    served = b"x" * (256 * 1024)
    serve_url(MODEL_ZIP_URL, served)
    asset_env["model"]["bytes"] = len(served)
    asset_env["model"]["sha256"] = sha(served)
    download.start_download()
    deadline = time.monotonic() + 5
    while download.read_progress()["downloaded_bytes"] <= 0 and time.monotonic() < deadline:
        time.sleep(0.01)
    final = download.cancel_download()
    assert final["state"] == "idle"
    assert list((tmp_path / "data").rglob("*.tmp*")) == []


def test_delete_assets_removes_only_version_dirs(asset_env, tmp_path):  # noqa: ARG001
    download.start_download()
    assert wait_settled()["state"] == "ready"
    removed = download.delete_assets()
    assert removed and download.read_progress()["state"] == "idle"
    assert not model_dir_of(tmp_path).exists()


def test_disk_full_is_blocked_before_download(asset_env, monkeypatch):  # noqa: ARG001
    monkeypatch.setattr(download.shutil, "disk_usage", lambda _path: SimpleNamespace(free=1024))
    with pytest.raises(download.DownloadError, match="磁盘"):
        download.start_download()
