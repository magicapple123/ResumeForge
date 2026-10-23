# SPDX-License-Identifier: Apache-2.0
"""内置思源黑体的按需下载：成功、校验失败、并发 409、磁盘不足 507、删除。

**一条真实网络请求都没有**：下载走 ``httpx.Client``，这里把它换成假客户端，喂进
与 ``BUILTIN_FILES`` 声明的字节数/sha256 一致的假字体。真实下载能不能成功是 CDN 的
事，这个模块要保证的是"落盘之后状态对不对、失败之后有没有留下垃圾"——那才是用户
会遇到的那几种坏情况。

假文件同时把 ``BUILTIN_FILES`` 换掉：真字体 16MB，测试里造不出来（也不该造）。
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.services import resume_font_builtin, user_fonts
from app.services.resume_font_builtin import (
    FontBusy,
    FontDiskFull,
    FontNotDownloaded,
    delete,
    downloaded_names,
    fonts_dir,
    reset_state,
    start_download,
    status,
    total_bytes,
)


def _entry(role: str, name: str, data: bytes) -> dict:
    return {
        "role": role,
        "name": name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


REGULAR_BYTES = b"R" * 4096
BOLD_BYTES = b"B" * 2048


class _FakeResponse:
    """``client.stream("GET", url)`` 的返回值：可当上下文管理器，逐块吐字节。"""

    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_bytes(self, chunk_size: int):
        for start in range(0, len(self._payload), chunk_size):
            yield self._payload[start : start + chunk_size]


class _FakeClient:
    def __init__(self, *_args, **_kwargs) -> None:
        self.payloads = _FakeClient.payloads

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def stream(self, _method: str, url: str) -> _FakeResponse:
        return _FakeResponse(self.payloads[url])

    payloads: dict[str, bytes] = {}


class _FakeHTTPError(Exception):
    """替身用的 httpx.HTTPError 基类（只需要能被 except 到）。"""


@pytest.fixture(autouse=True)
def fake_env(tmp_path, monkeypatch):
    """字体目录、文件清单、httpx 全部换成假的；每个用例从干净状态开始。"""
    monkeypatch.setattr(resume_font_builtin, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    files = (
        _entry("regular", "Fake-Regular.otf", REGULAR_BYTES),
        _entry("bold", "Fake-Bold.otf", BOLD_BYTES),
    )
    monkeypatch.setattr(resume_font_builtin, "BUILTIN_FILES", files)
    _FakeClient.payloads = {
        f"{resume_font_builtin.BASE_URL}{item['name']}": data
        for item, data in zip(files, (REGULAR_BYTES, BOLD_BYTES), strict=True)
    }
    monkeypatch.setattr(
        resume_font_builtin,
        "httpx",
        SimpleNamespace(
            Client=_FakeClient, Timeout=lambda **kwargs: kwargs, HTTPError=_FakeHTTPError
        ),
    )
    reset_state()
    yield
    reset_state()


def _wait_until_settled(timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = status()
        if current["state"] != "downloading":
            return current
        time.sleep(0.01)
    raise AssertionError("下载线程在超时前没有结束")


def test_download_writes_both_files_and_marks_done(tmp_path):
    start_download()
    final = _wait_until_settled()

    assert final["state"] == "done"
    assert final["downloaded"] is True
    assert final["downloaded_bytes"] == final["total_bytes"] == total_bytes()
    assert final["error"] == ""
    assert downloaded_names() == ["Fake-Regular.otf", "Fake-Bold.otf"]
    assert (fonts_dir() / "Fake-Regular.otf").read_bytes() == REGULAR_BYTES
    assert (fonts_dir() / "Fake-Bold.otf").read_bytes() == BOLD_BYTES
    # 临时文件一个都不许留下。
    assert list(Path(fonts_dir()).glob("*.tmp")) == []


def test_status_reports_idle_before_any_download():
    current = status()
    assert current["state"] == "idle"
    assert current["downloaded"] is False
    assert current["downloaded_bytes"] == 0
    assert current["id"] == resume_font_builtin.FONT_ID
    assert current["label"] == "思源黑体"


def test_checksum_mismatch_fails_and_leaves_no_tmp_files(monkeypatch):
    """哈希对不上就整批失败：不能留半份字体，也不能留下 .tmp。"""
    bad = (
        _entry("regular", "Fake-Regular.otf", REGULAR_BYTES),
        {**_entry("bold", "Fake-Bold.otf", BOLD_BYTES), "sha256": "0" * 64},
    )
    monkeypatch.setattr(resume_font_builtin, "BUILTIN_FILES", bad)

    start_download()
    final = _wait_until_settled()

    assert final["state"] == "failed"
    assert final["downloaded"] is False
    assert final["error"] == "校验失败，文件不完整"
    assert list(Path(fonts_dir()).glob("*.tmp")) == []
    # 失败时把本轮已落地的另一半也清掉：只留一半（Regular 在、Bold 不在）毫无价值。
    assert downloaded_names() == []
    assert user_fonts.active_font_name() is None


def test_second_download_is_rejected_while_one_is_running():
    # 直接把状态摆成"正在下载"：真实并发很难稳定复现，而这条判断只读这个状态。
    resume_font_builtin._state["state"] = "downloading"

    with pytest.raises(FontBusy):
        start_download()


def test_disk_space_precheck_blocks_the_download(monkeypatch):
    monkeypatch.setattr(
        resume_font_builtin.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(total=10, used=9, free=10),
    )

    with pytest.raises(FontDiskFull):
        start_download()
    assert status()["state"] == "idle"


def test_delete_removes_both_files_and_resets_status():
    start_download()
    _wait_until_settled()

    removed = delete()

    assert set(removed) == {"Fake-Regular.otf", "Fake-Bold.otf"}
    assert downloaded_names() == []
    assert status()["state"] == "idle"
    assert status()["downloaded"] is False


def test_delete_without_download_raises_not_downloaded():
    with pytest.raises(FontNotDownloaded):
        delete()


def test_retry_after_failure_clears_the_previous_error(monkeypatch):
    bad = (
        _entry("regular", "Fake-Regular.otf", REGULAR_BYTES),
        {**_entry("bold", "Fake-Bold.otf", BOLD_BYTES), "sha256": "0" * 64},
    )
    monkeypatch.setattr(resume_font_builtin, "BUILTIN_FILES", bad)
    start_download()
    assert _wait_until_settled()["state"] == "failed"

    # 换回正确的清单再下一次：error 必须清空，状态回到 done。
    monkeypatch.setattr(
        resume_font_builtin,
        "BUILTIN_FILES",
        (
            _entry("regular", "Fake-Regular.otf", REGULAR_BYTES),
            _entry("bold", "Fake-Bold.otf", BOLD_BYTES),
        ),
    )
    start_download()
    final = _wait_until_settled()
    assert final["state"] == "done"
    assert final["error"] == ""


def test_api_download_endpoint_returns_202_and_reaches_done(client):
    response = client.post("/api/settings/fonts/builtin/download")
    assert response.status_code == 202, response.text
    assert response.json()["state"] in {"downloading", "done", "idle"}

    final = _wait_until_settled()
    assert final["state"] == "done"

    polled = client.get("/api/settings/fonts/builtin/download")
    assert polled.status_code == 200
    assert polled.json()["downloaded"] is True
    # 下载完成后 Regular 自动成为当前字体（用户点一次下载就该能直接导出）。
    assert user_fonts.active_font_name() == "Fake-Regular.otf"


def test_api_download_endpoint_maps_busy_to_409(client):
    resume_font_builtin._state["state"] = "downloading"
    response = client.post("/api/settings/fonts/builtin/download")
    assert response.status_code == 409
    assert response.json()["detail"] == "字体正在下载中"


def test_api_download_endpoint_maps_disk_full_to_507(client, monkeypatch):
    monkeypatch.setattr(
        resume_font_builtin.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(total=10, used=9, free=10),
    )
    response = client.post("/api/settings/fonts/builtin/download")
    assert response.status_code == 507
    assert response.json()["detail"] == "磁盘空间不足，无法保存字体"


def test_api_delete_maps_missing_to_404(client):
    assert client.delete("/api/settings/fonts/builtin").status_code == 404


def test_api_delete_clears_the_active_choice(client):
    client.post("/api/settings/fonts/builtin/download")
    _wait_until_settled()
    # 前端是靠轮询这条 GET 拿到"下载完成"的，设为当前字体也发生在那一刻（见 _ensure_active）。
    assert client.get("/api/settings/fonts/builtin/download").json()["downloaded"] is True
    assert user_fonts.active_font_name() == "Fake-Regular.otf"

    assert client.delete("/api/settings/fonts/builtin").status_code == 204
    assert user_fonts.active_font_name() is None


def test_api_status_endpoint_reports_the_builtin_entry(client):
    body = client.get("/api/settings/fonts/builtin").json()
    assert body["label"] == "思源黑体"
    assert body["downloaded"] is False
    assert body["total_bytes"] == total_bytes()
