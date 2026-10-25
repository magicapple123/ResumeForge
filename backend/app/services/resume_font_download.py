# SPDX-License-Identifier: Apache-2.0
"""单个字体文件的「下载 → 校验」执行块，以及取消用的那几件运行时工具。

**为什么单独成文件**：``resume_font_builtin`` 持有状态机与 API 契约，已贴 500 行预算
（见 ``backend/tests/test_file_size_budget.py``）。这里只做机械活：读流、算 sha256、
数字节、删临时文件；那台状态机仍然只有一个主人。

**边界**（两张表不要混）：
- 状态（``state`` / ``error`` / ``downloaded_bytes``）住在 ``resume_font_builtin``，
  对外就是 ``BuiltinFontStatus``。
- "一次下载"的运行时（取消信号 ``stop``、在飞连接 ``Client``、本轮已落地文件
  ``written``、以及**唯一那把锁** ``lock``）住在这里——它们的生命周期是"一次下载"，
  不是"一份状态"。

两者共用同一把 ``lock``：``resume_font_builtin`` 直接 ``from`` 这里的 ``lock``。这不是
图省事——"登记 client"与"读取消信号"必须原子，否则会出现"信号到了但没人关连接"的
窗口，那一次取消就要白等 60s 读超时。

**本模块不 import ``resume_font_builtin``**（会成环），也不知道字体目录、URL、文件
清单、状态字典长什么样：这些都由调用方传进来。同理 ``httpx`` 由调用方注入
（``fetch`` 的 ``new_client``）——测试 monkeypatch 的是 ``resume_font_builtin.httpx``，
这里若自己 ``import httpx``，那个替身就失效了，真实网络会打进单测。
"""

from __future__ import annotations

import hashlib
import logging
import threading
from collections.abc import Callable
from pathlib import Path
from types import TracebackType
from typing import Any, Protocol

logger = logging.getLogger(__name__)

# 每读一块就回报一次进度：轮询接口的进度条要"动起来"，但锁竞争不能太频繁。
CHUNK_SIZE = 64 * 1024
TMP_SUFFIX = ".tmp"
# 等下载线程收尾的上限；超时的语义是"取消已发出、线程还在收尾"，不是"取消失败"。
CANCEL_JOIN_TIMEOUT = 5.0

# 进程内唯一一把锁：状态字典与在飞连接共用（理由见模块 docstring）。
lock = threading.Lock()
# 取消信号：``start_download`` 复位、``cancel`` 置位、下载线程在三个检查点读它。
stop = threading.Event()
# **本轮**已 rename 成功的文件：取消只删这里面的，历史文件与用户上传的字体一个都不误删。
written: list[Path] = []


class Client(Protocol):
    """下载用得到的 ``httpx.Client`` 子集——真实客户端与测试替身可以互换。

    ``__exit__`` 按 httpx.Client 的真实形状声明（三个可选入参、返回 None）：
    写成 ``(*exc: object)`` 的话，真实 httpx.Client 反而对不上协议（它最多收 3 个
    定位参数，协议却允许任意个），``fetch(new_client=httpx.Client)`` 会被 pyright 拒收。
    测试替身更宽松（``*exc``），仍然可互换。
    """

    def stream(self, method: str, url: str) -> Any: ...

    def close(self) -> None: ...

    def __enter__(self) -> Any: ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None = None,
        exc_value: BaseException | None = None,
        traceback: TracebackType | None = None,
    ) -> None: ...


# 在飞连接：只置 ``stop`` 不够——线程会卡在 ``iter_bytes()`` 上直到读超时，用户等不了。
_client: Client | None = None


class Cancelled(Exception):
    """内部哨兵：**取消不是失败**。调用方必须把它与真失败分开处理。"""


class ChecksumError(RuntimeError):
    """字节数或 sha256 对不上：镜像被换过、下载被截断、磁盘写坏都会走到这里。"""


def reset_run_locked() -> None:
    """复位取消信号、在飞连接、本轮文件清单。**调用方必须持 ``lock``。**

    必须与"置 ``downloading`` 并起线程"在同一个锁段里：晚一步清，上一轮的取消信号
    会让新线程一出场就退出，上一轮的清单会让"紧接着取消"误删刚下好的文件。
    """
    global _client
    stop.clear()
    _client = None
    written.clear()


def begin_client(client: Client) -> bool:
    """登记在飞客户端；返回 ``True`` 表示**登记的同一刻已被取消**。

    登记与"是否已取消"放在同一个锁段里，取消与下载之间就不存在"信号到了、但没人
    关连接"的时间窗——那正是最坏情况下要白等 60s 读超时的路径。
    """
    global _client
    with lock:
        _client = client
        return stop.is_set()


def end_client(client: Client) -> None:
    """注销在飞客户端（只注销自己那一个：另一轮可能已经登记了新连接）。"""
    global _client
    with lock:
        if _client is client:
            _client = None


def close_inflight() -> None:
    """关掉此刻在飞的连接；**关不上也绝不抛**（取消的语义是"停下"，不是"再报错"）。

    Windows 上关一个对端已断的连接可能抛 ``OSError``（传输层退出清理时再摸一次失效
    句柄）。吞掉并降级 debug：唯一后果是这一轮取消可能落到 ``join`` 超时分支，由前端
    继续轮询到 ``idle``。
    """
    with lock:
        client = _client
    if client is None:
        return
    try:
        client.close()
    except Exception as exc:  # noqa: BLE001 - 见 docstring
        logger.debug("关闭字体下载连接失败（忽略）：%s", exc)


def written_paths() -> list[Path]:
    """本轮已落地文件的快照（持锁取，调用方在锁外删）。"""
    with lock:
        return list(written)


def raise_if_cancelled() -> None:
    if stop.is_set():
        raise Cancelled


def cleanup(paths: list[Path], directory: Path) -> None:
    """失败/取消收尾：删掉目录下所有 ``.tmp``，以及本轮已落地但**凑不成一对**的正式文件。

    只留一半（Regular 在、Bold 不在）对用户毫无价值，还会白占 15MB；下一次点击下载
    会完整重来一遍。
    """
    if directory.is_dir():
        for path in directory.glob(f"*{TMP_SUFFIX}"):
            try:
                path.unlink()
            except OSError as exc:  # noqa: BLE001 - 清理失败不该盖住原始错误
                logger.warning("清理临时字体文件失败（%s）：%s", path.name, exc)
    for path in list(paths):
        try:
            path.unlink()
        except OSError as exc:  # noqa: BLE001 - 同上
            logger.warning("清理未完成的字体文件失败（%s）：%s", path.name, exc)


def fetch(
    url: str,
    temp: Path,
    *,
    expected_bytes: int,
    expected_sha256: str,
    new_client: Callable[[], Client],
    on_progress: Callable[[int], None],
) -> None:
    """把 ``url`` 下到 ``temp`` 并校验（字节数 + sha256 双校验）。

    成败都由这个函数收口：失败或取消时 ``temp`` **一定**被删掉，绝不留半份文件。

    Raises:
        Cancelled: 收到取消信号，或连接被 ``close_inflight()`` 打断（调用方必须把它
            归为"取消"而不是"下载失败"，否则界面上会冒出莫名其妙的失败文案）。
        ChecksumError: 字节数或 sha256 对不上。
    """
    temp.parent.mkdir(parents=True, exist_ok=True)
    temp.unlink(missing_ok=True)
    digest = hashlib.sha256()
    size = 0
    client = new_client()
    try:
        if begin_client(client):
            raise Cancelled
        with client, client.stream("GET", url) as response:
            response.raise_for_status()
            with temp.open("wb") as handle:
                for chunk in response.iter_bytes(CHUNK_SIZE):
                    # 每块之后检查：取消在"块与块之间"到达时立刻收手，不必等下一块。
                    raise_if_cancelled()
                    if not chunk:
                        continue
                    handle.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                    on_progress(len(chunk))
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    finally:
        end_client(client)
    if size != expected_bytes or digest.hexdigest() != expected_sha256:
        temp.unlink(missing_ok=True)
        raise ChecksumError("校验失败，文件不完整")


__all__ = [
    "CANCEL_JOIN_TIMEOUT",
    "CHUNK_SIZE",
    "TMP_SUFFIX",
    "Cancelled",
    "ChecksumError",
    "Client",
    "begin_client",
    "cleanup",
    "close_inflight",
    "end_client",
    "fetch",
    "lock",
    "raise_if_cancelled",
    "reset_run_locked",
    "stop",
    "written",
    "written_paths",
]
