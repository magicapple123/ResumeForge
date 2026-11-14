# SPDX-License-Identifier: Apache-2.0
"""更新下载器的模块级配置常量与进程内状态结构（从 ``update_download.py`` 纯搬迁）。

为什么独立成模块：``update_download.py`` 贴着 500 行预算。测试大量在
``update_download`` 模块命名空间上 monkeypatch（``PROJECT_ROOT`` /
``DOWNLOAD_DIRECTORY`` / ``UPDATE_STATUS_PATH`` / ``_status`` 等），
所以所有**读取**这些名字的函数留在原模块，本模块只承载定义；原模块再导出后，
patch 落点与语义逐字不变。
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx

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

# 更新器的启动标志（提成模块级常量只为让测试能跨平台断言——Linux 上没有这几个
# 常量，`getattr(..., 0)` 会把它们全变成 0，断言就什么也证明不了）。
#
# **2026-10 那次的根因**：这里原本是 `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS`。
# 完整的分离进程**没有控制台**，而 Windows PowerShell 是控制台宿主程序——脚本压根不
# 执行、退出码 0、没有任何输出；后端随后 30×1s 轮询 `runtime/update-status.json` 等
# 不到 `installing` 标记，只能写 `failed` +「更新器没有启动，应用没有退出…」。
# `CREATE_NO_WINDOW` 给的是**隐藏的控制台**（脚本能跑、用户看不到窗口），
# 与 `app/api/system.py::_stop_frontend_process` 是同一个结论、同一组标志。
_CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
# 只用于"**没有**用它"的断言：分离进程没有控制台，见上。
_DETACHED_PROCESS = getattr(subprocess, "DETACHED_PROCESS", 0)


# 本地安装包的命名约定与白名单/逐跳/复验策略都在 `update_sources`：
# `ResumeForge-<版本>.zip` 的挑选、ZIP 结构与 SHA-256 复验是它的一部分。


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
