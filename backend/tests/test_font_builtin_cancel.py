# SPDX-License-Identifier: Apache-2.0
"""内置字体下载的**取消**、**删除护栏**与 **``activate`` 开关**（P0-1 / P0-2 / P0-3 后端）。

**一条真实网络请求都没有**，也**没有 sleep 轮询竞态**：假 ``httpx.Client`` 每吐一块
之前先等一个 ``threading.Event``，于是测试能把下载**精确地停在任意位置**（第一块之前 /
Regular 已落盘、Bold 还在传），再调 ``cancel()``。取消的价值恰恰在"用户等不下去"
的那一刻，用 sleep 去撞那个时刻只会得到一条时灵时不灵的用例。

``close()`` 会同时置位"已关闭"并把所有闸门放行——真实 httpx 被 close 时，阻塞中的
``iter_bytes()`` 就是这样立刻抛错的（这里不模拟它的具体异常类型，因为实现只认
``_stop``，认对异常类型反而是把测试焊在 httpx 的内部类上）。
"""

from __future__ import annotations

import hashlib
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.services import resume_font_builtin, user_fonts
from app.services.resume_font_builtin import (
    FontBusy,
    FontDeleteError,
    delete,
    downloaded_names,
    fonts_dir,
    reset_state,
    start_download,
    status,
    total_bytes,
)

REGULAR_BYTES = b"R" * 4096
BOLD_BYTES = b"B" * 2048
# 闸门等待上限：只防"测试自己忘了放行"导致用例挂死，不参与任何断言。
GATE_TIMEOUT = 10.0


def _entry(role: str, name: str, data: bytes) -> dict:
    return {
        "role": role,
        "name": name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


FILES = (
    _entry("regular", "Fake-Regular.otf", REGULAR_BYTES),
    _entry("bold", "Fake-Bold.otf", BOLD_BYTES),
)


class _FakeHTTPError(Exception):
    """替身用的 httpx.HTTPError 基类（只需要能被 except 到）。"""


class _GatedResponse:
    """``client.stream(...)`` 的返回值：每块之前等对应 Url 的闸门。"""

    def __init__(self, url: str, payload: bytes, closed: threading.Event) -> None:
        self._url = url
        self._payload = payload
        self._closed = closed

    def __enter__(self) -> _GatedResponse:
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_bytes(self, chunk_size: int):
        for start in range(0, len(self._payload), chunk_size):
            _GatedClient.started.set()
            gate = _GatedClient.gates[self._url]
            if not gate.wait(GATE_TIMEOUT):
                raise AssertionError("测试没有放行下载，闸门超时")
            if self._closed.is_set():
                # 真实 httpx：close() 之后这一次读立刻炸。
                raise _FakeHTTPError("连接已被取消")
            yield self._payload[start : start + chunk_size]


class _GatedClient:
    """假客户端。类级状态与真实现共用同一份"进程内下载"，所以由 fixture 复位。

    ``payloads`` / ``gates`` 按 URL 分开：这样才能只放行 Regular、把 Bold 卡在半路。
    """

    payloads: dict[str, bytes] = {}
    gates: dict[str, threading.Event] = {}
    started = threading.Event()

    def __init__(self, *_args, **_kwargs) -> None:
        self._closed = threading.Event()

    def __enter__(self) -> _GatedClient:
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def stream(self, _method: str, url: str) -> _GatedResponse:
        return _GatedResponse(url, self.payloads[url], self._closed)

    def close(self) -> None:
        self._closed.set()
        for gate in _GatedClient.gates.values():
            gate.set()


@pytest.fixture(autouse=True)
def fake_env(tmp_path, monkeypatch):
    """字体目录、文件清单、httpx 全部换成假的；每个用例从干净状态开始。"""
    monkeypatch.setattr(resume_font_builtin, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(resume_font_builtin, "BUILTIN_FILES", FILES)
    _GatedClient.payloads = {
        f"{resume_font_builtin.BASE_URL}{item['name']}": data
        for item, data in zip(FILES, (REGULAR_BYTES, BOLD_BYTES), strict=True)
    }
    _GatedClient.gates = {url: threading.Event() for url in _GatedClient.payloads}
    _GatedClient.started.clear()
    monkeypatch.setattr(
        resume_font_builtin,
        "httpx",
        SimpleNamespace(
            Client=_GatedClient, Timeout=lambda **kwargs: kwargs, HTTPError=_FakeHTTPError
        ),
    )
    reset_state()
    yield
    reset_state()


def _gate(name: str) -> threading.Event:
    return _GatedClient.gates[f"{resume_font_builtin.BASE_URL}{name}"]


def _release_all() -> None:
    for gate in _GatedClient.gates.values():
        gate.set()


def _wait_started() -> None:
    assert _GatedClient.started.wait(GATE_TIMEOUT), "下载线程没有开始读第一块"


def _wait_until_settled(timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = status()
        if current["state"] != "downloading":
            return current
        time.sleep(0.01)
    raise AssertionError("下载线程在超时前没有结束")


def _assert_no_font_files_on_disk() -> None:
    """Regular + Bold 两个字面都断言：正式文件与 ``.tmp`` 一个都不许留。"""
    for item in FILES:
        name = str(item["name"])
        assert not (fonts_dir() / name).exists(), f"{name} 不该留在磁盘上"
        assert not (fonts_dir() / f"{name}.tmp").exists(), f"{name}.tmp 不该留在磁盘上"
    assert list(Path(fonts_dir()).glob("*.tmp")) == []


def _set_active_upload() -> str:
    """造一个"用户自己上传的"字体并设为当前，用于断言"取消不改当前字体"。"""
    upload = "MyUpload.ttf"
    fonts_dir().mkdir(parents=True, exist_ok=True)
    (fonts_dir() / upload).write_bytes(b"uploaded")
    user_fonts.set_active(upload)
    assert user_fonts.active_font_name() == upload
    return upload


# ① 取消后状态回 idle、磁盘干净（下载停在第一块之前：什么都没落）


def test_cancel_mid_download_leaves_no_files_and_idle_state():
    start_download()
    _wait_started()

    result = resume_font_builtin.cancel()

    assert result["state"] == "idle"
    assert result["downloaded"] is False
    assert result["downloaded_bytes"] == 0
    assert result["total_bytes"] == total_bytes()
    assert result["cancelling"] is False
    _assert_no_font_files_on_disk()
    assert downloaded_names() == []


# ① 的强化版：Regular 已经 rename 成正式文件、Bold 卡在半路 → 取消必须把那份也删掉


def test_cancel_after_regular_landed_removes_the_landed_file():
    _gate("Fake-Regular.otf").set()  # 放行 Regular，Bold 卡住
    start_download()
    _wait_started()
    # 等到 Regular 真的落地（Bold 还卡在闸门上），这才叫"半对文件"的现场。
    deadline = time.monotonic() + GATE_TIMEOUT
    while time.monotonic() < deadline:
        if (fonts_dir() / "Fake-Regular.otf").is_file():
            break
        time.sleep(0.01)
    assert (fonts_dir() / "Fake-Regular.otf").is_file()

    result = resume_font_builtin.cancel()

    assert result["state"] == "idle"
    assert result["downloaded"] is False
    assert result["downloaded_bytes"] == 0
    _assert_no_font_files_on_disk()


# ② 取消不改当前字体


def test_cancel_does_not_touch_the_active_font():
    active = _set_active_upload()
    start_download()
    _wait_started()

    resume_font_builtin.cancel()

    assert user_fonts.active_font_name() == active
    assert (fonts_dir() / active).is_file()


# ③ 取消不产生 failed 文案（网络/关连接引发的异常也不能写成"下载失败"）


def test_cancel_never_reports_a_failed_message():
    start_download()
    _wait_started()

    result = resume_font_builtin.cancel()

    assert result["state"] != "failed"
    assert result["error"] == ""
    # 再读一次：线程收尾之后状态也不许翻成 failed。
    assert status()["error"] == ""


# ④ 竞态：两个文件都 rename 完、还没置 done 时来了取消 → 以完成为准


def test_cancel_racing_with_completion_keeps_the_files(monkeypatch):
    original = resume_font_builtin._download_one
    done_files: list[str] = []

    def wrapped(entry, written):
        original(entry, written)
        done_files.append(str(entry["name"]))
        if len(done_files) == len(resume_font_builtin.BUILTIN_FILES):
            # 这就是"取消与完成撞车"的那一刻：文件已全在盘上、state 还是 downloading。
            # 在下载线程**自己**里调用 cancel()，最接近真实的那次点击。
            resume_font_builtin.cancel()

    monkeypatch.setattr(resume_font_builtin, "_download_one", wrapped)
    _release_all()

    start_download()
    final = _wait_until_settled()

    assert final["state"] == "done"
    assert final["downloaded"] is True
    assert final["cancelling"] is False
    assert (fonts_dir() / "Fake-Regular.otf").read_bytes() == REGULAR_BYTES
    assert (fonts_dir() / "Fake-Bold.otf").read_bytes() == BOLD_BYTES
    assert list(Path(fonts_dir()).glob("*.tmp")) == []


# ⑤ 下载中 DELETE → 409（旧入口被绕过时也不能删到一半）


def test_delete_is_rejected_while_downloading(client):
    start_download()
    _wait_started()

    response = client.delete("/api/settings/fonts/builtin")

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "字体正在下载中"
    resume_font_builtin.cancel()


def test_delete_service_raises_busy_while_downloading():
    start_download()
    _wait_started()
    try:
        with pytest.raises(FontBusy):
            delete()
    finally:
        resume_font_builtin.cancel()


# ⑥ 取消后可立即再次下载并成功（不留 FontBusy 残留）


def test_download_can_restart_right_after_cancel():
    start_download()
    _wait_started()
    assert resume_font_builtin.cancel()["state"] == "idle"

    _GatedClient.started.clear()
    _release_all()  # 这一轮一路跑完
    start_download()
    final = _wait_until_settled()

    assert final["state"] == "done"
    assert final["downloaded"] is True
    assert final["error"] == ""
    assert downloaded_names() == ["Fake-Regular.otf", "Fake-Bold.otf"]


# ⑦ 没有下载时 cancel() 是幂等的（不抛、状态不变）


def test_cancel_without_a_running_download_is_idempotent():
    before = status()

    first = resume_font_builtin.cancel()
    second = resume_font_builtin.cancel()

    assert first == before
    assert second == before
    assert first["state"] == "idle"
    assert first["downloaded_bytes"] == 0


def test_cancel_endpoint_returns_the_same_shape_as_status(client):
    expected_keys = set(client.get("/api/settings/fonts/builtin").json())

    response = client.post("/api/settings/fonts/builtin/download/cancel")

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == expected_keys
    assert body["state"] == "idle"
    assert body["cancelling"] is False


def test_cancel_endpoint_stops_an_in_flight_download(client):
    assert client.post("/api/settings/fonts/builtin/download").status_code == 202
    _wait_started()

    body = client.post("/api/settings/fonts/builtin/download/cancel").json()

    assert body["state"] == "idle"
    assert body["downloaded"] is False
    _assert_no_font_files_on_disk()


# 删除失败必须响亮（文件被占用时不能静默成功）


def test_delete_service_raises_on_locked_file():
    # 用目录占位：``unlink()`` 对一个目录一定失败（Windows = PermissionError,
    # POSIX = IsADirectoryError，两者都是 OSError 的子类）。
    (fonts_dir() / "Fake-Regular.otf").mkdir(parents=True)

    with pytest.raises(FontDeleteError):
        delete()


def test_api_delete_maps_a_locked_file_to_500(client):
    locked = fonts_dir() / "Fake-Regular.otf"
    locked.mkdir(parents=True)

    response = client.delete("/api/settings/fonts/builtin")

    assert response.status_code == 500, response.text
    detail = response.json()["detail"]
    assert detail
    assert "请" not in detail  # detail 只写原因（"请"由前端给）
    assert locked.exists()  # 文件原样留着


# ---- P0-3 的 activate 开关：下载完成后是否接管全局字体 -------------------------
#
# 关键不是"能不能跳过激活"，而是**开关只作用于本轮**：跳过之后必须复位，否则一次
# 「制作台里下载」会让之后所有普通下载都静默地不设当前字体（表现是"下载完没生效，
# 重下也没用"）。所以每条用例都盯住"下一轮还灵不灵"。


def test_activate_false_download_leaves_the_active_font_unset(client):
    _release_all()  # 让这一轮一路跑完

    assert client.post("/api/settings/fonts/builtin/download?activate=false").status_code == 202
    final = _wait_until_settled()

    assert final["state"] == "done"
    assert final["downloaded"] is True
    assert (fonts_dir() / "Fake-Regular.otf").is_file()
    # 前端就是靠这条 GET 收尾的：它必须**不**接管当前字体。
    polled = client.get("/api/settings/fonts/builtin/download").json()
    assert polled["downloaded"] is True
    assert user_fonts.active_font_name() is None


def test_default_download_after_activate_false_still_takes_over(client):
    _release_all()
    client.post("/api/settings/fonts/builtin/download?activate=false")
    assert _wait_until_settled()["state"] == "done"
    assert client.get("/api/settings/fonts/builtin/download").json()["downloaded"] is True
    assert user_fonts.active_font_name() is None

    # 先把文件删掉，确保第二轮是**真下载**而不是"已下载"的短路分支。
    assert client.delete("/api/settings/fonts/builtin").status_code == 204
    _release_all()

    assert client.post("/api/settings/fonts/builtin/download").status_code == 202
    assert _wait_until_settled()["state"] == "done"
    assert client.get("/api/settings/fonts/builtin/download").json()["downloaded"] is True

    # 缺省 activate 的那一轮照旧接管：证明上一次的 False 没有漏到这一轮。
    assert user_fonts.active_font_name() == "Fake-Regular.otf"


def test_cancel_resets_the_activate_switch():
    start_download(activate=False)
    _wait_started()

    resume_font_builtin.cancel()

    # 取消是三条终止路径之一：开关必须已经回到 True（否则下一次普通下载继承 False）。
    assert resume_font_builtin.take_auto_activate() is True


def test_failure_resets_the_activate_switch(monkeypatch):
    broken = (
        FILES[0],
        {**_entry("bold", "Fake-Bold.otf", BOLD_BYTES), "sha256": "0" * 64},
    )
    monkeypatch.setattr(resume_font_builtin, "BUILTIN_FILES", broken)
    _release_all()

    start_download(activate=False)

    assert _wait_until_settled()["state"] == "failed"
    assert resume_font_builtin.take_auto_activate() is True
