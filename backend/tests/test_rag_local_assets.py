# SPDX-License-Identifier: Apache-2.0
"""本地 embedding 资产层测试：清单/平台选择/sha256/下载状态机/安全解包/运行时注入。

全部离线：HTTP 用本模块假的 ``httpx`` 替身（payload 字典），zip 用 tmp 目录里现造的小文件；
不下载真实权重、不联网、不 import 真实 onnxruntime（用 tmp site-packages 里的小 stub）。
"""

import hashlib
import sys
import threading
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.services.rag import rag_asset_manifest as manifest
from app.services.rag import rag_model_download as download


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _zip(path: Path, entries: dict[str, bytes]) -> bytes:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return path.read_bytes()


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
        manifest.ASSETS_MANIFEST_PATH, _sha(manifest.ASSETS_MANIFEST_PATH.read_bytes())
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
    assert manifest.verify_file(path, _sha(b"payload")) is True
    assert manifest.verify_file(path, "0" * 64) is False
    assert manifest.verify_file(tmp_path / "missing.bin", _sha(b"payload")) is False


# ===== 下载状态机（假 httpx + 现造 zip） =====


class _FakeResponse:
    def __init__(self, payload: bytes, client: "_FakeClient") -> None:
        self._payload = payload
        self._client = client

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_bytes(self, chunk_size: int):
        for start in range(0, len(self._payload), chunk_size):
            if self._client.closed.is_set():
                raise RuntimeError("closed")
            yield self._payload[start : start + chunk_size]
            if self._client.gate is not None:
                self._client.closed.wait(timeout=5)
                raise RuntimeError("closed")


class _FakeClient:
    payloads: dict[str, bytes] = {}
    gate: threading.Event | None = None

    def __init__(self, *_args, **_kwargs) -> None:
        self.closed = threading.Event()

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def stream(self, _method: str, url: str) -> _FakeResponse:
        return _FakeResponse(self.payloads[url], self)

    def close(self) -> None:
        self.closed.set()


class _FakeHTTPError(Exception):
    pass


@pytest.fixture
def asset_env(tmp_path, monkeypatch):
    """合成 manifest + 两个小 zip + 假 httpx；所有路径都指到 tmp。"""
    data = tmp_path / "data"
    model_zip_bytes = _zip(
        tmp_path / "model.zip",
        {"tiny.onnx": b"fake-onnx" * 64, "tokenizer.json": b"{}", "config.json": b"{}"},
    )
    runtime_zip_bytes = _zip(
        tmp_path / "runtime.zip",
        {"site-packages/onnxruntime/__init__.py": b'__version__ = "1.31.1"\n'},
    )
    model_file = {
        "path": "onnx/tiny.onnx",
        "target": "tiny.onnx",
        "bytes": 9 * 64,
        "sha256": _sha(b"fake-onnx" * 64),
    }
    assets = {
        "platform": "windows-x64",
        "variant": "int8_avx2",
        "ort_version": "1.31.1",
        "model": {
            "id": "tiny",
            "variant": "int8_avx2",
            "file": "model.zip",
            "bytes": len(model_zip_bytes),
            "sha256": _sha(model_zip_bytes),
            "unpacked_bytes": 10_000,
            "dim": 8,
            "files": [model_file],
        },
        "runtime": {
            "file": "runtime.zip",
            "bytes": len(runtime_zip_bytes),
            "sha256": _sha(runtime_zip_bytes),
            "unpacked_bytes": 5_000,
        },
    }
    _FakeClient.payloads = {
        "https://assets.test/model.zip": model_zip_bytes,
        "https://assets.test/runtime.zip": runtime_zip_bytes,
        "https://hf.test/onnx/tiny.onnx": b"fake-onnx" * 64,
    }
    _FakeClient.gate = None
    monkeypatch.setattr(download, "select_assets", lambda: assets)
    monkeypatch.setattr(download, "model_dir", lambda _v: data / "rag-model" / "tiny-int8_avx2")
    monkeypatch.setattr(download, "runtime_dir", lambda _v: data / "rag-runtime" / "ort-1.31.1")
    monkeypatch.setattr(download, "DATA_DIR", str(data))
    monkeypatch.setattr(
        download,
        "get_settings",
        lambda: SimpleNamespace(
            rag_asset_base_url="https://assets.test",
            rag_asset_hf_base_url="https://hf.test",
        ),
    )
    monkeypatch.setattr(
        download.archive, "httpx", SimpleNamespace(Client=_FakeClient, HTTPError=_FakeHTTPError)
    )
    download.reset_state()
    yield assets
    download.reset_state()


def _wait_settled(timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        progress = download.read_progress()
        if progress["state"] not in {"downloading", "verifying", "extracting"}:
            return progress
        time.sleep(0.01)
    raise AssertionError("下载线程在超时前没有收尾")


def test_download_success_extracts_both_assets(asset_env, tmp_path):
    download.start_download()
    final = _wait_settled()
    assert final["state"] == "ready"
    assert final["progress"] == 1.0
    model_dir = tmp_path / "data" / "rag-model" / "tiny-int8_avx2"
    assert (model_dir / "tiny.onnx").read_bytes() == b"fake-onnx" * 64
    assert (
        tmp_path
        / "data"
        / "rag-runtime"
        / "ort-1.31.1"
        / "site-packages"
        / "onnxruntime"
        / "__init__.py"
    ).is_file()
    assert list((tmp_path / "data").rglob("*.tmp*")) == []


def _no_hf(monkeypatch):
    """关掉 HuggingFace 备用源：只验证主源失败路径本身。"""
    monkeypatch.setattr(
        download,
        "get_settings",
        lambda: SimpleNamespace(rag_asset_base_url="https://assets.test", rag_asset_hf_base_url=""),
    )


def test_checksum_mismatch_fails_without_residue(asset_env, monkeypatch, tmp_path):
    _no_hf(monkeypatch)
    asset_env["model"]["sha256"] = "0" * 64
    download.start_download()
    final = _wait_settled()
    assert final["state"] == "failed"
    assert "校验失败" in final["error"]
    assert list((tmp_path / "data").rglob("*.tmp*")) == []
    assert not (tmp_path / "data" / "rag-model" / "tiny-int8_avx2").exists()


def test_broken_zip_fails_readably(asset_env, tmp_path):
    _FakeClient.payloads["https://assets.test/runtime.zip"] = b"not-a-zip"
    asset_env["runtime"]["sha256"] = _sha(b"not-a-zip")
    asset_env["runtime"]["bytes"] = len(b"not-a-zip")
    download.start_download()
    final = _wait_settled()
    assert final["state"] == "failed"
    assert "损坏" in final["error"]


def test_zip_traversal_is_rejected(asset_env, monkeypatch, tmp_path):
    _no_hf(monkeypatch)
    evil = _zip(tmp_path / "evil.zip", {"../evil.txt": b"pwn"})
    _FakeClient.payloads["https://assets.test/model.zip"] = evil
    asset_env["model"]["sha256"] = _sha(evil)
    asset_env["model"]["bytes"] = len(evil)
    download.start_download()
    final = _wait_settled()
    assert final["state"] == "failed"
    assert "路径穿越" in final["error"]
    assert not (tmp_path / "data" / "evil.txt").exists()


def test_huggingface_fallback_used_when_primary_corrupt(asset_env):
    _FakeClient.payloads["https://assets.test/model.zip"] = b"corrupted"
    download.start_download()
    final = _wait_settled()
    assert final["state"] == "ready"


def test_cancel_mid_download_returns_idle(asset_env, tmp_path):
    _FakeClient.gate = threading.Event()
    _FakeClient.payloads["https://assets.test/model.zip"] = b"x" * (256 * 1024)
    asset_env["model"]["bytes"] = 256 * 1024
    asset_env["model"]["sha256"] = _sha(b"x" * (256 * 1024))
    download.start_download()
    deadline = time.monotonic() + 5
    while download.read_progress()["downloaded_bytes"] <= 0 and time.monotonic() < deadline:
        time.sleep(0.01)
    final = download.cancel_download()
    assert final["state"] == "idle"
    assert list((tmp_path / "data").rglob("*.tmp*")) == []


def test_delete_assets_removes_only_version_dirs(asset_env, tmp_path):
    download.start_download()
    assert _wait_settled()["state"] == "ready"
    removed = download.delete_assets()
    assert removed and download.read_progress()["state"] == "idle"
    assert not (tmp_path / "data" / "rag-model" / "tiny-int8_avx2").exists()


def test_disk_full_is_blocked_before_download(asset_env, monkeypatch):
    monkeypatch.setattr(download.shutil, "disk_usage", lambda _path: SimpleNamespace(free=1024))
    with pytest.raises(download.DownloadError, match="磁盘"):
        download.start_download()
