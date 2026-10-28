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

import logging
import shutil
import threading
from pathlib import Path
from typing import cast

import httpx

from ..config import DATA_DIR
from .resume_font_download import (
    CANCEL_JOIN_TIMEOUT,
    TMP_SUFFIX,
    Cancelled,
    ChecksumError,
    cleanup,
    close_inflight,
    fetch,
    raise_if_cancelled,
    reset_run_locked,
    written_paths,
)
from .resume_font_download import lock as _lock
from .resume_font_download import stop as _stop
from .resume_font_download import written as _run_written

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


class FontDeleteError(RuntimeError):
    """删除字体文件失败（被占用 / 无权限）：文件保留原样，API 映射 500，不假装成功。"""


# 进程内单例：状态与进度都在这里，接口只读它。取消信号（``_stop``）、在飞连接、本轮
# 文件清单（``_run_written``）与**这把锁**住在 ``resume_font_download``：它们的生命周期
# 是"一次下载"，和这里的"一份状态"不同源，但必须共用同一把锁（理由见那个模块的 docstring）。
_state: dict[str, object] = {"state": "idle", "error": "", "downloaded_bytes": 0}
_worker: threading.Thread | None = None
# 本轮的"下载完成后是否接管当前字体"（P0-3：在制作台里下载不该改全局字体）。
# 唯一消费者是 ``take_auto_activate()``；三条终止路径都会把它复位成 True（见 ``_apply``）。
_auto_activate = True
# "这一轮下载**刚刚**真正成功"的一次性令牌，唯一消费者是 ``consume_completion()``。
#
# **为什么不能只靠 ``_auto_activate``**：那个开关没有下载在跑时恒为 True（模块默认值，
# 且每次取用都复位成 True），所以它答不了"此刻是不是刚下完"。而 ``GET /fonts/builtin``
# 是个**只读**轮询端点，前端每进一次设置页都会打它——用 ``_auto_activate`` 直接判定的
# 结果是"每次轮询都接管一次当前字体"，用户点了「回到系统字体」（``active = None``）之后
# 会被静默改回 Regular，刷新也治不好。
#
# 所以"刚下完"必须由写侧显式置位：只有本轮下载真正落地成功（以及"文件已存在"那次短路，
# 用户毕竟是主动点了下载）才置 True，三条终止路径（完成/失败/取消）都会把它清干净。
_completion_pending = False


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
    """下载状态；``state`` ∈ ``idle | downloading | failed | done``。

    ``cancelling`` 只是**提示位**（取消信号已发出、线程正在收尾），**不是**第五种状态：
    任何分支判断都必须读 ``state``（见 docs/system_design.md §5.3）。
    """
    with _lock:
        state = str(_state.get("state") or "idle")
        error = str(_state.get("error") or "")
        progress = cast(int, _state.get("downloaded_bytes") or 0)
        cancelling = bool(_state.get("cancelling"))
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
    if state != "downloading":
        # 收尾完成（或根本没在下）时这个提示位没有意义，一律清掉。
        cancelling = False
    return {
        "id": FONT_ID,
        "label": FONT_LABEL,
        "size_total": total,
        "downloaded": downloaded,
        "downloaded_bytes": max(0, min(progress, total)),
        "total_bytes": total,
        "state": state,
        "error": error,
        "cancelling": cancelling,
    }


def _available_bytes() -> int | None:
    """可用磁盘空间；连目录都不存在时退到数据目录再试，都拿不到就不预检（返回 None）。"""
    for candidate in (fonts_dir(), Path(DATA_DIR)):
        try:
            return int(shutil.disk_usage(candidate).free)
        except OSError:
            continue
    return None


def start_download(activate: bool = True) -> dict:
    """启动后台下载并立刻返回当前状态（HTTP 202 的语义）。

    Args:
        activate: 下载完成后是否接管当前字体。``False`` 供"制作台里下载"用（P0-3：那
            只该成为这份简历的字体，不该改掉全局选择）。缺省 ``True`` = 今天的行为。

    Raises:
        FontBusy: 已有一个下载在跑。**这种情况下不动** ``activate``：改它等于污染
            正在跑的那一轮（它会读到别人的开关）。
        FontDiskFull: 剩余空间不足 ``total_bytes * DISK_HEADROOM``。
    """
    global _auto_activate
    with _lock:
        if str(_state.get("state") or "") == "downloading":
            raise FontBusy("字体正在下载中")
        _auto_activate = activate
        if all(_is_present(item) for item in BUILTIN_FILES):
            # 没有下载就没有"本轮"：保持今天的行为（轮询照常接管），也别把 False 留在
            # 全局给下一次普通下载继承。用户是主动点了下载，接管一次仍然合理，所以
            # 这里也置"刚完成"令牌（与真下载落地的语义一致）。
            _auto_activate = True
            _apply("done", progress=total_bytes(), keep_switch=True, completion=True)
        else:
            free = _available_bytes()
            if free is not None and free < total_bytes() * DISK_HEADROOM:
                raise FontDiskFull("磁盘空间不足，无法保存字体")
            fonts_dir().mkdir(parents=True, exist_ok=True)
            # 取消信号与文件清单必须在**起线程之前、持锁**复位：晚一步清，上一轮的信号
            # 会让新线程一出场就退出，上一轮的清单会让"紧接着取消"误删刚下好的文件。
            reset_run_locked()
            _apply("downloading", keep_switch=True)
            _spawn_worker()
    return status()


def take_auto_activate() -> bool:
    """取出并复位"本轮下载完成后是否接管当前字体"。

    唯一消费者是 ``api/font_builtin._ensure_active``：它在下一次轮询到 ``done`` 时读
    一次，然后**无论结果如何都复位成 True**。不复位的话，一次"从制作台下载"会让之后
    所有普通下载都静默地不设当前字体——表现是"下载完没生效，重下也没用"，极难查。

    **注意它不是一次性令牌**：没有下载在跑时它恒为 True（模块默认值，取用后也复位成
    True）。"此刻是不是刚下完"由 :func:`consume_completion` 回答，两者必须配合使用。
    """
    global _auto_activate
    with _lock:
        value = _auto_activate
        _auto_activate = True
        return value


def consume_completion() -> bool:
    """取走"这一轮下载刚刚真正完成"的令牌：读出即复位（真正的一次性）。

    唯一消费者是 ``api/font_builtin._ensure_active``，用来把"下载完成时接管当前字体"
    收敛成**一次性**动作。没有这一步，只读的 ``GET /fonts/builtin`` 会在每次轮询时
    再接管一次，把用户选的「系统字体」静默改回内置 Regular。
    """
    global _completion_pending
    with _lock:
        value = _completion_pending
        _completion_pending = False
        return value


def _spawn_worker() -> None:
    """在锁内调用：起一个 daemon 线程。进程退出时不该被下载卡住。"""
    global _worker
    _worker = threading.Thread(target=_run_download, name="builtin-font-download", daemon=True)
    _worker.start()


def _apply(
    state: str,
    *,
    error: str = "",
    progress: int = 0,
    keep_switch: bool = False,
    completion: bool = False,
) -> None:
    """写状态（**调用方必须已持锁**）：四条路径共用同一个形状，免得字段慢慢漂开。

    ``keep_switch=False`` 时顺带把"下载完成后是否接管当前字体"复位：done / failed /
    cancelled 三条终止路径**都必须**做这一步，集中在这里才不会漏（漏一处的表现是
    "上一次从制作台下载，之后所有下载都不设当前字体"）。``done`` 那一笔是例外
    （``keep_switch=True``）——开关要留给下一次轮询去取用。

    ``completion`` 决定要不要置"这一轮下载刚刚真正完成"的一次性令牌。**只有"
    下载真的落地成功"那两处（后台线程跑完 / 文件已存在时的短路）传 True**；
    失败、取消、删除、复位这些路径一律默认 False，顺手把上一轮可能残留的令牌清掉
    ——脏令牌的表现是"某次普通轮询忽然把当前字体改回内置 Regular"。
    """
    global _auto_activate, _completion_pending
    _state.update(
        {"state": state, "error": error, "downloaded_bytes": progress, "cancelling": False}
    )
    if not keep_switch:
        _auto_activate = True
    _completion_pending = completion


def _advance(delta: int) -> None:
    with _lock:
        _state["downloaded_bytes"] = cast(int, _state.get("downloaded_bytes") or 0) + delta


def _run_download() -> None:
    """后台线程主体：顺序下两个文件，全成功才置 done。"""
    written = _run_written
    try:
        fonts_dir().mkdir(parents=True, exist_ok=True)
        for entry in BUILTIN_FILES:
            _download_one(entry, written)
        with _lock:
            # 【竞态唯一裁决点】两个文件都已 rename 成功 → **以完成为准**：此刻哪怕
            # ``_stop`` 已被置位（取消与完成撞车），也保留文件、落 done。删掉刚下好的
            # 32MB 是净损失——他要的就是这份字体，只是慢了一步，``status()`` 会如实说。
            _stop.clear()
            _apply("done", progress=total_bytes(), keep_switch=True, completion=True)
        logger.info("内置字体下载完成：%s", FONT_LABEL)
    except Cancelled:
        _finish_cancelled(written)
    except Exception as exc:  # noqa: BLE001 - 任何失败都要落成可读状态，不能让线程静默死掉
        if _stop.is_set():
            # 关客户端会让阻塞中的读抛错（StreamClosed / ReadError）：这仍然是**取消**，
            # 不能写成 failed——否则界面上会冒出"下载失败"，而用户明明是自己点的取消。
            _finish_cancelled(written)
            return
        logger.warning("内置字体下载失败：%s", exc)
        cleanup(written, fonts_dir())
        with _lock:
            _apply("failed", error=_failure_message(exc))


def _finish_cancelled(written: list[Path]) -> None:
    """取消收尾（线程侧）：清本轮文件与所有 ``.tmp``，状态回 ``idle``，**不留 failed 文案**。"""
    logger.info("内置字体下载已取消")
    cleanup(written, fonts_dir())
    with _lock:
        _apply("idle")


def _open_client() -> httpx.Client:
    """建一个下载客户端。``httpx`` **从本模块**取：测试替换的就是这里的这个名字。"""
    return httpx.Client(timeout=_TIMEOUT, follow_redirects=True)


def _download_one(entry: dict, written: list[Path]) -> None:
    """下载一个文件到 ``<name>.tmp``，校验通过后 rename 成正式文件。"""
    raise_if_cancelled()
    target = _target(entry)
    temp = target.with_name(target.name + TMP_SUFFIX)
    try:
        fetch(
            f"{BASE_URL}{entry['name']}",
            temp,
            expected_bytes=int(entry["bytes"]),
            expected_sha256=str(entry["sha256"]),
            new_client=_open_client,
            on_progress=_advance,
        )
    except ChecksumError as exc:
        # 校验失败是**业务失败**（文案可直接给用户看），不是取消：翻成业务异常。
        raise FontDownloadError(str(exc)) from exc
    if _stop.is_set():
        # rename 之前再看一眼：已经取消就别把这一份落成正式文件（落一个"半对"更糟）。
        temp.unlink(missing_ok=True)
        raise Cancelled
    temp.replace(target)
    with _lock:
        written.append(target)


def _failure_message(exc: Exception) -> str:
    """把异常翻成一句**只写原因**的文案（动作由前端拼，见 docs/ui-copy-guide.md）。"""
    text = str(exc).strip()
    if isinstance(exc, FontDownloadError) and text:
        return text
    if isinstance(exc, httpx.HTTPError):
        return "字体下载失败，网络不可用"
    return f"字体下载失败：{text}" if text else "字体下载失败"


def cancel() -> dict:
    """取消正在进行的下载，返回取消后的状态（**幂等**：没有下载在跑就原样返回）。

    时序：① 持锁读 ``state``，不是 ``downloading`` 就返回 ``status()``（磁盘一字节不动，
    顺带兜住"刚好下完"的竞态：以完成为准）；② 置 ``_stop`` + ``cancelling``，取出线程
    句柄；③ **关掉在飞连接**（``close_inflight()``）——只置 Event 的话线程会阻塞在
    ``iter_bytes()`` 上直到 60s 读超时，用户等不了；④ ``join(CANCEL_JOIN_TIMEOUT)`` 等
    线程自己收尾（在下载线程**自己**里调用时跳过 join，否则 join 自己会抛）；⑤ 复核，
    见 ``_settle_after_cancel``。

    这里**不碰**当前字体：取消不改 ``user_fonts`` 的选择。
    """
    with _lock:
        running = str(_state.get("state") or "") == "downloading"
        if running:
            _stop.set()
            _state["cancelling"] = True
        worker = _worker
    if not running:
        # 幂等分支：状态与磁盘都保持原样（覆盖 done / idle / failed 三种实况）。
        return status()
    close_inflight()
    if worker is not None and worker is not threading.current_thread() and worker.is_alive():
        worker.join(CANCEL_JOIN_TIMEOUT)
    _settle_after_cancel(worker)
    return status()


def _settle_after_cancel(worker: threading.Thread | None) -> None:
    """取消的收尾复核：只有**线程确实退出了**才由这里清磁盘与复位状态。

    ``join`` 超时（线程还卡在慢盘写入上）时不碰任何文件、也不假装已取消：状态留在
    ``downloading`` + ``cancelling=True``，由线程自己走到 ``idle``，前端继续轮询即可。
    ``cancel()`` 返回的永远是"此刻的真相"，不是一个愿望。
    """
    with _lock:
        if worker is not None and worker.is_alive():
            return
        if str(_state.get("state") or "idle") == "done":
            # 【以完成为准】两个文件都已落地：取消来晚了一步，文件保留、状态 done。
            _state["cancelling"] = False
            return
        _apply("idle")
    written = written_paths()
    # 线程侧已清过一遍，这里是幂等的第二道保险；文件 IO 放在锁外，别把状态接口拖住。
    cleanup(written, fonts_dir())


def delete() -> list[str]:
    """删除已下载的两个字体文件，返回被删掉的文件名。

    Raises:
        FontBusy: 正在下载中——删到一半会让状态与磁盘彻底对不上。
        FontDeleteError: 删不掉（文件被占用 / 无权限）；**文件保留原样**，不假装成功。
        FontNotDownloaded: 本机没有这两个文件。
    """
    with _lock:
        if str(_state.get("state") or "") == "downloading":
            raise FontBusy("字体正在下载中")
    removed: list[str] = []
    for entry in BUILTIN_FILES:
        path = _target(entry)
        try:
            path.unlink()
        except FileNotFoundError:
            continue
        except OSError as exc:
            # 绝不静默成功：删不掉就如实抛，由路由翻成 500 + 原因（文件原样留着，
            # 用户关掉占用它的程序后可以再点一次删除）。
            logger.warning("删除内置字体文件失败（%s）：%s", path.name, exc)
            if isinstance(exc, PermissionError):
                raise FontDeleteError("字体文件正被占用，无法删除") from exc
            raise FontDeleteError("字体文件删除失败") from exc
        removed.append(str(entry["name"]))
    with _lock:
        _apply("idle")
    if not removed:
        raise FontNotDownloaded("字体尚未下载")
    logger.info("已删除内置字体：%s", "、".join(removed))
    return removed


def reset_state() -> None:
    """把进程内状态复位（测试用；不动磁盘上的文件）。

    连取消信号与在飞连接一起复位：留着上一轮的 ``_stop`` 会让下一次下载一出场就自我取消。
    """
    global _worker
    with _lock:
        reset_run_locked()
        _worker = None
        _apply("idle")


__all__ = [
    "BASE_URL",
    "BUILTIN_FILES",
    "CANCEL_JOIN_TIMEOUT",
    "FONT_ID",
    "FONT_LABEL",
    "FontBusy",
    "FontDeleteError",
    "FontDiskFull",
    "FontDownloadError",
    "FontNotDownloaded",
    "cancel",
    "consume_completion",
    "delete",
    "downloaded_names",
    "fonts_dir",
    "reset_state",
    "start_download",
    "status",
    "take_auto_activate",
    "total_bytes",
]
