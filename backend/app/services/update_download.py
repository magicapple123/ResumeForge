"""应用内下载与安装更新。

下载只写入 ``runtime`` 临时目录，安装脚本会跳过 ``data``、``.env``、``runtime``
等用户数据路径。真正覆盖文件和重启由独立的 PowerShell 进程完成，避免当前 Python
进程一边运行一边替换自己的代码。
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import subprocess
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Literal

import httpx

from ..config import get_settings
from ..schemas.update import UpdateStatus
from .update_check import check_for_update

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DOWNLOAD_DIRECTORY = PROJECT_ROOT / "runtime" / "update-downloads"
MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
DOWNLOAD_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)

# 更新器（PowerShell）把进展写在 `runtime/` 里：这两个文件是"这次更新到底成没成"的
# 唯一凭据。`runtime/` 被更新器排除，所以它不会被更新过程覆盖掉。
UPDATE_STATUS_PATH = PROJECT_ROOT / "runtime" / "update-status.json"
UPDATE_LOG_PATH = PROJECT_ROOT / "runtime" / "update.log"
# 更新器起来后要先把状态写成 `installing` 再动手；这么久了还没写，说明它没起来。
_INSTALL_HANDSHAKE_ATTEMPTS = 30
_INSTALL_HANDSHAKE_INTERVAL = 1.0
# `installing` 停留超过这么久，说明更新器半路死了（覆盖到一半、或被杀掉）。
_STALE_INSTALL_SECONDS = 120.0


@dataclass
class _MutableStatus:
    state: Literal["idle", "downloading", "ready", "installing", "failed"] = "idle"
    current_version: str = ""
    target_version: str = ""
    progress: float = 0
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    background: bool = False
    installable: bool = False
    message: str = ""


_status = _MutableStatus()
_download_task: asyncio.Task[None] | None = None
_archive_path: Path | None = None


def _snapshot() -> UpdateStatus:
    return UpdateStatus(
        state=_status.state,
        current_version=_status.current_version,
        target_version=_status.target_version,
        progress=_status.progress,
        downloaded_bytes=_status.downloaded_bytes,
        total_bytes=_status.total_bytes,
        background=_status.background,
        installable=_status.installable,
        message=_status.message,
    )


def download_status() -> UpdateStatus:
    """返回当前进程内的更新任务状态。"""
    return _snapshot()


def _safe_archive_path(version: str) -> Path:
    safe_version = "".join(char for char in version if char.isalnum() or char in ".-_")[:64]
    return DOWNLOAD_DIRECTORY / f"ResumeForge-{safe_version or 'latest'}.zip"


def _validate_archive(path: Path) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            names = [name.replace("\\", "/") for name in archive.namelist()]
            for name in names:
                parts = PurePosixPath(name).parts
                if PurePosixPath(name).is_absolute() or ".." in parts:
                    raise ValueError("更新包包含不安全的路径，已拒绝安装")
            if not any(name.endswith("/start.cmd") or name == "start.cmd" for name in names):
                raise ValueError("更新包缺少 start.cmd，无法确认它是 ResumeForge 安装包")
            if not any(name.endswith("/backend/app/main.py") for name in names):
                raise ValueError("更新包缺少后端入口，无法确认它是完整安装包")
            if archive.testzip() is not None:
                raise ValueError("更新包校验失败，压缩包可能已损坏")
    except zipfile.BadZipFile as exc:
        raise ValueError("下载的更新包不是有效 ZIP 文件") from exc


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def _fetch_expected_checksum(url: str) -> str:
    """取回发布时一并上传的 `.sha256`（内容是 `<64 位十六进制>  <文件名>`）。"""
    headers = {"Accept": "text/plain", "User-Agent": "ResumeForge-updater"}
    async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
        response = await client.get(url, headers=headers)
        if response.status_code != 200:
            raise RuntimeError(f"下载校验文件失败：HTTP {response.status_code}")
        text = response.text
    match = re.search(r"[0-9a-fA-F]{64}", text)
    if not match:
        raise RuntimeError("校验文件内容无法识别，已停止安装")
    return match.group(0).lower()


async def _download_archive(
    url: str, expected_size: int | None, target: Path, checksum_url: str = ""
) -> None:
    DOWNLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".part")
    headers = {"Accept": "application/octet-stream", "User-Agent": "ResumeForge-updater"}
    try:
        async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            async with client.stream("GET", url, headers=headers) as response:
                if response.status_code != 200:
                    raise RuntimeError(f"下载服务器返回 HTTP {response.status_code}")
                header_size = response.headers.get("Content-Length")
                total = int(header_size) if header_size and header_size.isdigit() else expected_size
                _status.total_bytes = total
                with partial.open("wb") as handle:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        _status.downloaded_bytes += len(chunk)
                        if _status.downloaded_bytes > MAX_DOWNLOAD_BYTES:
                            raise RuntimeError("更新包超过 512 MB，已停止下载")
                        handle.write(chunk)
                        if total:
                            _status.progress = min(99.0, _status.downloaded_bytes * 100 / total)
        _validate_archive(partial)
        # 发行包里是要覆盖到程序目录的代码，值得对着发布方给的摘要再核一次：
        # 能挡住下载被截断、被中间环节替换这类问题。没提供摘要时（例如退回源码包）
        # 就跳过——那说明这次本来就没有可核对的凭据。
        if checksum_url:
            expected = await _fetch_expected_checksum(checksum_url)
            actual = _sha256_of(partial)
            if actual != expected:
                raise RuntimeError(
                    "更新包校验和不匹配（下载可能被截断或被改动），已停止安装"
                )
        os.replace(partial, target)
    except Exception:
        logger.exception("下载更新包失败")
        raise


async def _run_download(
    url: str, expected_size: int | None, target: Path, checksum_url: str = ""
) -> None:
    try:
        await _download_archive(url, expected_size, target, checksum_url)
        _status.progress = 100
        _status.state = "ready"
        _status.installable = True
        _status.message = "更新包已下载完成，可以重启安装"
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _status.state = "failed"
        _status.installable = False
        _status.message = str(exc)[:1000]


async def start_download(*, background: bool = False) -> UpdateStatus:
    """启动一次下载；重复点击不会创建第二个下载任务。"""
    global _download_task, _archive_path
    if _status.state in {"downloading", "installing"}:
        return _snapshot()
    result = await check_for_update()
    if not result.update_available:
        raise RuntimeError(result.message or "当前没有可用更新")
    if not result.installable or not result.download_url:
        raise RuntimeError("这个版本没有可安装的完整更新包，请打开发布页面手动下载")

    target = _safe_archive_path(result.latest_version)
    _archive_path = target
    if target.is_file():
        try:
            _validate_archive(target)
        except ValueError:
            pass
        else:
            _status.state = "ready"
            _status.current_version = get_settings().app_version
            _status.target_version = result.latest_version
            _status.progress = 100
            _status.downloaded_bytes = target.stat().st_size
            _status.total_bytes = target.stat().st_size
            _status.background = background
            _status.installable = True
            _status.message = "更新包已下载完成，可以重启安装"
            return _snapshot()

    _status.state = "downloading"
    _status.current_version = get_settings().app_version
    _status.target_version = result.latest_version
    _status.progress = 0
    _status.downloaded_bytes = 0
    _status.total_bytes = result.download_size
    _status.background = background
    _status.installable = False
    _status.message = "正在下载更新包"
    _download_task = asyncio.create_task(
        _run_download(result.download_url, result.download_size, target, result.checksum_url)
    )
    return _snapshot()


def _read_frontend_pid() -> int | None:
    path = PROJECT_ROOT / "runtime" / "frontend.json"
    try:
        # `runtime/*.json` 是启动器用 `Set-Content -Encoding utf8` 写的，在
        # Windows PowerShell 5.1 下**带 UTF-8 BOM**；按普通 utf-8 读会抛
        # JSONDecodeError，被下面的 except 吞掉后恒返回 None——结果就是
        # in-app 安装时从不传 `-StopPids`，Vite 还在跑着就被 npm ci 覆盖依赖目录
        # （EPERM 那一类失败）。用 utf-8-sig 兼容带与不带 BOM 两种写法。
        value = json.loads(path.read_text(encoding="utf-8-sig"))
        pid = int(value.get("process_id", 0))
        return pid if pid > 0 and pid != os.getpid() else None
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _installer_started(install_id: str) -> bool:
    """更新器有没有按约定把这次安装写成 `installing`（起手第一件事）。"""
    marker = _read_status_marker()
    return bool(marker) and marker.get("install_id") == install_id


async def _stop_current_backend(install_id: str) -> None:
    await asyncio.sleep(1.0)
    for _ in range(_INSTALL_HANDSHAKE_ATTEMPTS):
        if _installer_started(install_id):
            # The response has already left the socket. The updater waits for this
            # PID, then stops the recorded Vite tree and starts the launcher again.
            os._exit(0)
        await asyncio.sleep(_INSTALL_HANDSHAKE_INTERVAL)

    # 更新器没起来就别退出：原先这里无条件 `os._exit(0)`，于是"应用关了、什么都没发生"
    # 成了用户能看到的全部——没有窗口、没有报错、也没有日志。留在运行状态并说清原因，
    # 用户至少能继续用、也能把日志发出来。
    _status.state = "failed"
    _status.installable = True
    _status.message = (
        "更新器没有启动，应用没有退出；可以重试，或手动运行 update.cmd。"
        f"日志：{_relative_to_project(UPDATE_LOG_PATH)}"
    )


def _relative_to_project(path: Path) -> str:
    try:
        return path.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return str(path)


def _read_status_marker() -> dict | None:
    try:
        # 更新器同样用 `Set-Content -Encoding utf8`（PS 5.1 会带 BOM），所以走 utf-8-sig。
        value = json.loads(UPDATE_STATUS_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def read_install_result() -> dict | None:
    """这次更新到底成没成——**以"现在跑的是哪个版本"为准**。

    更新器写在 `runtime/update-status.json` 里的状态是它的自述，而版本号是事实：
    它可能"报了失败但新版本其实起来了"（健康检查超时），也可能"写了 installing
    就死了"（覆盖到一半）。所以先比版本，再看状态。

    返回 ``None`` 表示没有需要汇报的更新。
    """
    marker = _read_status_marker()
    if not marker:
        return None
    current = get_settings().app_version
    target = str(marker.get("target_version") or "")
    state = str(marker.get("state") or "")
    payload = {
        "from_version": str(marker.get("from_version") or ""),
        "target_version": target,
        "message": str(marker.get("message") or "")[:1000],
        "log": str(marker.get("log") or _relative_to_project(UPDATE_LOG_PATH))[:256],
        "restart": bool(marker.get("restart", True)),
    }

    if target and target == current:
        # 现在跑的就是目标版本，别的都不用看了。
        payload["state"] = "success"
        return payload
    if state == "success":
        # 更新器说成功了，但当前进程还不是目标版本：换句话说是"文件换了、应用没起来"。
        # 这时候报成功就是撒谎——那正是这次要修掉的行为之一。
        payload["state"] = "failed"
        payload["message"] = payload["message"] or "更新器报告成功，但当前运行的仍不是新版本"
        return payload
    if state == "failed":
        payload["state"] = "failed"
        return payload
    if state == "installing":
        started_at = marker.get("started_at")
        age = time.time() - float(started_at) if isinstance(started_at, (int, float)) else 0.0
        payload["state"] = "interrupted" if age > _STALE_INSTALL_SECONDS else "installing"
        return payload
    return None


def clear_install_result() -> None:
    """用户看过结果之后清掉标记，避免每次打开设置都弹一遍。"""
    try:
        UPDATE_STATUS_PATH.unlink()
    except FileNotFoundError:
        return
    except OSError:
        logger.warning("清理更新状态文件失败：%s", UPDATE_STATUS_PATH)


def schedule_install(*, restart: bool = True) -> UpdateStatus:
    """启动独立更新器；更新器会等当前服务退出后覆盖文件。"""
    global _status
    if _status.state != "ready" or _archive_path is None or not _archive_path.is_file():
        raise RuntimeError("更新包还没有下载完成")
    if os.name != "nt":
        raise RuntimeError("应用内覆盖安装目前只支持 Windows；其它系统请按升级文档操作")

    script = PROJECT_ROOT / "scripts" / "Update-ResumeForge.ps1"
    if not script.is_file():
        raise RuntimeError("找不到更新脚本，无法安全覆盖安装")
    install_id = uuid.uuid4().hex
    arguments = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script),
        "-ArchivePath",
        str(_archive_path),
        "-WaitForPids",
        str(os.getpid()),
        "-InstallId",
        install_id,
        "-TargetVersion",
        _status.target_version,
    ]
    frontend_pid = _read_frontend_pid()
    if frontend_pid:
        arguments.extend(["-StopPids", str(frontend_pid)])
    if restart:
        arguments.append("-Restart")
    creation_flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(
        subprocess, "DETACHED_PROCESS", 0
    )
    # 更新器的输出写进日志文件，不再丢进 DEVNULL：更新失败时那是唯一的线索
    # （窗口是隐藏的，用户看不到任何东西）。
    try:
        UPDATE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with UPDATE_LOG_PATH.open("a", encoding="utf-8") as log_handle:
            log_handle.write(f"\n=== 应用内更新 {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
            log_handle.flush()
            subprocess.Popen(
                arguments,
                cwd=str(PROJECT_ROOT),
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                creationflags=creation_flags,
            )
    except OSError as exc:
        raise RuntimeError(f"启动更新器失败：{exc}") from exc

    _status.state = "installing"
    _status.installable = False
    _status.message = "更新器已启动，应用即将重启"
    asyncio.create_task(_stop_current_backend(install_id))
    return _snapshot()


__all__ = [
    "clear_install_result",
    "download_status",
    "read_install_result",
    "schedule_install",
    "start_download",
]
