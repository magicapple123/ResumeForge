# SPDX-License-Identifier: Apache-2.0
"""本地 embedding 资产下载状态机（照抄内置字体下载纪律，不 import 字体模块）。

解析顺序：Releases 整包（zip，解包后原子替换）→ HuggingFace 逐文件备用源。**这两者不是
同一类"备选源"**：zip 是一个可以整体校验、整体替换的包；HuggingFace 上是一组文件，必须
**全部**下完才算这个资产就绪（全有或全无），所以 plan 里它们是两个字段
（``sources`` 整包 / ``files`` 逐文件），不能平铺成一个列表——平铺会让"第一个文件下成功"
被当成"整个资产完成"，磁盘上留下一份 88% 的残缺目录。

状态 idle|downloading|verifying|extracting|ready|failed，取消不是失败。
"""

from __future__ import annotations

import logging
import shutil
import threading
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
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
    """当前平台的下载计划：每项 = ``{target, sources[], files[]}``。

    - ``sources``：整包（zip）备选源，按优先级；下完解包后原子替换 ``target``。
    - ``files``：逐文件备用源（HuggingFace），**仅当所有整包源都失败时**才启用；
      它不是"另一个整包"，而是一组必须全部到位的文件（全有或全无）。

    运行时包没有逐文件备用源（HF 上没有对应 wheel 集合），因此 ``files`` 为空。
    """
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

    def file_source(item: dict[str, Any]) -> dict[str, Any]:
        """一个 HF 文件：``path`` 是包内相对路径（要还原到子目录），不是整包。"""
        upstream = str(item.get("path") or "")
        relative = str(item.get("target") or PurePosixPath(upstream).name)
        return {
            "url": f"{hf}/{upstream.lstrip('/')}",
            "path": relative,
            "bytes": int(item.get("bytes") or 0),
            "sha256": str(item.get("sha256") or ""),
        }

    model: dict[str, Any] = dict(assets["model"])
    model_files: list[dict[str, Any]] = []
    if hf:
        model_files = [
            file_source(item)
            for item in model.get("files") or []
            if isinstance(item, dict) and item.get("path")
        ]
    return [
        {
            "target": model_dir(str(assets["variant"])),
            "sources": [zip_source(model)],
            "files": model_files,
        },
        {
            "target": runtime_dir(str(assets["ort_version"])),
            "sources": [zip_source(assets["runtime"])],
            "files": [],
        },
    ]


def _prepare() -> tuple[list[dict[str, Any]], int]:
    """建立计划 + 总字节 + 磁盘预检（解压峰值约 2 倍）。

    总字节按**整包**路径算（就是设置页显示的"首次约 N MB"）；真的走到逐文件备用源时由
    :func:`_grow_total` 抬高分母，进度因此不会假到 100%。
    """
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


def _grow_total(delta: int) -> None:
    """抬高进度分母（逐文件备用源的字节数大于整包，否则会中途"假装"到 100%）。"""
    if delta <= 0:
        return
    with _lock:
        grown = int(_state.get("total_bytes") or 0) + delta
        _state["total_bytes"] = max(grown, int(_state.get("downloaded_bytes") or 0))


def _safe_join(root: Path, relative: str) -> Path:
    """清单里的相对路径 → 暂存目录内的路径；绝对路径/穿越/盘符一律拒绝。"""
    pure = PurePosixPath((relative or "").replace("\\", "/"))
    parts = pure.parts
    if not parts or pure.is_absolute() or ".." in parts or ":" in parts[0]:
        raise DownloadError(f"本地资产清单结构非法（{relative or '缺少目标路径'}）")
    return root.joinpath(*parts)


def _prune_empty_parents(path: Path) -> None:
    """删掉失败后剩下的**空**父目录（版本目录的上一级），但绝不越过 ``DATA_DIR``。

    ``archive.fetch()`` 在真正读流之前就 ``mkdir`` 了父目录，所以"404 一个字节都没下到"
    也会留下 ``DATA_DIR/rag-runtime`` 这种空壳。空壳不影响功能，但与"失败不留半份"的
    口径不符，还会让排障的人以为下过东西。

    只删**空**目录，并且停在 ``DATA_DIR`` 之前（``DATA_DIR`` 本身被设置页与其它组件依赖，
    必须保留）。删不动（被占用/权限）就安静放弃——这是收尾，不是失败原因。
    """
    try:
        root = Path(DATA_DIR).resolve()
    except OSError:
        return
    current = Path(path)
    while True:
        try:
            resolved = current.resolve()
        except OSError:
            return
        if resolved == root or root not in resolved.parents:
            return
        try:
            if any(current.iterdir()):
                return
            current.rmdir()
        except OSError:
            return
        current = current.parent


def _download_source(source: dict[str, Any], target: Path) -> None:
    """整包（zip）源：下到 .tmp → 双校验 → 安全解包到 .tmpdir → 原子替换 target。"""
    temp = target.parent / f".{target.name}.tmp"
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


def _download_files(files: list[dict[str, Any]], target: Path) -> None:
    """逐文件备用源：先进 ``<target>.tmpdir`` 暂存，**全部成功**才换到正式目录。

    与整包路径同一套原子语义——``target`` 只有两种状态：旧的（完整）或新的（完整）。任一
    文件失败就把暂存目录整体删掉，``target`` 保持原样，绝不留半份目录在最终位置
    （否则 ``assets_present()`` 会看到残缺目录，或者用户拿到一个 88% 的"已就绪"）。
    """
    staging = target.with_name(f"{target.name}.tmpdir")
    with _lock:
        _temps.append(staging)
        _state["state"] = "downloading"
    archive.remove_tree(staging)
    staging.mkdir(parents=True, exist_ok=True)
    try:
        for item in files:
            if _stop.is_set():
                raise archive.Cancelled
            destination = _safe_join(staging, str(item.get("path") or ""))
            destination.parent.mkdir(parents=True, exist_ok=True)
            temp = destination.with_name(destination.name + ".tmp")
            archive.fetch(
                str(item["url"]),
                temp,
                expected_bytes=int(item.get("bytes") or 0),
                expected_sha256=str(item.get("sha256") or ""),
                on_progress=_bump,
                stop=_stop,
            )
            temp.replace(destination)
        with _lock:
            _state["state"] = "verifying"
        archive.remove_tree(target)
        staging.replace(target)
    except archive.Cancelled:
        archive.remove_tree(staging)
        raise
    except Exception as exc:  # noqa: BLE001 - 校验失败/路径非法/磁盘错误都要给可读原因
        archive.remove_tree(staging)
        raise DownloadError(str(exc)) from exc


def _download_asset(asset: dict[str, Any]) -> None:
    """先试所有整包源；全失败后（若有）走逐文件备用源。任一成功即返回。"""
    target = Path(asset["target"])
    last: Exception | None = None
    for index, source in enumerate(asset.get("sources") or []):
        if _stop.is_set():
            raise archive.Cancelled
        try:
            _download_source(source, target)
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
    files = [item for item in asset.get("files") or [] if isinstance(item, dict)]
    if files:
        packed = sum(int(source.get("bytes") or 0) for source in asset.get("sources") or [])
        _grow_total(sum(int(item.get("bytes") or 0) for item in files) - packed)
        try:
            _download_files(files, target)
            return
        except archive.Cancelled:
            raise
        except Exception as exc:  # noqa: BLE001 - 逐文件整组失败，原因透传给设置页
            if _stop.is_set():
                raise archive.Cancelled from exc
            last = exc
            logger.info(
                "本地资产逐文件下载失败：files=%s error=%s",
                len(files),
                type(exc).__name__,
            )
    _prune_empty_parents(target.parent)
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
