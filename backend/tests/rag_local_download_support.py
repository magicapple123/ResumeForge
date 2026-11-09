# SPDX-License-Identifier: Apache-2.0
"""本地资产下载测试的离线替身：假 httpx（可注入 404 / 连接错误）+ 合成清单 + 夹具。

两个测试文件共用这份替身：``test_rag_local_assets.py``（清单 + 状态机）与
``test_rag_local_download_sources.py``（"源失败 → 文案"的分类）。各抄一份的话，
"404 该说下载源不可用、连接错误才说网络不可用"这条契约会在两边慢慢漂移。

假传输层是**类属性**驱动的：``payloads`` 给字节，``failures`` 给失败注入
（HTTP 状态码，或一个异常实例）。:func:`build_asset_env` 每次重建两份字典，用例之间不会串味。

契约要点（都靠这里的替身钉住）：

- 替身只提供 ``Client`` 与 ``HTTPError``，**没有** ``HTTPStatusError``——生产代码必须靠
  鸭子类型读 ``exc.response.status_code``，直接引用 httpx 具体异常类型会整片红；
- HF 备用源是"一组文件"而不是"一个整包"：三个文件（含子目录里的
  ``1_Pooling/config.json``）必须全部到位。
"""

from __future__ import annotations

import hashlib
import threading
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.services.rag import rag_model_download as download

MODEL_ZIP_URL = "https://assets.test/model.zip"
RUNTIME_ZIP_URL = "https://assets.test/runtime.zip"
HF_BASE = "https://hf.test"

#: 清单里模型资产的三个文件：一个"大"的 + 两个小的，其中一个落在子目录。
#: （真实清单的 ``1_Pooling/config.json`` 正是子目录，用来钉住"相对路径要还原"。）
HF_PAYLOADS: dict[str, bytes] = {
    "onnx/tiny.onnx": b"fake-onnx" * 4096,
    "tokenizer.json": b'{"tokenizer": "tiny"}',
    "1_Pooling/config.json": b'{"pooling": "cls"}',
}
#: HF 上的路径 → 落盘后的相对路径（子目录必须保留）。
HF_TARGETS: dict[str, str] = {
    "onnx/tiny.onnx": "tiny.onnx",
    "tokenizer.json": "tokenizer.json",
    "1_Pooling/config.json": "1_Pooling/config.json",
}

RUNTIME_ENTRY = "site-packages/onnxruntime/__init__.py"
RUNTIME_ENTRY_BYTES = b'__version__ = "1.31.1"\n'

#: 夹具把两个版本目录钉在这两个相对路径上（monkeypatch 掉 model_dir / runtime_dir）。
MODEL_DIR_PARTS = ("rag-model", "tiny-int8_avx2")
RUNTIME_DIR_PARTS = ("rag-runtime", "ort-1.31.1")


def sha(data: bytes) -> str:
    """一段字节的 sha256（清单里就是同口径的小写十六进制）。"""
    return hashlib.sha256(data).hexdigest()


def zip_bytes(path: Path, entries: dict[str, bytes]) -> bytes:
    """现场造一个 zip 并返回其字节（内容与 sha256 全在用例控制内）。"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return path.read_bytes()


def model_files() -> list[dict[str, Any]]:
    """清单里 ``model.files`` 段（每次新造，用例改它不会污染别的用例）。"""
    return [
        {
            "path": upstream,
            "target": HF_TARGETS[upstream],
            "bytes": len(payload),
            "sha256": sha(payload),
        }
        for upstream, payload in HF_PAYLOADS.items()
    ]


def model_dir_of(tmp_path: Path) -> Path:
    """夹具里模型资产的最终目录。"""
    return tmp_path.joinpath("data", *MODEL_DIR_PARTS)


def runtime_dir_of(tmp_path: Path) -> Path:
    """夹具里运行时资产的最终目录。"""
    return tmp_path.joinpath("data", *RUNTIME_DIR_PARTS)


def fail_url(url: str, failure: int | Exception) -> None:
    """让某个 URL 失败。

    传状态码 → 抛带 ``response.status_code`` 的 HTTP 错误（404/503 都这么造）；
    传异常实例（见 :func:`network_failure`）→ 原样抛出，用来模拟"没有响应"的真网络错误。
    """
    _FakeClient.failures[url] = failure


def network_failure() -> Exception:
    """真网络错误的替身：HTTPError 但**没有** ``response``（连接/超时/DNS 就是这样）。"""
    return _FakeHTTPError(None)


def serve_url(url: str, payload: bytes) -> None:
    """替换某个 URL 的响应字节（造"坏包 / 坏 sha256"用）。"""
    _FakeClient.payloads[url] = payload


def hold_streams() -> threading.Event:
    """让下一次读流在第一个 chunk 之后卡住（测取消）；返回可置位的事件。"""
    _FakeClient.gate = threading.Event()
    return _FakeClient.gate


def wait_settled(timeout: float = 10.0) -> dict[str, Any]:
    """等下载线程收尾并返回最终进度快照（超时即失败，不静默放过）。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        progress = download.read_progress()
        if progress["state"] not in {"downloading", "verifying", "extracting"}:
            return progress
        time.sleep(0.01)
    raise AssertionError("下载线程在超时前没有收尾")


def disable_hf(monkeypatch) -> None:
    """关掉 HuggingFace 备用源：只验证整包源失败路径本身。"""
    monkeypatch.setattr(
        download,
        "get_settings",
        lambda: SimpleNamespace(rag_asset_base_url="https://assets.test", rag_asset_hf_base_url=""),
    )


class _FakeResponse:
    """假流式响应：按 chunk 吐字节，``gate`` 置位时卡在第一个 chunk 后（测取消）。"""

    def __init__(self, payload: bytes, client: _FakeClient) -> None:
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


class _FakeHTTPError(Exception):
    """替身 HTTPError：可带 ``response.status_code``（鸭子类型判定用）。

    ``status_code=None`` 表示"没有响应"——真实世界里的连接失败/超时/DNS 就是这个样子，
    生产代码必须仍然把它归到「网络不可用」。
    """

    def __init__(self, status_code: int | None = None) -> None:
        super().__init__(f"fake http error status={status_code}")
        self.response = None if status_code is None else SimpleNamespace(status_code=status_code)


class _FakeClient:
    """假 httpx.Client：``payloads`` 给字节，``failures`` 给失败注入。"""

    payloads: dict[str, bytes] = {}
    failures: dict[str, int | Exception] = {}
    gate: threading.Event | None = None

    def __init__(self, *_args, **_kwargs) -> None:
        self.closed = threading.Event()

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def stream(self, _method: str, url: str) -> _FakeResponse:
        failure = self.failures.get(url)
        if failure is not None:
            raise failure if isinstance(failure, Exception) else _FakeHTTPError(failure)
        payload = self.payloads.get(url)
        if payload is None:
            # 没登记的地址一律按 404：真实现场就是"Release 里没有这个资产"。
            raise _FakeHTTPError(404)
        return _FakeResponse(payload, self)

    def close(self) -> None:
        self.closed.set()


def build_asset_env(tmp_path, monkeypatch):
    """合成 manifest + 两个小 zip + 假 httpx；所有路径都指到 tmp（生成器，供夹具 yield from）。"""
    data = tmp_path / "data"
    onnx = HF_PAYLOADS["onnx/tiny.onnx"]
    model_zip = zip_bytes(
        tmp_path / "model.zip",
        {"tiny.onnx": onnx, "tokenizer.json": b"{}", "config.json": b"{}"},
    )
    runtime_zip = zip_bytes(tmp_path / "runtime.zip", {RUNTIME_ENTRY: RUNTIME_ENTRY_BYTES})
    assets = {
        "platform": "windows-x64",
        "variant": "int8_avx2",
        "ort_version": "1.31.1",
        "model": {
            "id": "tiny",
            "variant": "int8_avx2",
            "file": "model.zip",
            "bytes": len(model_zip),
            "sha256": sha(model_zip),
            "unpacked_bytes": 10_000,
            "dim": 8,
            "files": model_files(),
        },
        "runtime": {
            "file": "runtime.zip",
            "bytes": len(runtime_zip),
            "sha256": sha(runtime_zip),
            "unpacked_bytes": 5_000,
        },
    }
    _FakeClient.payloads = {
        MODEL_ZIP_URL: model_zip,
        RUNTIME_ZIP_URL: runtime_zip,
        **{f"{HF_BASE}/{path}": payload for path, payload in HF_PAYLOADS.items()},
    }
    _FakeClient.failures = {}
    _FakeClient.gate = None
    monkeypatch.setattr(download, "select_assets", lambda: assets)
    monkeypatch.setattr(download, "model_dir", lambda _v: data.joinpath(*MODEL_DIR_PARTS))
    monkeypatch.setattr(download, "runtime_dir", lambda _v: data.joinpath(*RUNTIME_DIR_PARTS))
    monkeypatch.setattr(download, "DATA_DIR", str(data))
    monkeypatch.setattr(
        download,
        "get_settings",
        lambda: SimpleNamespace(
            rag_asset_base_url="https://assets.test",
            rag_asset_hf_base_url=HF_BASE,
        ),
    )
    monkeypatch.setattr(
        download.archive, "httpx", SimpleNamespace(Client=_FakeClient, HTTPError=_FakeHTTPError)
    )
    download.reset_state()
    yield assets
    download.reset_state()
