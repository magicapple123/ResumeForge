# SPDX-License-Identifier: Apache-2.0
"""API Key 的静态加密。

Windows 上用系统 DPAPI（``CryptProtectData``），密文绑定到当前用户 + 当前机器，密钥
无需自管——这正是本地单用户工具想要的：Key 不再以明文躺在 SQLite 里，但同一用户在同一台
机器上读取时无需任何额外密码。

其他平台的评估结论（2026-10-11，RF-24）：非 Windows 仍保持明文，不引入 keyring。
理由：① headless Linux 服务器上 keyring 没有可用后端，反而会让用户在启动阶段撞上
NoKeyringError；② keyring 写入失败时的 UX（降级到哪、提示什么）与"DPAPI 失败必须
显式报错"的新语义组合起来过于复杂；③ 明文落库已有两层兜底——备份/导出会整段剥离
API Key（data_backup/api_keys.py），诊断输出有脱敏（diagnostics.py），本工具的实际
运行面是单用户本机，风险可控。

存储格式：``dpapi:v1:`` + base64(密文)。不带前缀的值一律视为历史明文，解密时原样返回，
下次保存时再加密——老库无需迁移，透明升级。

失败语义（RF-24）：Windows 上 DPAPI 加密失败**不再静默回退明文**——回退会把"加密
坏了"伪装成"保存成功"，用户以为密钥已受保护。改为抛出 :class:`ApiKeyEncryptionError`，
调用方（settings_service / api.settings）把它转成显式错误返回给前端，密钥不落盘。
解密侧维持保守语义：密文损坏或跨机器无法解密时按"未配置"处理（返回空串），让用户
重新填写，而不是让整个设置页 500。
"""
from __future__ import annotations

import base64
import ctypes
import logging
import sys

logger = logging.getLogger(__name__)

_PREFIX = "dpapi:v1:"


class ApiKeyEncryptionError(RuntimeError):
    """DPAPI 加密失败：密钥未被保护，调用方必须让保存显式失败而不是落明文。"""


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _protect(data: bytes) -> bytes:
    # windll 只在 Windows 存在；本模块的两个入口都有 sys.platform == "win32" 守卫，
    # Linux/macOS 不会走到这里——按行豁免 pyright 的跨平台属性检查（CI 在 ubuntu 上
    # 跑 pyright，ctypes 的 Linux stubs 没有 windll）。
    data_in = _DATA_BLOB(
        len(data), ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char))
    )
    data_out = _DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(  # pyright: ignore[reportAttributeAccessIssue]
        ctypes.byref(data_in), None, None, None, None, 0, ctypes.byref(data_out)
    ):
        raise OSError("CryptProtectData 失败")
    try:
        return ctypes.string_at(data_out.pbData, data_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(data_out.pbData)  # pyright: ignore[reportAttributeAccessIssue]


def _unprotect(data: bytes) -> bytes:
    data_in = _DATA_BLOB(
        len(data), ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char))
    )
    data_out = _DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(  # pyright: ignore[reportAttributeAccessIssue]
        ctypes.byref(data_in), None, None, None, None, 0, ctypes.byref(data_out)
    ):
        raise OSError("CryptUnprotectData 失败")
    try:
        return ctypes.string_at(data_out.pbData, data_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(data_out.pbData)  # pyright: ignore[reportAttributeAccessIssue]


def encrypt_key(plaintext: str) -> str:
    """加密 API Key。空串原样返回；非 Windows 平台保持明文。"""
    if not plaintext:
        return plaintext
    if sys.platform != "win32":
        return plaintext
    try:
        ciphertext = _protect(plaintext.encode("utf-8"))
    except OSError as exc:
        # 不回退明文：静默回退会把"加密失败"伪装成"保存成功"。让上层报错，
        # 密钥不落盘（调用方尚未 commit，天然不会写入半成品状态）。
        logger.warning("DPAPI 加密失败，API Key 未保存", exc_info=True)
        raise ApiKeyEncryptionError(
            "本机密钥保护服务（Windows DPAPI）加密失败，API Key 未保存。"
            "请稍后重试，或改用「仅本会话使用」的密钥。"
        ) from exc
    return _PREFIX + base64.b64encode(ciphertext).decode("ascii")


def decrypt_key(stored: str) -> str:
    """解密 API Key。空串、以及不带前缀的历史明文，一律原样返回。"""
    if not stored:
        return stored
    if not stored.startswith(_PREFIX):
        return stored
    try:
        ciphertext = base64.b64decode(stored[len(_PREFIX) :].encode("ascii"), validate=True)
    except Exception:
        logger.warning("API Key 密文损坏，无法解密")
        return ""
    if sys.platform != "win32":
        # 非 Windows 读到的 DPAPI 密文无法解（如数据库从 Windows 拷来）；按未配置处理。
        logger.warning("当前平台无法解密 DPAPI 保护的 API Key")
        return ""
    try:
        return _unprotect(ciphertext).decode("utf-8")
    except OSError:
        # Key 属于另一台机器/用户，或系统状态变化；按未配置处理，让用户重新填写。
        logger.warning("DPAPI 解密失败（Key 可能属于另一台机器或用户），按未配置处理")
        return ""
