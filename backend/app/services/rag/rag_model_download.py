# SPDX-License-Identifier: Apache-2.0
"""本地 embedding 资产下载状态机（照抄内置字体下载纪律，不 import 字体模块）。
模型包/运行时包先下到 .tmp（双校验在 rag_asset_archive）再解包到带版本子目录；解析顺序
Releases → HuggingFace 备用（模型逐文件），每源各自校验 sha256；状态 idle|downloading|verifying|
extracting|ready|failed，取消不是失败。
"""

from __future__ import annotations

import logging
import shutil
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from ...config import DATA_DIR, get_settings
from . import rag_asset_archive as archive
from .rag_asset_manifest import AssetUnavailable, select_assets
from .rag_runtime_loader import model_dir, runtime_dir, safe_extract_zip, unload_runtime

logger = logging.getLogger(__name__)

DISK_FACTOR = 2.0
_RUNNING = frozenset({"downloading", "verifying", "extracting"})

DownloadError = archive.AssetArchiveError

_lock = threading.Lock()
_stop = threading.Event()
_worker: threading.Thread | None = None
_temps: list[Path] = []
_state: dict[str, Any] = {"state": "idle", "error": "", "downloaded_bytes": 0, "total_bytes": 0}


@dataclass(frozen=True)
class SetupProgress:
    state: str
    downloaded_bytes: int
    total_bytes: int
    error: str = ""


def _bump(delta: int) -> None:
    with _lock:
        _state["downloaded_bytes"] = int(_state.get("downloaded_bytes") or 0) + delta


def _plan() -> list[dict[str, Any]]:
    """当前平台的下载计划：每项 = {target, sources[]}（sources 按优先级）。"""
    try:
        assets = select_assets()
    except AssetUnavailable as exc:
        raise DownloadError(str(exc)) from exc
    base = str(getattr(get_settings(), "rag_asset_base_url", "") or "").rstrip("/")
    hf = str(getattr(get_settings(), "rag_asset_hf_base_url", "") or "").rstrip("/")

    def zip_source(asset: dict[str, Any]) -> dict[str, Any]:
        return {
            "url": f"{base}/{str(asset.get('file') or '')}",
            "bytes": int(asset.get("bytes") or 0),
            "sha256": str(asset.get("sha256") or ""),
            "zip": True,
            "unpacked": int(asset.get("unpacked_bytes") or asset.get("bytes") or 0),
        }

    model: dict[str, Any] = dict(assets["model"])
    sources = [zip_source(model)]
    if hf:
        for item in model.get("files") or []:
            if isinstance(item, dict) and item.get("path"):
                sources.append(
                    {
                        "url": f"{hf}/{str(item['path']).lstrip('/')}",
                        "bytes": int(item.get("bytes") or 0),
                        "sha256": str(item.get("sha256") or ""),
                        "zip": False,
                        "target": str(item.get("target") or Path(str(item["path"])).name),
                        "unpacked": int(item.get("bytes") or 0),
                    }
                )
    return [
        {"target": model_dir(str(assets["variant"])), "sources": sources},
        {
            "target": runtime_dir(str(assets["ort_version"])),
            "sources": [zip_source(assets["runtime"])],
        },
    ]


def _prepare() -> tuple[list[dict[str, Any]], int]:
    """建立计划 + 总字节 + 磁盘预检（解压峰值约 2 倍）。"""
    plan = _plan()
    total = sum(int(asset["sources"][0].get("bytes") or 0) for asset in plan)
    required = int(sum(int(a["sources"][0].get("unpacked") or 0) for a in plan) * DISK_FACTOR)
    try:
        free: int | None = int(shutil.disk_usage(DATA_DIR).free)
    except OSError:
        free = None
    if free is not None and free < required:
        raise DownloadError("磁盘剩余空间不足，无法解压本地模型")
    return plan, total


def _download_source(source: dict[str, Any], target: Path) -> None:
    temp = target.parent / f".{target.name}.tmp"
    if not source.get("zip"):
        file_target = target / str(source.get("target") or "asset.bin")
        file_temp = file_target.with_name(file_target.name + ".tmp")
        archive.fetch(
            str(source["url"]),
            file_temp,
            expected_bytes=int(source.get("bytes") or 0),
            expected_sha256=str(source.get("sha256") or ""),
            on_progress=_bump,
            stop=_stop,
        )
        file_target.parent.mkdir(parents=True, exist_ok=True)
        file_temp.replace(file_target)
        return
    archive.fetch(
        str(source["url"]),
        temp,
        expected_bytes=int(source.get("bytes") or 0),
        expected_sha256=str(source.get("sha256") or ""),
        on_progress=_bump,
        stop=_stop,
    )
    with _lock:
        _temps.append(temp)
        _state["state"] = "verifying"
    staging = target.with_name(f"{target.name}.tmpdir")
    with _lock:
        _temps.append(staging)
        _state["state"] = "extracting"
    shutil.rmtree(staging, ignore_errors=True)
    try:
        safe_extract_zip(temp, staging)
        shutil.rmtree(target, ignore_errors=True)
        staging.replace(target)
    except Exception as exc:  # noqa: BLE001 - 坏包/路径穿越要保留可读原因给设置页
        raise DownloadError(str(exc)) from exc
    finally:
        temp.unlink(missing_ok=True)


def _download_asset(asset: dict[str, Any]) -> None:
    last: Exception | None = None
    for index, source in enumerate(asset["sources"]):
        if _stop.is_set():
            raise archive.Cancelled
        try:
            _download_source(source, Path(asset["target"]))
            return
        except archive.Cancelled:
            raise
        except Exception as exc:  # noqa: BLE001 - 前一个源失败才换下一个（各自校验）
            if _stop.is_set():
                # 取消会关掉在飞连接，读流因此抛错；这仍然是"取消"而不是"下载失败"。
                raise archive.Cancelled from exc
            last = exc
            logger.info(
                "本地资产下载源失败：source=%s bytes=%s error=%s",
                index,
                source.get("bytes"),
                type(exc).__name__,
            )
    raise DownloadError(str(last) if isinstance(last, DownloadError) else "本地模型资产下载失败")


def _cleanup() -> None:
    with _lock:
        temps = list(_temps)
        _temps.clear()
    for path in temps:
        try:
            shutil.rmtree(path, ignore_errors=True) if path.is_dir() else path.unlink(
                missing_ok=True
            )
        except OSError:
            logger.debug("清理本地资产临时文件失败：%s", path.name)


def _run(plan: list[dict[str, Any]], total: int) -> None:
    global _worker
    try:
        for asset in plan:
            if _stop.is_set():
                raise archive.Cancelled
            _download_asset(asset)
        if _stop.is_set():
            raise archive.Cancelled
        with _lock:
            _stop.clear()
            _state.update(
                {"state": "ready", "error": "", "downloaded_bytes": total, "total_bytes": total}
            )
        logger.info("本地 embedding 资产下载完成：bytes=%s", total)
    except archive.Cancelled:
        _cleanup()
        with _lock:
            _state.update({"state": "idle", "error": "", "downloaded_bytes": 0})
        logger.info("本地 embedding 资产下载已取消")
    except Exception as exc:  # noqa: BLE001 - 下载线程不能静默死掉
        _cleanup()
        logger.warning("本地 embedding 资产下载失败：%s", type(exc).__name__)
        message = str(exc) if isinstance(exc, DownloadError) else type(exc).__name__
        with _lock:
            _state.update({"state": "failed", "error": message})
    finally:
        with _lock:
            _worker = None


def start_download() -> dict[str, Any]:
    """启动后台下载并同步返回进度快照；同一时刻只允许一个（忙/空间不足抛 DownloadError）。"""
    global _worker
    with _lock:
        if str(_state.get("state") or "idle") in _RUNNING:
            raise DownloadError("本地模型正在下载中")
        _stop.clear()
        archive.reset()
        _temps.clear()
        _state.update({"state": "downloading", "error": "", "downloaded_bytes": 0})
    try:
        plan, total = _prepare()
        with _lock:
            _state["total_bytes"] = total
            _worker = threading.Thread(
                target=_run, args=(plan, total), name="rag-asset-download", daemon=True
            )
            _worker.start()
    except Exception:
        with _lock:
            _state.update({"state": "idle", "error": "", "downloaded_bytes": 0})
        raise
    return read_progress()


def read_progress() -> dict[str, Any]:
    with _lock:
        state = str(_state.get("state") or "idle")
        downloaded = max(0, int(_state.get("downloaded_bytes") or 0))
        total = max(0, int(_state.get("total_bytes") or 0))
        error = str(_state.get("error") or "")
    if total and downloaded > total:
        downloaded = total
    snapshot = SetupProgress(state, downloaded, total, error)
    return {**asdict(snapshot), "progress": round(downloaded / total, 4) if total else 0.0}


def cancel_download() -> dict[str, Any]:
    """取消正在进行的下载（幂等）；线程确实收尾后才清状态。"""
    with _lock:
        running = str(_state.get("state") or "idle") in _RUNNING
        if running:
            _stop.set()
        worker = _worker
    if not running:
        return read_progress()
    archive.close_inflight()
    if worker is not None and worker is not threading.current_thread() and worker.is_alive():
        worker.join(archive.CANCEL_JOIN_TIMEOUT)
    with _lock:
        if worker is not None and worker.is_alive():
            return read_progress()
        _state.update({"state": "idle", "error": "", "downloaded_bytes": 0})
    _cleanup()
    return read_progress()


def delete_assets() -> list[str]:
    with _lock:
        if str(_state.get("state") or "idle") in _RUNNING:
            raise DownloadError("本地模型正在下载中")
    unload_runtime()  # 先卸载运行时/清 session：否则 Windows 上 DLL 占用会让目录删不掉
    try:
        assets = select_assets()
        targets = [model_dir(str(assets["variant"])), runtime_dir(str(assets["ort_version"]))]
    except Exception:  # noqa: BLE001 - 清单不可用时只复位状态，不猜目录
        targets = []
    removed: list[str] = []
    with _lock:
        for target in targets:
            existed = target.exists()
            archive.remove_tree(target)  # 目录被加载中的 DLL 锁住时由 archive 改名移走
            if existed:
                removed.append(target.name)
        _state.update({"state": "idle", "error": "", "downloaded_bytes": 0})
    return removed


def reset_state() -> None:
    global _worker
    with _lock:
        _stop.clear()
        archive.reset()
        _temps.clear()
        _worker = None
        _state.update({"state": "idle", "error": "", "downloaded_bytes": 0, "total_bytes": 0})
