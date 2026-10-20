# SPDX-License-Identifier: Apache-2.0
"""仅会话使用的 API Key 通道（RF-24）。

有些用户不想让密钥以任何形态落盘（哪怕 DPAPI 加密后也不愿意）。这里提供一个
**纯内存**的密钥通道：密钥只存在于本进程里，进程重启即失，永不进入 SQLite、
日志或备份——`settings_service.get_llm_config` 在会话密钥存在时用它覆盖
`api_key`，而保存链路（`_strip_session_key`）保证它绝不被 `encrypt_key` 写回库。

存储就是一个模块级变量：本项目是单用户本机应用，不需要按请求隔离，也不需要
并发复杂度；加一把锁只为 set/clear 与读之间的可见性整洁。
"""
from __future__ import annotations

import threading

_lock = threading.Lock()
_session_key = ""


def set_session_key(key: str) -> None:
    """记录仅本会话使用的密钥。空串视为清除。"""
    global _session_key
    with _lock:
        _session_key = key


def get_session_key() -> str:
    with _lock:
        return _session_key


def session_key_configured() -> bool:
    with _lock:
        return bool(_session_key)


def clear_session_key() -> None:
    global _session_key
    with _lock:
        _session_key = ""
