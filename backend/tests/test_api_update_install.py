# SPDX-License-Identifier: Apache-2.0
"""应用内更新「下载完成 → 重启安装」链路与磁盘恢复的离线测试。

这批用例守的是 2026-10-10 用户报的那条故障：在「设置 → 软件更新」点「重启并安装」，
同一屏上红色「更新包还没有下载完成」与绿色「更新包已下载完成」并存，应用既不关也
不重启。根因是 `install_update` 端点是同步 `def`（FastAPI 把它丢进线程池执行），
线程池里没有运行中的事件循环，`schedule_install` 里的 `asyncio.create_task` 必然抛
`RuntimeError: no running event loop`——端点把它转成 409，`_stop_current_backend`
永不执行，应用于是停在原地。

**本文件第一条用例在修复前会拿到 409 而不是 200**，正是这条故障的回归守卫。

第二个守卫是 `test_the_installer_is_started_with_a_hidden_console`：更新器（PowerShell）
必须以 `CREATE_NO_WINDOW` 而不是 `DETACHED_PROCESS` 启动——分离进程没有控制台，脚本
压根不执行，后端等不到 `installing` 握手就报「更新器没有启动」。
"""

from __future__ import annotations

import hashlib
import subprocess
import threading
import zipfile
from types import SimpleNamespace

import pytest
from app.services import update_download


def _valid_archive(path):
    """构造一个能通过 `_validate_archive` 与 `_verify_checksum` 的最小安装包。

    恢复/缓存命中/安装前都会对着旁边的 `.sha256` 复验（RF-26 §12.5 #3），所以这里
    一并写出摘要文件——单独造坏包的用例自己控制 sidecar 的有无。
    """
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("ResumeForge/start.cmd", "@echo off")
        archive.writestr("ResumeForge/backend/app/main.py", "app = None")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    path.with_name(path.name + ".sha256").write_text(
        f"{digest}  {path.name}\n", encoding="utf-8"
    )
    return path


def _make_ready(archive_path, *, target_version: str) -> None:
    """把进程内状态摆成「已下载完成，等待安装」。"""
    update_download._status = update_download._MutableStatus()
    update_download._status.state = "ready"
    update_download._status.current_version = "0.18.0"
    update_download._status.target_version = target_version
    update_download._status.progress = 100
    size = archive_path.stat().st_size
    update_download._status.downloaded_bytes = size
    update_download._status.total_bytes = size
    update_download._status.installable = True
    update_download._status.message = "更新包已下载完成，可以重启安装"
    update_download._archive_path = archive_path


@pytest.fixture
def install_env(tmp_path, monkeypatch):
    """把更新器依赖的磁盘位置、脚本、Popen 与停止协程全部隔离到临时目录。

    绝不真的起进程（Popen 被打桩）、也绝不真跑 `os._exit`（停止协程被打桩），
    这样用例既快又不会把测试机上的东西关掉。
    """
    downloads = tmp_path / "update-downloads"
    downloads.mkdir()
    monkeypatch.setattr(update_download, "DOWNLOAD_DIRECTORY", downloads)
    monkeypatch.setattr(update_download, "UPDATE_LOG_PATH", tmp_path / "update.log")
    monkeypatch.setattr(update_download, "PROJECT_ROOT", tmp_path)
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "Update-ResumeForge.ps1").write_text("# fake\n", encoding="utf-8")
    # 假装本机是 Windows：应用内覆盖安装只有 Windows 那条链路。
    monkeypatch.setattr(update_download, "os", SimpleNamespace(name="nt", getpid=lambda: 4242))

    calls: dict[str, object] = {
        "popen": [],
        # 逐个保存 Popen 的关键字参数：`creationflags` 只在这里能拿到，丢了就没法
        # 断言更新器到底有没有控制台（2026-10 那次故障正是从这儿溜过去的）。
        "popen_kwargs": [],
        "stopped": [],
        "stopped_event": threading.Event(),
    }

    def fake_popen(_arguments, **kwargs):
        calls["popen"].append(_arguments)  # type: ignore[union-attr]
        calls["popen_kwargs"].append(kwargs)  # type: ignore[union-attr]
        return SimpleNamespace(pid=1)

    monkeypatch.setattr(update_download.subprocess, "Popen", fake_popen)

    async def fake_stop(install_id: str) -> None:
        calls["stopped"].append(install_id)  # type: ignore[union-attr]
        calls["stopped_event"].set()  # type: ignore[union-attr]

    monkeypatch.setattr(update_download, "_stop_current_backend", fake_stop)

    update_download._status = update_download._MutableStatus()
    update_download._archive_path = None
    return SimpleNamespace(downloads=downloads, calls=calls, workdir=tmp_path)


def test_install_endpoint_schedules_the_installer_and_returns_installing(client, install_env):
    """核心回归：ready + 合法包 → POST /install 必须 200（不是 409）。

    修复前该端点是同步 `def`，线程池里 `asyncio.create_task` 抛
    `no running event loop`，端点转 409。修复后端点改 `async def`，协程被正常调度。
    """
    archive = _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    _make_ready(archive, target_version="99.0.0")

    response = client.post("/api/update/install", json={"restart": True})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == "installing"
    assert body["installable"] is False
    assert len(install_env.calls["popen"]) == 1  # type: ignore[arg-type]
    # 更新器被拉起之后，停止后端等待重启的协程必须真的被调度（修复前为零）。
    assert install_env.calls["stopped_event"].wait(2.0)  # type: ignore[union-attr]
    assert install_env.calls["stopped"]  # type: ignore[arg-type]


def test_the_installer_is_started_with_a_hidden_console(client, install_env, monkeypatch):
    """更新器必须拿到**隐藏的控制台**，绝不能是分离进程（2026-10 故障的回归守卫）。

    实测过的那次故障：`DETACHED_PROCESS` 让 PowerShell 脚本压根不执行（分离进程没有
    控制台，而 PowerShell 是控制台宿主程序），退出码 0、零输出；后端 30 秒等不到
    `installing` 标记，只能报「更新器没有启动，应用没有退出…」。仓库里早有这条知识
    （`test_system_api.py::test_stopping_the_frontend_uses_a_hidden_console`），但当时
    只覆盖了停前端那一个调用点——本文件原来的 `fake_popen` 把 `creationflags` 丢掉了，
    所以安装路径上没有任何断言。

    标志位在这里**显式给值**：Linux CI 上 `subprocess.CREATE_NO_WINDOW` 不存在，
    `getattr(..., 0)` 会让两个常量都是 0，断言就退化成恒假/恒真。给成两个不同的位，
    "用了隐藏控制台"与"没用分离进程"这两件事才都真的被测到。
    """
    monkeypatch.setattr(update_download, "_CREATE_NO_WINDOW", 0x08000000)
    monkeypatch.setattr(update_download, "_DETACHED_PROCESS", 0x00000008)
    archive = _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    _make_ready(archive, target_version="99.0.0")

    response = client.post("/api/update/install", json={"restart": True})

    assert response.status_code == 200, response.text
    popen_kwargs = install_env.calls["popen_kwargs"]  # type: ignore[arg-type]
    assert len(popen_kwargs) == 1
    flags = popen_kwargs[0]["creationflags"]
    assert flags & 0x08000000, "更新器没有隐藏控制台：PowerShell 脚本不会执行"
    assert not flags & 0x00000008, "更新器是分离进程：没有控制台，PowerShell 脚本不会执行"
    # 更新器的输出仍要落进日志文件：窗口是隐藏的，日志是唯一线索。
    assert popen_kwargs[0]["stdout"] is not None
    assert popen_kwargs[0]["stderr"] == subprocess.STDOUT


def test_download_status_restores_a_ready_package_from_disk(install_env):
    """后端重启后「已下载」不该凭空消失：磁盘上的包还在就该恢复 ready。"""
    _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    update_download._status = update_download._MutableStatus()
    update_download._archive_path = None

    status = update_download.download_status()

    assert status.state == "ready"
    assert status.target_version == "99.0.0"
    assert status.progress == 100
    assert status.installable is True
    assert "下载完成" in status.message
    assert update_download._archive_path is not None


def test_download_status_picks_the_newest_local_package(install_env):
    """多个包并存取最新；等于当前版本（防重装/降级）与旧版本一律忽略。"""
    _valid_archive(install_env.downloads / "ResumeForge-0.0.1.zip")
    _valid_archive(install_env.downloads / "ResumeForge-0.18.0.zip")  # == 当前版本
    _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    _valid_archive(install_env.downloads / "ResumeForge-100.0.0.zip")
    update_download._status = update_download._MutableStatus()
    update_download._archive_path = None

    status = update_download.download_status()

    assert status.state == "ready"
    assert status.target_version == "100.0.0"


def test_download_status_ignores_corrupt_or_misnamed_local_packages(install_env):
    """校验不过、命名不符的包绝不恢复（否则会把坏包摆成"可安装"）。"""
    (install_env.downloads / "ResumeForge-99.0.0.zip").write_text("not a zip", encoding="utf-8")
    _valid_archive(install_env.downloads / "something-else.zip")
    update_download._status = update_download._MutableStatus()
    update_download._archive_path = None

    status = update_download.download_status()

    assert status.state == "idle"
    assert update_download._archive_path is None


def test_schedule_install_recovers_a_ready_package_from_disk(client, install_env):
    """陈旧页面直接点安装（后端内存里是 idle，但磁盘有包）也要走通。"""
    _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    update_download._status = update_download._MutableStatus()  # idle
    update_download._archive_path = None

    response = client.post("/api/update/install", json={"restart": True})

    assert response.status_code == 200, response.text
    assert response.json()["state"] == "installing"
    assert install_env.calls["stopped_event"].wait(2.0)  # type: ignore[union-attr]


def test_install_reports_a_missing_package_file_honestly(client, install_env):
    """文件丢了就说文件丢了，不再拿「还没有下载完成」搪塞。"""
    archive = _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    _make_ready(archive, target_version="99.0.0")
    archive.unlink()

    response = client.post("/api/update/install", json={"restart": True})

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "不在了" in detail
    assert "还没有下载完成" not in detail
    assert not install_env.calls["popen"]  # type: ignore[arg-type]


def test_install_revalidates_the_package_before_starting(client, install_env):
    """下载与安装可能相隔数天：安装前必须再校验一次，坏包给清晰错误且不启动更新器。"""
    archive = install_env.downloads / "ResumeForge-99.0.0.zip"
    _valid_archive(archive)
    _make_ready(archive, target_version="99.0.0")
    archive.write_bytes(b"corrupted after download")

    response = client.post("/api/update/install", json={"restart": True})

    assert response.status_code == 409
    assert "损坏" in response.json()["detail"]
    assert not install_env.calls["popen"]  # type: ignore[arg-type]
    assert update_download._status.state == "failed"


def test_install_refuses_a_package_without_a_checksum_file(client, install_env):
    """ZIP 结构再完整，没有摘要就无法核对——拒绝安装，不启动更新器（§12.5 #3）。"""
    archive = _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    _make_ready(archive, target_version="99.0.0")
    archive.with_name(archive.name + ".sha256").unlink()

    response = client.post("/api/update/install", json={"restart": True})

    assert response.status_code == 409
    assert "校验文件" in response.json()["detail"]
    assert not install_env.calls["popen"]  # type: ignore[arg-type]
    assert update_download._status.state == "failed"


def test_install_refuses_a_package_that_was_swapped_after_download(client, install_env):
    """包被替换（ZIP 完好但内容变了）→ 摘要对不上 → 拒装（§12.5 #3）。"""
    archive = _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    _make_ready(archive, target_version="99.0.0")
    with zipfile.ZipFile(archive, "w") as swap:
        swap.writestr("ResumeForge/start.cmd", "@echo off")
        swap.writestr("ResumeForge/backend/app/main.py", "malicious = True")

    response = client.post("/api/update/install", json={"restart": True})

    assert response.status_code == 409
    assert "校验和" in response.json()["detail"]
    assert not install_env.calls["popen"]  # type: ignore[arg-type]


def test_install_still_refuses_on_unsupported_platform(client, install_env, monkeypatch):
    """`os.name != "nt"` 分支别弄坏：非 Windows 仍拒绝且不启动更新器。"""
    archive = _valid_archive(install_env.downloads / "ResumeForge-99.0.0.zip")
    _make_ready(archive, target_version="99.0.0")
    monkeypatch.setattr(update_download, "os", SimpleNamespace(name="posix", getpid=lambda: 4242))

    response = client.post("/api/update/install", json={"restart": True})

    assert response.status_code == 409
    assert "Windows" in response.json()["detail"]
    assert not install_env.calls["popen"]  # type: ignore[arg-type]
