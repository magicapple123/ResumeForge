# SPDX-License-Identifier: Apache-2.0
"""资产归档的传输层：下载一个文件到临时路径并做**字节数 + sha256 双校验**。

从下载状态机里拆出来的只有"机械活"（组 client、读流、算哈希、数字节、关连接、删临时
文件）——状态、进度与源优先级仍只有 ``rag_model_download`` 一个主人。拆分的直接原因是
任务书 §3.3 的 ≤300 行硬约束，而不是第二套语义。

``httpx`` 由本模块持有：测试 monkeypatch ``rag_asset_archive.httpx`` 即可让单测不联网。
取消语义是"停下"：``stop`` 事件置位或 :func:`close_inflight` 关掉在飞连接，一律以
:class:`Cancelled` 结束（调用方必须把它与真失败分开）。
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import shutil
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024
CANCEL_JOIN_TIMEOUT = 5.0
_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)

_lock = threading.Lock()
_client: Any = None


class AssetArchiveError(RuntimeError):
    """下载/校验失败；消息可直接展示（只写原因）。"""


class Cancelled(Exception):
    """内部哨兵：取消不是失败。"""


def open_client() -> httpx.Client:
    """建一个下载客户端（测试替换本模块的 ``httpx`` 即可整体离线）。"""
    return httpx.Client(timeout=_TIMEOUT, follow_redirects=True)


def close_inflight() -> None:
    """关掉此刻在飞的连接；关不上也绝不抛（取消的语义是"停下"）。"""
    with _lock:
        client = _client
    if client is None:
        return
    try:
        client.close()
    except Exception:  # noqa: BLE001 - 取消路径不额外报错
        logger.debug("关闭本地资产下载连接失败", exc_info=True)


def reset() -> None:
    """清掉在飞客户端引用（测试 / 新一轮下载开始前用；不关闭连接）。"""
    global _client
    with _lock:
        _client = None


def _http_failure_reason(exc: Exception) -> str:
    """HTTP 层异常 → 可展示原因：状态码优先，只有连接/超时/DNS 才叫「网络不可用」。

    「资源没发布」和「网络断了」是两种完全不同的补救动作（等发布 vs 查网络），一律报成
    后者会让用户去修根本没坏的网络。判定只用**鸭子类型**读 ``exc.response.status_code``：
    单测用 ``SimpleNamespace`` 替身注入本模块的 ``httpx``（只提供 ``Client`` 与
    ``HTTPError``），在这里直接引用 ``httpx.HTTPStatusError`` 会让整片用例在导入期就红。
    """
    status = getattr(getattr(exc, "response", None), "status_code", None)
    try:
        code = int(status) if status is not None else 0
    except (TypeError, ValueError):
        code = 0
    if code in (404, 410):
        return f"本地模型资产下载源不可用（资源未发布或地址失效，HTTP {code}）"
    if 400 <= code < 600:
        return f"本地模型资产下载源返回 HTTP {code}"
    return "本地模型资产下载失败，网络不可用"


def fetch(
    url: str,
    temp: Path,
    *,
    expected_bytes: int,
    expected_sha256: str,
    on_progress: Callable[[int], None],
    stop: threading.Event,
) -> None:
    """下载到 ``temp`` 并校验；失败或取消时 **temp 一定被删掉**，绝不留半份文件。

    Raises:
        Cancelled: 收到取消信号，或连接被 :func:`close_inflight` 打断。
        AssetArchiveError: 响应异常/字节数或 sha256 对不上；消息按状态码分类，
            404/410 说「下载源不可用」，其他 4xx/5xx 报状态码，连接类才说「网络不可用」。
    """
    global _client
    temp.parent.mkdir(parents=True, exist_ok=True)
    temp.unlink(missing_ok=True)
    digest = hashlib.sha256()
    size = 0
    client = open_client()
    try:
        with _lock:
            _client = client
            cancelled = stop.is_set()
        if cancelled:
            raise Cancelled
        with client, client.stream("GET", url) as response:
            response.raise_for_status()
            with temp.open("wb") as handle:
                for chunk in response.iter_bytes(CHUNK_SIZE):
                    if stop.is_set():
                        raise Cancelled
                    if chunk:
                        handle.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                        on_progress(len(chunk))
        if size != expected_bytes or digest.hexdigest().casefold() != expected_sha256.casefold():
            raise AssetArchiveError("本地模型资产校验失败（文件不完整）")
    except (Cancelled, AssetArchiveError):
        temp.unlink(missing_ok=True)
        raise
    except httpx.HTTPError as exc:
        temp.unlink(missing_ok=True)
        raise AssetArchiveError(_http_failure_reason(exc)) from exc
    except OSError as exc:
        temp.unlink(missing_ok=True)
        raise AssetArchiveError("本地模型资产写入失败（磁盘空间或权限不足）") from exc
    except Exception:
        # 取消会表现为任意传输层异常（连接被 close_inflight 打断）；一律清临时文件再抛。
        temp.unlink(missing_ok=True)
        raise
    finally:
        with _lock:
            if _client is client:
                _client = None
        try:
            client.close()
        except Exception:  # noqa: BLE001 - 收尾忽略
            logger.debug("关闭本地资产下载连接失败", exc_info=True)


def cleanup_stale(target: Path) -> None:
    """尽力清理上一次因 DLL 占用而改名留下的 *.stale-* 目录（不告警、不阻塞）。"""
    try:
        stale = list(target.parent.glob(f"{target.name}.stale-*"))
    except OSError:
        return
    for path in stale:
        shutil.rmtree(path, ignore_errors=True)


def remove_tree(target: Path) -> None:
    """删除一个资产目录；Windows 上已加载的 .pyd/DLL 会锁住目录。

    锁住时**改名移走**（规范路径立即回到"未下载"，重新下载不受影响），残留的
    *.stale-* 由 :func:`cleanup_stale` 在之后的下一次删除/下载时尽力清掉。
    """
    cleanup_stale(target)
    if not target.exists():
        return
    try:
        shutil.rmtree(target)
    except OSError:
        stale = target.with_name(f"{target.name}.stale-{secrets.token_hex(4)}")
        try:
            target.rename(stale)
        except OSError as exc:
            raise AssetArchiveError("本地运行时正被占用，删除失败") from exc
        shutil.rmtree(stale, ignore_errors=True)


__all__ = [
    "CANCEL_JOIN_TIMEOUT",
    "CHUNK_SIZE",
    "AssetArchiveError",
    "Cancelled",
    "cleanup_stale",
    "close_inflight",
    "fetch",
    "open_client",
    "remove_tree",
    "reset",
]
