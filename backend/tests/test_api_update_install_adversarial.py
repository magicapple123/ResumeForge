"""应用内更新「下载完成 → 重启安装」链路的对抗性边界用例。

与 ``test_api_update_install.py`` 互补：那边守主路径（端点成功、磁盘恢复、错误文案），
这边专守「异常/竞态输入不越界」——重复安装、降级包、恢复排除项、非 idle 不被打扰，
以及经真实路由的恢复。生产代码一行都不 mock：只打桩 ``subprocess.Popen``（不起进程）
与 ``_stop_current_backend``（不真跑 ``os._exit``）。
"""

from __future__ import annotations

import hashlib
import threading
import zipfile
from types import SimpleNamespace

import pytest
from app.services import update_download


def _valid_archive(path):
    """能通过 `_validate_archive` 与 `_verify_checksum` 的最小合法安装包（含 `.sha256`）。"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("ResumeForge/start.cmd", "@echo off")
        archive.writestr("ResumeForge/backend/app/main.py", "app = None")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    path.with_name(path.name + ".sha256").write_text(
        f"{digest}  {path.name}\n", encoding="utf-8"
    )
    return path


@pytest.fixture
def env(tmp_path, monkeypatch):
    """把磁盘位置、脚本、Popen 与停止协程隔离到临时目录；本机假装 Windows。"""
    downloads = tmp_path / "update-downloads"
    downloads.mkdir()
    monkeypatch.setattr(update_download, "DOWNLOAD_DIRECTORY", downloads)
    monkeypatch.setattr(update_download, "UPDATE_LOG_PATH", tmp_path / "update.log")
    monkeypatch.setattr(update_download, "PROJECT_ROOT", tmp_path)
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "Update-ResumeForge.ps1").write_text("# fake\n", encoding="utf-8")
    monkeypatch.setattr(update_download, "os", SimpleNamespace(name="nt", getpid=lambda: 4242))

    calls: dict[str, object] = {"popen": [], "stopped": [], "event": threading.Event()}

    def fake_popen(_arguments, **_kwargs):
        calls["popen"].append(_arguments)  # type: ignore[union-attr]
        return SimpleNamespace(pid=1)

    monkeypatch.setattr(update_download.subprocess, "Popen", fake_popen)

    async def fake_stop(install_id: str) -> None:
        calls["stopped"].append(install_id)  # type: ignore[union-attr]
        calls["event"].set()  # type: ignore[union-attr]

    monkeypatch.setattr(update_download, "_stop_current_backend", fake_stop)

    update_download._status = update_download._MutableStatus()
    update_download._archive_path = None
    return SimpleNamespace(downloads=downloads, calls=calls)


def _make_ready(archive, target_version: str) -> None:
    update_download._status = update_download._MutableStatus()
    update_download._status.state = "ready"
    update_download._status.current_version = "0.18.0"
    update_download._status.target_version = target_version
    update_download._status.progress = 100
    size = archive.stat().st_size
    update_download._status.downloaded_bytes = size
    update_download._status.total_bytes = size
    update_download._status.installable = True
    update_download._status.message = "更新包已下载完成，可以重启安装"
    update_download._archive_path = archive


def test_second_install_while_installing_is_rejected_and_spawns_no_second_updater(client, env):
    """双重安装竞态：installing 时再点安装 → 409，且绝不拉起第二个更新器进程。"""
    archive = _valid_archive(env.downloads / "ResumeForge-99.0.0.zip")
    _make_ready(archive, "99.0.0")

    first = client.post("/api/update/install", json={"restart": True})
    assert first.status_code == 200, first.text
    assert first.json()["state"] == "installing"
    assert len(env.calls["popen"]) == 1  # type: ignore[arg-type]

    second = client.post("/api/update/install", json={"restart": True})
    assert second.status_code == 409
    # 关键断言：第二次没有 Popen——不会有两个更新器同时覆盖同一份程序文件。
    assert len(env.calls["popen"]) == 1  # type: ignore[arg-type]
    assert update_download._status.state == "installing"


def test_only_stale_or_equal_versions_on_disk_do_not_restore(env):
    """降级保护的隔离验证：磁盘上只有等于/低于当前版本的包 → 保持 idle、不恢复。"""
    _valid_archive(env.downloads / "ResumeForge-0.0.1.zip")
    _valid_archive(env.downloads / "ResumeForge-0.18.0.zip")  # == 当前版本 0.18.0
    update_download._status = update_download._MutableStatus()
    update_download._archive_path = None

    status = update_download.download_status()

    assert status.state == "idle"
    assert update_download._archive_path is None


def test_restore_skips_part_files_directories_and_traversal_packages(env):
    """恢复排除项：.part 残留、同名目录、命名合规但路径穿越的包都不算"可安装"。"""
    (env.downloads / "ResumeForge-99.0.0.zip.part").write_bytes(b"partial")  # 未完成下载
    (env.downloads / "ResumeForge-98.0.0.zip").mkdir()  # 同名目录而非文件
    unsafe = env.downloads / "ResumeForge-97.0.0.zip"  # 命名合规但含 ../
    with zipfile.ZipFile(unsafe, "w") as archive:
        archive.writestr("../escape.txt", "x")
        archive.writestr("ResumeForge/start.cmd", "@echo off")
        archive.writestr("ResumeForge/backend/app/main.py", "app = None")
    update_download._status = update_download._MutableStatus()
    update_download._archive_path = None

    status = update_download.download_status()

    assert status.state == "idle"
    assert update_download._archive_path is None


def test_restore_does_not_clobber_an_in_progress_download(env):
    """恢复只在 idle 生效：正在下载时即便磁盘上冒出更高版本的包，也不该把状态顶成 ready。"""
    _valid_archive(env.downloads / "ResumeForge-99.0.0.zip")
    update_download._status = update_download._MutableStatus()
    update_download._status.state = "downloading"
    update_download._status.current_version = "0.18.0"
    update_download._status.target_version = "99.0.0"
    update_download._archive_path = None

    status = update_download.download_status()

    assert status.state == "downloading"
    assert update_download._archive_path is None


def test_download_status_route_restores_ready_from_disk(client, env):
    """经真实 GET 路由的恢复：注入 tmp 下载目录后，接口应把磁盘上的包认领为 ready。"""
    _valid_archive(env.downloads / "ResumeForge-99.0.0.zip")
    update_download._status = update_download._MutableStatus()
    update_download._archive_path = None

    body = client.get("/api/update/download-status").json()

    assert body["state"] == "ready"
    assert body["target_version"] == "99.0.0"
    assert body["installable"] is True
