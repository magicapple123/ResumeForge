# SPDX-License-Identifier: Apache-2.0
"""本地资产"源失败 → 文案"分类（2026-11 修复批）：404 不等于网络不可用。

真实现场：``rag-assets-v1`` 这个 Release 从来没发布过，两个下载 URL 都是 HTTP 404，但设置页
报的是「网络不可用」，用户于是去查网络——而真正要等的是资产发布。这里钉住三件事：

1. 4xx/5xx 与连接失败必须给不同原因（可判定的关键词：``下载源不可用`` / ``网络不可用``）；
2. HuggingFace 备用源是"一组文件"，必须**全有或全无**——任一文件失败就整体判失败，
   且最终目录不存在、不留任何 ``*.tmp*``（否则 ``assets_present()`` 会把半份目录当就绪）；
3. 逐个文件下载时进度不许回退，也不许中途假到 100%（分母要跟着抬高）。

夹具与假传输层在 ``rag_local_download_support``（与 test_rag_local_assets.py 共用）。
"""

from __future__ import annotations

import pytest
from app.services.rag import rag_model_download as download
from rag_local_download_support import (
    HF_BASE,
    HF_PAYLOADS,
    HF_TARGETS,
    MODEL_ZIP_URL,
    RUNTIME_DIR_PARTS,
    RUNTIME_ZIP_URL,
    build_asset_env,
    disable_hf,
    fail_url,
    model_dir_of,
    network_failure,
    runtime_dir_of,
    wait_settled,
)

#: 期望文案里的可判定关键词（前端 ``embeddingGuidanceKey`` 也按「下载源」归类）。
SOURCE_UNAVAILABLE = "下载源不可用"
NETWORK_UNAVAILABLE = "网络不可用"

#: 采样到的进度快照（每个用例开始前由 ``_record_progress`` 清空）。
_PROGRESS: list[float] = []


@pytest.fixture
def asset_env(tmp_path, monkeypatch):
    """共享夹具（实现在 ``rag_local_download_support``，两个测试文件同一份）。"""
    yield from build_asset_env(tmp_path, monkeypatch)


def _record_progress(monkeypatch) -> None:
    """在每次累计字节之后采样一次进度，用来断言单调性与"不许中途 100%"。"""
    original = download._bump  # noqa: SLF001 - 采样点只能挂在私有累计函数上

    def bump(delta: int) -> None:
        original(delta)
        _PROGRESS.append(download.read_progress()["progress"])

    monkeypatch.setattr(download, "_bump", bump)
    _PROGRESS.clear()


def test_primary_source_unavailable_falls_back_to_every_hf_file(asset_env, tmp_path):  # noqa: ARG001
    """整包 404（真实现场）→ 改走 HF 逐文件，并真的把三个文件全部落盘。"""
    fail_url(MODEL_ZIP_URL, 404)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "ready", final
    model = model_dir_of(tmp_path)
    for upstream, payload in HF_PAYLOADS.items():
        target = model.joinpath(*HF_TARGETS[upstream].split("/"))
        assert target.read_bytes() == payload, f"缺少或字节不对：{upstream}"
    assert list((tmp_path / "data").rglob("*.tmp*")) == []


def test_hf_single_file_missing_fails_without_partial_directory(asset_env, tmp_path):  # noqa: ARG001
    """三个文件下到第二个就 404：整体判失败，最终目录**不存在**（绝不能留半份）。"""
    fail_url(MODEL_ZIP_URL, 404)
    fail_url(f"{HF_BASE}/tokenizer.json", 404)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert SOURCE_UNAVAILABLE in final["error"], final["error"]
    assert not model_dir_of(tmp_path).exists()
    # 连空壳父目录也不能留（fetch 在读流前就 mkdir 了它）。
    assert not model_dir_of(tmp_path).parent.exists()
    assert (tmp_path / "data").is_dir(), "DATA_DIR 必须保留"
    assert list((tmp_path / "data").rglob("*.tmp*")) == []


def test_primary_404_without_hf_says_source_unavailable(asset_env, monkeypatch):  # noqa: ARG001
    """没有 HF 备用源时，404 只报"下载源不可用"，绝不能甩锅给网络。"""
    disable_hf(monkeypatch)
    fail_url(MODEL_ZIP_URL, 404)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert SOURCE_UNAVAILABLE in final["error"], final["error"]
    assert NETWORK_UNAVAILABLE not in final["error"]


def test_runtime_package_404_says_source_unavailable(asset_env):  # noqa: ARG001
    """运行时包没有 HF 备用源：404 同样必须报"下载源不可用"。"""
    fail_url(RUNTIME_ZIP_URL, 404)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert SOURCE_UNAVAILABLE in final["error"], final["error"]
    assert NETWORK_UNAVAILABLE not in final["error"]


def test_connect_error_still_says_network_unavailable(asset_env, monkeypatch):  # noqa: ARG001
    """连接失败/超时（没有 response）仍然报"网络不可用"——防过度泛化。"""
    disable_hf(monkeypatch)
    fail_url(MODEL_ZIP_URL, network_failure())
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert NETWORK_UNAVAILABLE in final["error"], final["error"]
    assert SOURCE_UNAVAILABLE not in final["error"]


def test_server_error_reports_status_code(asset_env, monkeypatch):  # noqa: ARG001
    """5xx 既不是"源不可用"也不是"网络不可用"，把状态码直接告诉用户。"""
    disable_hf(monkeypatch)
    fail_url(MODEL_ZIP_URL, 503)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert "HTTP 503" in final["error"], final["error"]
    assert NETWORK_UNAVAILABLE not in final["error"]


def test_hf_fallback_keeps_progress_monotonic(asset_env, monkeypatch):  # noqa: ARG001
    """逐文件下完全部文件时进度单调不回退，且 100% 只可能出现在最后一个字节。"""
    _record_progress(monkeypatch)
    fail_url(MODEL_ZIP_URL, 404)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "ready", final
    assert final["progress"] == 1.0
    assert _PROGRESS, "没有采到进度快照"
    assert all(0.0 <= value <= 1.0 for value in _PROGRESS), _PROGRESS
    assert sorted(_PROGRESS) == _PROGRESS, f"进度不能回退：{_PROGRESS}"
    at_full = [index for index, value in enumerate(_PROGRESS) if value >= 1.0]
    assert at_full in ([], [len(_PROGRESS) - 1]), f"100% 出现在中途（假进度）：{_PROGRESS}"


def test_hf_file_with_bad_sha256_fails_without_residue(asset_env, tmp_path):
    """逐文件路径自己也要校验 sha256：否则坏文件会直接落盘。"""
    fail_url(MODEL_ZIP_URL, 404)
    asset_env["model"]["files"][1]["sha256"] = "0" * 64
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert "校验失败" in final["error"], final["error"]
    assert not model_dir_of(tmp_path).exists()
    assert list((tmp_path / "data").rglob("*.tmp*")) == []


def test_runtime_404_keeps_model_directory_intact(asset_env, tmp_path):  # noqa: ARG001
    """模型成功后运行时 404：整体 failed，但已就绪的模型目录不许被半份运行时污染。"""
    fail_url(RUNTIME_ZIP_URL, 404)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert SOURCE_UNAVAILABLE in final["error"], final["error"]
    assert model_dir_of(tmp_path).is_dir()
    assert not runtime_dir_of(tmp_path).exists()
    assert list((tmp_path / "data").rglob("*.tmp*")) == []


def test_runtime_404_leaves_no_empty_runtime_parent(asset_env, tmp_path):  # noqa: ARG001
    """运行时的父目录 ``data/rag-runtime`` 也不能留空壳（QA 现场就是它留下来了）。"""
    fail_url(RUNTIME_ZIP_URL, 404)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert not (tmp_path / "data" / RUNTIME_DIR_PARTS[0]).exists()
    # 模型那半边是完整的，不能被连带回收。
    assert model_dir_of(tmp_path).is_dir()
    # DATA_DIR 本身必须保留：设置页与其它组件都依赖它存在。
    assert (tmp_path / "data").is_dir()


def test_model_404_leaves_no_empty_model_parent(asset_env, monkeypatch, tmp_path):  # noqa: ARG001
    """两个整包源与备用源都用不上时，``data/rag-model`` 也不许留空壳。"""
    disable_hf(monkeypatch)
    fail_url(MODEL_ZIP_URL, 404)
    download.start_download()
    final = wait_settled()
    assert final["state"] == "failed"
    assert not model_dir_of(tmp_path).parent.exists()
    assert (tmp_path / "data").is_dir()
    assert list((tmp_path / "data").rglob("*.tmp*")) == []
