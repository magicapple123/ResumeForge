# SPDX-License-Identifier: Apache-2.0
"""在系统文件管理器里定位一个本机文件（仓库内唯一实现）。

用户点「在文件夹中显示」时要做的是**去看文件在哪里**，不是打开文件本身：

- Windows：``explorer /select,<path>``——进到所在文件夹并选中该文件；
- macOS：``open -R <path>``——在 Finder 里选中该文件；
- Linux：``xdg-open <所在目录>``——只能打开目录，没有统一的「选中文件」语义
  （平台限制：文案不要承诺「选中」）。

**发起即成功**：``explorer /select`` 定位成功也常返回非零退出码（文档化行为），
所以这里用 ``Popen`` 发起后立即返回、不等待也不看退出码——以退出码判失败会把
「其实已经打开了」报成失败。

这个模块存在的理由只有一个：``api/user_files.py``（按 ``file_id`` 打开副本所在
文件夹）与 ``api/stats.py``（清理清单里的相对路径）需要同一套平台分支。两处各写
一遍 ``explorer /select`` 迟早会漂（一个改 bug 另一个不改）。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def reveal_command(path: Path) -> list[str]:
    """返回「在当前平台定位这个文件」的命令行。

    纯函数、不发起进程：逐平台的断言（``explorer /select,`` 的逗号是语法的一部分）
    可以在测试里直接比对，不必真的开文件管理器。
    """
    target = Path(path)
    if sys.platform == "win32":
        # explorer 的 /select 后面必须紧跟目标路径，逗号属于语法。
        return ["explorer", f"/select,{target}"]
    if sys.platform == "darwin":
        return ["open", "-R", str(target)]
    # Linux 等：只能打开所在目录（xdg-open 没有通用的「选中」参数）。
    return ["xdg-open", str(target.parent)]


def reveal_path(path: Path) -> None:
    """在系统文件管理器里定位 ``path``：发起即成功，不等退出码。

    可执行文件缺失、没有权限等失败情形以异常抛出，由调用方翻成一句用户可读的原因
    （这一层不写面向用户的中文，因为它不知道调用方的语境）。
    """
    subprocess.Popen(reveal_command(path))  # noqa: S603 - 本机文件管理器语义，参数来自服务端自身


__all__ = ["reveal_command", "reveal_path"]
