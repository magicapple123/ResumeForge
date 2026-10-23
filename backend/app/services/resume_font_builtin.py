# SPDX-License-Identifier: Apache-2.0
"""内置中文字体「思源黑体」：**按需下载**，不进安装包。

**为什么内置字体要下载而不是随包**：思源黑体两个字重合计约 32MB（Regular 15.8MB +
Bold 16.2MB）。中国的简历用户几乎都需要一套能用的中文字体，但把 32MB 塞进安装包会让
每一次更新都多背 32MB，而相当一部分用户根本不需要（macOS / Windows 自带的微软雅黑、
苹方已经够用）。所以做成"用得到才下"，下载完成后与手动上传的字体完全同权。

**为什么两个字重**：PDF 的粗体必须由**真实粗体字面**提供。fpdf2 对没有粗体字面的字体会
做"描边加粗"，中文笔画密，描边后糊成一团——这正是"PDF 里加粗不明显/发虚"的根因。
带上 Bold 就能真正换字面（见 ``user_fonts.font_pair``）。

**镜像**：默认走清华 TUNA 的 Adobe 官方字体镜像（国内可直连、有校验、无需登录）。
每个文件都带**字节数与 sha256**双校验：镜像被替换、下载被中间设备截断、磁盘写坏，
都会在校验这一步被拦下，而不是留下一个"能选中但导出全是方框"的坏字体。

**本模块是叶子**：只依赖 ``config`` 与标准库/httpx，**不 import** ``user_fonts``。
理由：``user_fonts`` 反过来要用这里的文件清单做 ``font_pair``，两边互相 import 会成环。
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import threading
from pathlib import Path
from typing import cast

import httpx

from ..config import DATA_DIR

logger = logging.getLogger(__name__)

FONT_ID = "source-han-sans-sc"
FONT_LABEL = "思源黑体"
BASE_URL = "https://mirrors.tuna.tsinghua.edu.cn/adobe-fonts/source-han-sans/OTF/SimplifiedChinese/"

# ``role`` 只用于日志与"谁是常规字重"的判断；文件顺序有意义——第一个是 Regular，
# 下载完成后它会被设为当前字体（用户点一次"下载"就该能直接用）。
BUILTIN_FILES: tuple[dict[str, object], ...] = (
    {
        "role": "regular",
        "name": "SourceHanSansSC-Regular.otf",
        "bytes": 16529832,
        "sha256": "f1d8611151880c6c336aabeac4640ef434fa13cbfbf1ffe82d0a71b2a5637256",
    },
    {
        "role": "bold",
        "name": "SourceHanSansSC-Bold.otf",
        "bytes": 16963428,
        "sha256": "df2b90f5bcc6d01dfc964cec5f6d535d6b6aebd26ed7fd79a9c1b3f2112fcb6b",
    },
)

DIR_NAME = "fonts"
_TMP_SUFFIX = ".tmp"
# 每读一块就更新一次内存进度：轮询接口的进度条要"动起来"，但锁竞争不能太频繁。
CHUNK_SIZE = 64 * 1024
# 磁盘预检倍数：下载要写临时文件再 rename，峰值占用略高于最终体积。
DISK_HEADROOM = 1.2
_TIMEOUT = httpx.Timeout(connect=10, read=60, write=10, pool=10)


class FontBusy(RuntimeError):
    """已有一个下载任务在跑（API 映射 409）。"""


class FontDiskFull(RuntimeError):
    """磁盘剩余空间不够（API 映射 507）。"""


class FontDownloadError(RuntimeError):
    """下载或校验失败；消息可直接展示给用户。"""


class FontNotDownloaded(RuntimeError):
    """本机没有下载过内置字体（API 映射 404）。"""


# 进程内单例：状态与进度都在这里，接口只读它。
_lock = threading.Lock()
_state: dict[str, object] = {"state": "idle", "error": "", "downloaded_bytes": 0}
_worker: threading.Thread | None = None


def fonts_dir() -> Path:
    """字体目录（与用户上传的字体同一个目录：导出/备份/删除只有一套路径）。"""
    return Path(DATA_DIR) / DIR_NAME


def total_bytes() -> int:
    return sum(cast(int, item["bytes"]) for item in BUILTIN_FILES)


def _target(entry: dict) -> Path:
    return fonts_dir() / str(entry["name"])


def _is_present(entry: dict) -> bool:
    """文件在且**体积对得上**就算已下载。

    为什么不算 sha256：两文件 32MB，每次打开设置页都全量哈希要几百毫秒，而这条路径
    会被频繁轮询。sha256 只在**下载完成时**校验一次（那里才是"内容可能不对"的时刻），
    体积则足以发现"文件被删了一半"。
    """
    path = _target(entry)
    try:
        return path.is_file() and path.stat().st_size == int(entry["bytes"])
    except OSError:
        return False


def downloaded_names() -> list[str]:
    """已落盘的内置字体文件名（供 API 判断"当前字体是不是内置的"）。"""
    return [str(item["name"]) for item in BUILTIN_FILES if _is_present(item)]


def status() -> dict:
    """下载状态；``state`` ∈ ``idle | downloading | failed | done``。"""
    with _lock:
        state = str(_state.get("state") or "idle")
        error = str(_state.get("error") or "")
        progress = cast(int, _state.get("downloaded_bytes") or 0)
    total = total_bytes()
    present = [_is_present(item) for item in BUILTIN_FILES]
    downloaded = all(present)
    if downloaded:
        state = "done"
        error = ""
        progress = total
    elif state != "downloading":
        progress = sum(
            cast(int, item["bytes"]) for item, ok in zip(BUILTIN_FILES, present, strict=True) if ok
        )
    return {
        "id": FONT_ID,
        "label": FONT_LABEL,
        "size_total": total,
        "downloaded": downloaded,
        "downloaded_bytes": max(0, min(progress, total)),
        "total_bytes": total,
        "state": state,
        "error": error,
    }


def _available_bytes() -> int | None:
    """可用磁盘空间；连目录都不存在时退到数据目录再试，都拿不到就不预检（返回 None）。"""
    for candidate in (fonts_dir(), Path(DATA_DIR)):
        try:
            return int(shutil.disk_usage(candidate).free)
        except OSError:
            continue
    return None


def start_download() -> dict:
    """启动后台下载并立刻返回当前状态（HTTP 202 的语义）。

    Raises:
        FontBusy: 已有一个下载在跑。
        FontDiskFull: 剩余空间不足 ``total_bytes * DISK_HEADROOM``。
    """
    with _lock:
        if str(_state.get("state") or "") == "downloading":
            raise FontBusy("字体正在下载中")
        if all(_is_present(item) for item in BUILTIN_FILES):
            _state.update({"state": "done", "error": "", "downloaded_bytes": total_bytes()})
        else:
            free = _available_bytes()
            if free is not None and free < total_bytes() * DISK_HEADROOM:
                raise FontDiskFull("磁盘空间不足，无法保存字体")
            fonts_dir().mkdir(parents=True, exist_ok=True)
            # 清掉上一次失败的残留说明：新一次下载从干净状态开始。
            _state.update({"state": "downloading", "error": "", "downloaded_bytes": 0})
            _spawn_worker()
    return status()


def _spawn_worker() -> None:
    """在锁内调用：起一个 daemon 线程。进程退出时不该被下载卡住。"""
    global _worker
    _worker = threading.Thread(target=_run_download, name="builtin-font-download", daemon=True)
    _worker.start()


def _advance(delta: int) -> None:
    with _lock:
        _state["downloaded_bytes"] = cast(int, _state.get("downloaded_bytes") or 0) + delta


def _run_download() -> None:
    """后台线程主体：顺序下两个文件，全成功才置 done。"""
    written: list[Path] = []
    try:
        fonts_dir().mkdir(parents=True, exist_ok=True)
        for entry in BUILTIN_FILES:
            _download_one(entry, written)
        with _lock:
            _state.update({"state": "done", "error": "", "downloaded_bytes": total_bytes()})
        logger.info("内置字体下载完成：%s", FONT_LABEL)
    except Exception as exc:  # noqa: BLE001 - 任何失败都要落成可读状态，不能让线程静默死掉
        logger.warning("内置字体下载失败：%s", exc)
        _cleanup(written)
        with _lock:
            _state.update({"state": "failed", "error": _failure_message(exc)})


def _download_one(entry: dict, written: list[Path]) -> None:
    """下载一个文件到 ``<name>.tmp``，校验通过后 rename 成正式文件。"""
    target = _target(entry)
    temp = target.with_name(target.name + _TMP_SUFFIX)
    url = f"{BASE_URL}{entry['name']}"
    digest = hashlib.sha256()
    size = 0
    temp.parent.mkdir(parents=True, exist_ok=True)
    temp.unlink(missing_ok=True)
    try:
        with (
            httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client,
            client.stream("GET", url) as response,
        ):
            response.raise_for_status()
            with temp.open("wb") as handle:
                for chunk in response.iter_bytes(CHUNK_SIZE):
                    if not chunk:
                        continue
                    handle.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                    _advance(len(chunk))
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    if size != int(entry["bytes"]) or digest.hexdigest() != str(entry["sha256"]):
        temp.unlink(missing_ok=True)
        raise FontDownloadError("校验失败，文件不完整")
    temp.replace(target)
    written.append(target)


def _cleanup(written: list[Path]) -> None:
    """失败收尾：删掉所有 ``.tmp``，以及本轮已落地但**凑不成一对**的正式文件。

    只留一半（Regular 在、Bold 不在）对用户毫无价值，还会白占 15MB；下一次点击下载
    会完整重来一遍。
    """
    directory = fonts_dir()
    if directory.is_dir():
        for path in directory.glob(f"*{_TMP_SUFFIX}"):
            try:
                path.unlink()
            except OSError as exc:  # noqa: BLE001 - 清理失败不该盖住原始错误
                logger.warning("清理临时字体文件失败（%s）：%s", path.name, exc)
    for path in written:
        try:
            path.unlink()
        except OSError as exc:  # noqa: BLE001 - 同上
            logger.warning("清理未完成的字体文件失败（%s）：%s", path.name, exc)


def _failure_message(exc: Exception) -> str:
    """把异常翻成一句**只写原因**的文案（动作由前端拼，见 docs/ui-copy-guide.md）。"""
    text = str(exc).strip()
    if isinstance(exc, FontDownloadError) and text:
        return text
    if isinstance(exc, httpx.HTTPError):
        return "字体下载失败，网络不可用"
    return f"字体下载失败：{text}" if text else "字体下载失败"


def delete() -> list[str]:
    """删除已下载的两个字体文件，返回被删掉的文件名。

    Raises:
        FontNotDownloaded: 本机没有这两个文件。
    """
    removed: list[str] = []
    for entry in BUILTIN_FILES:
        path = _target(entry)
        try:
            path.unlink()
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise FontDownloadError(f"字体文件删除失败：{exc}") from exc
        removed.append(str(entry["name"]))
    with _lock:
        _state.update({"state": "idle", "error": "", "downloaded_bytes": 0})
    if not removed:
        raise FontNotDownloaded("字体尚未下载")
    logger.info("已删除内置字体：%s", "、".join(removed))
    return removed


def reset_state() -> None:
    """把进程内状态复位（测试与"取消下载"用；不动磁盘上的文件）。"""
    with _lock:
        _state.update({"state": "idle", "error": "", "downloaded_bytes": 0})


__all__ = [
    "BASE_URL",
    "BUILTIN_FILES",
    "FONT_ID",
    "FONT_LABEL",
    "FontBusy",
    "FontDiskFull",
    "FontDownloadError",
    "FontNotDownloaded",
    "delete",
    "downloaded_names",
    "fonts_dir",
    "reset_state",
    "start_download",
    "status",
    "total_bytes",
]
