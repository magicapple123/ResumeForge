# SPDX-License-Identifier: Apache-2.0
"""把一段文本写进本机剪贴板（CR-07 的「复制 Key」）。

**为什么在后端做**：浏览器里有 ``navigator.clipboard``，但它拿不到密钥——设计上任何
响应都不许出现明文（``credentials.state`` 的注释就是这条）。要让用户"复制一把密钥"，
只能由持有明文的进程来写剪贴板，而那个进程是后端。

三个平台的实现都很短，但**失败方式必须收口**：剪贴板被别的进程独占、Linux 上没有
``wl-copy``、非图形会话——这些都抛 :class:`ClipboardError`，由 API 层翻成 503 并给一句
"怎么办"，绝不把明文带进错误信息或日志（``__str__`` 只有平台与原因）。

安全边界：本模块**只写不读**，且不记日志。调用方（``api/connections.py``）负责决定
"谁可以复制"（未配置 → 409，系统来源 → 404）。
"""

from __future__ import annotations

import ctypes
import logging
import shutil
import subprocess
import sys

logger = logging.getLogger(__name__)

#: Windows 剪贴板的纯文本格式号。
CF_UNICODETEXT = 13
#: 外部命令的超时（秒）：剪贴板操作是交互级动作，卡住就是环境坏了。
_TIMEOUT_SECONDS = 5


class ClipboardError(RuntimeError):
    """写剪贴板失败。``str(exc)`` 可直接展示给用户，且**不含被复制的文本**。"""


def write_text(value: str) -> None:
    """把 ``value`` 写进系统剪贴板；失败抛 :class:`ClipboardError`。

    空串不写（复制空内容没有意义，而且会让用户以为成功了）。
    """
    text = str(value or "")
    if not text:
        raise ClipboardError("没有可复制的内容（这条连接尚未配置密钥）")
    if sys.platform == "win32":
        _write_windows(text)
        return
    if sys.platform == "darwin":
        _write_command(["pbcopy"], text)
        return
    _write_command(_linux_command(), text)


def _write_windows(text: str) -> None:
    """``OpenClipboard`` → ``EmptyClipboard`` → ``SetClipboardData(CF_UNICODETEXT)``。

    剪贴板是全局独占资源，任何一步失败都必须 ``CloseClipboard``，否则整台机器的复制
    粘贴都会失灵——这里的 ``finally`` 不是风格问题。
    """
    kernel32 = ctypes.windll.kernel32  # pyright: ignore[reportAttributeAccessIssue]
    user32 = ctypes.windll.user32  # pyright: ignore[reportAttributeAccessIssue]
    # 显式声明类型：64 位下句柄是 8 字节，默认 int 返回会被截断。
    kernel32.GlobalAlloc.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
    user32.SetClipboardData.restype = ctypes.c_void_p

    buffer = ctypes.create_unicode_buffer(text)
    size = ctypes.sizeof(buffer)
    if not user32.OpenClipboard(None):
        raise ClipboardError("剪贴板正被其它程序占用，请稍后再点一次「复制」")
    handle = None
    try:
        if not user32.EmptyClipboard():
            raise ClipboardError("清空剪贴板失败，请稍后再点一次「复制」")
        handle = kernel32.GlobalAlloc(0x0042, size)  # GMEM_MOVEABLE | GMEM_ZEROINIT
        if not handle:
            raise ClipboardError("系统内存不足，本次复制未完成")
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            raise ClipboardError("写入剪贴板失败，请稍后再点一次「复制」")
        try:
            ctypes.memmove(pointer, ctypes.addressof(buffer), size)
        finally:
            kernel32.GlobalUnlock(handle)
        if not user32.SetClipboardData(CF_UNICODETEXT, handle):
            raise ClipboardError("写入剪贴板失败，请稍后再点一次「复制」")
        # 所有权已交给系统：成功之后不能再 GlobalFree，否则剪贴板里的内容会被释放。
        handle = None
    finally:
        user32.CloseClipboard()
        if handle:
            kernel32.GlobalFree(handle)


def _linux_command() -> list[str]:
    """Wayland 优先 ``wl-copy``，X11 回退 ``xclip``；都没有就明确报错。"""
    for candidate, args in (("wl-copy", []), ("xclip", ["-selection", "clipboard"])):
        if shutil.which(candidate):
            return [candidate, *args]
    raise ClipboardError(
        "这台机器上没有可用的剪贴板工具（需要 wl-copy 或 xclip）；"
        "请安装其中一个，或用「更换」重新填写密钥"
    )


def _write_command(command: list[str], text: str) -> None:
    """通过外部命令写剪贴板（macOS ``pbcopy`` / Linux ``wl-copy`` / ``xclip``）。"""
    executable = shutil.which(command[0])
    if executable is None:
        raise ClipboardError(f"找不到剪贴板工具 {command[0]}，本次复制未完成")
    try:
        subprocess.run(  # noqa: S603 - 命令常量来自本模块，不含用户输入
            [executable, *command[1:]],
            input=text.encode("utf-8"),
            check=True,
            timeout=_TIMEOUT_SECONDS,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired as exc:
        raise ClipboardError("写剪贴板超时，请稍后再点一次「复制」") from exc
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ClipboardError("写剪贴板失败，请稍后再点一次「复制」") from exc


__all__ = ["CF_UNICODETEXT", "ClipboardError", "write_text"]
