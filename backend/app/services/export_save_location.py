# SPDX-License-Identifier: Apache-2.0
"""导出产物的额外落盘（设置里的「生成内容保存位置」）。

默认行为是**仅浏览器下载**：设置留空时这里一个字节都不会写，导出响应与历史版本
逐字节一致。用户显式指定了一个文件夹后，导出端点在返回下载响应的同时把同一份产物
再写一份到那里——写失败只记日志，**绝不阻断导出**（best-effort）。
"""

import logging
import os
import secrets
import subprocess
import sys

from .data_backup.asset_safety import safe_asset_name
from .data_backup.paths import BackupError

logger = logging.getLogger(__name__)

# 写探针的文件名：带项目前缀，误留在用户目录里也能认出来。
_PROBE_FILENAME = ".resumeforge_write_probe"

# 文件夹选择器以**独立子进程**运行：tkinter 的 Tcl 解释器不该混进后端主进程，
# 子进程崩了/没装 tkinter 也只影响这一一次点选，主服务照常。
_PICKER_SCRIPT = (
    "import sys\n"
    "try:\n"
    "    sys.stdout.reconfigure(encoding='utf-8')\n"
    "except Exception:\n"
    "    pass\n"
    "import tkinter as tk\n"
    "from tkinter import filedialog\n"
    "root = tk.Tk()\n"
    "root.withdraw()\n"
    "root.attributes('-topmost', True)\n"
    "path = filedialog.askdirectory(title='选择生成内容的保存文件夹')\n"
    "root.destroy()\n"
    "print(path or '')\n"
)
_PICKER_TIMEOUT_SECONDS = 300  # 用户在原生对话框里停留多久都行，超时只算失败


def validate_directory(path: str) -> str | None:
    """校验本机原生文件夹选择器返回的导出目录。返回 ``None`` 表示合法，否则返回中文原因。

    除了 ``isdir`` 检查还做一次**写探针**（创建并删除临时文件）：目录存在但被
    占用/只读时，"看起来存在"和"真的能写"是两回事，失败要在保存设置时就说清，
    而不是等用户导出时才发现什么都没落盘。
    """
    directory = (path or "").strip()
    if not directory:
        return "路径不能为空"
    if not os.path.exists(directory):
        return "目录不存在"
    if not os.path.isdir(directory):
        return "不是目录"
    probe_path = os.path.join(directory, f"{_PROBE_FILENAME}-{secrets.token_hex(8)}")
    try:
        with open(probe_path, "x", encoding="utf-8"):
            pass
    except OSError:
        return "目录不可写"
    try:
        os.remove(probe_path)
    except OSError:
        # 能创建就说明可写；删不掉只留一个探针小文件，不该因此判成不可写。
        logger.warning("导出目录写探针文件清理失败，已保留空探针；导出目录可写")
    return None


def save_artifact(content: bytes, directory: str, base_name: str) -> str:
    """把导出产物写入 ``directory``，返回最终落盘路径。

    同名文件已存在时加时间戳后缀防覆盖（再撞就追加序号）；创建/写入失败时异常
    上抛，由调用方做 best-effort 处理（记日志、不阻断导出）。
    """
    directory = directory.strip()
    try:
        base_name = safe_asset_name(base_name)
    except BackupError as exc:
        raise ValueError("导出文件名不安全，未写入保存目录") from exc
    stem, ext = os.path.splitext(base_name)
    for attempt in range(100):
        candidate = base_name if attempt == 0 else f"{stem}_{secrets.token_hex(8)}{ext}"
        target = os.path.join(directory, candidate)
        try:
            # The user explicitly selected this directory. Only a safe basename is appended;
            # exclusive creation keeps even a last-moment arrival byte-for-byte unchanged.
            with open(target, "xb") as handle:
                handle.write(content)
            return target
        except FileExistsError:
            continue
    raise OSError("保存目录文件名冲突过多，请稍后重试")


class FolderPickerUnavailable(RuntimeError):
    """本机环境打不开原生文件夹选择器（如运行时缺 tkinter）。"""


def pick_directory() -> str | None:
    """弹出本机原生「选择文件夹」对话框，返回所选绝对路径；取消返回 ``None``。

    为什么走子进程：tkinter/Tcl 不宜嵌入常驻的后端进程（线程模型与事件循环都
    不友好），一次性子进程最干净——崩溃只影响本次点选，路径经 stdout 用 UTF-8
    传回（脚本里显式 reconfigure，Windows 默认 cp936 也不会乱码）。
    """
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    try:
        proc = subprocess.run(  # noqa: S603 - 固定脚本、无用户输入参与
            [sys.executable, "-c", _PICKER_SCRIPT],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=_PICKER_TIMEOUT_SECONDS,
            creationflags=creationflags,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("文件夹选择器启动失败：%s", exc)
        raise FolderPickerUnavailable("无法打开文件夹选择器，请重试") from exc
    if proc.returncode != 0:
        # 最常见原因：便携运行时未带 tkinter（ModuleNotFoundError）。
        logger.warning(
            "文件夹选择器退出码 %s：%s", proc.returncode, (proc.stderr or "").strip()[:200]
        )
        raise FolderPickerUnavailable("无法打开文件夹选择器，请重试")
    selected = (proc.stdout or "").strip()
    return selected or None
