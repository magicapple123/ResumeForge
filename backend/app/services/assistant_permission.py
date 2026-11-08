# SPDX-License-Identifier: Apache-2.0
"""求职助手「数据权限」：四档映射、旧放宽开关与请求级读轴覆盖（T11）。

为什么单独成模块：四档是一档同时决定读、写两轴的口径，被助手主路由
（``api/assistant.py``）、流编排（``api/assistant_stream.py``）与设置页端点
（``api/settings.py``、``api/assistant_permission.py``）共同引用；放在
``settings_service`` 里会让那个模块无限膨胀，还会与四档写穿旧键的逻辑绕成环。

**两条一以贯之的规则**：

1. 四档 → (relaxed, allow_write) 的映射只在本模块定义一份，别处不得再抄一份；
2. 新键（``assistant_permission``）与旧键（``assistant_relaxed_mode``）双向同步写，
   保证仍在读旧键的路径（旧设置端点、旧客户端）不会与新档位分叉。

依赖方向：本模块只依赖 ``models`` 与标准库，不 import ``settings_service``——
``settings_service`` 反向从这里再导出（``get_assistant_relaxed_mode`` 等），
这样既没有循环导入，也能让既有调用点按原路径取到符号。
"""

import contextvars
import json
import logging

from sqlalchemy.orm import Session

from ..models.setting import AppSetting

logger = logging.getLogger(__name__)

# 求职助手放宽模式：开启后助手可读取完整资料（含姓名、电话等敏感字段）与
# 网申填写记录、历史对话。默认必须**关**——它扩大的是发往模型的个人信息面。
_ASSISTANT_RELAXED_MODE_KEY = "assistant_relaxed_mode"
# 四档（新键）：写入档位时同步写旧键的读轴，保证两个读点不分叉。
_ASSISTANT_PERMISSION_KEY = "assistant_permission"

# 四档：仅查看 / 放宽读取 / 可修改 / 完全权限。**一档同时决定两轴**——relaxed（读真实
# 资料）与 allow_write（直接写库）。旧键 assistant_relaxed_mode 只承载读轴，因此写新键
# 时同步写旧键，仍在读旧键的路径（旧设置端点、旧客户端）不会与四档分叉。
ASSISTANT_PERMISSION_LEVELS = ("read_only", "read_full", "write_confirm", "write_full")
ASSISTANT_PERMISSION_DEFAULT = "read_only"

# 四档 → (relaxed, allow_write)。后端侧**唯一映射口径**，不要在别处再写一份。
_PERMISSION_AXES: dict[str, tuple[bool, bool]] = {
    "read_only": (False, False),
    "read_full": (True, False),
    "write_confirm": (False, True),
    "write_full": (True, True),
}
_PERMISSION_BY_AXES = {axes: level for level, axes in _PERMISSION_AXES.items()}

# 请求级「读」轴覆盖的运行时通道（T11）：工具实现（get_profile 等）只拿得到 db、拿不到
# 请求体；流式工具循环把本轮的 relaxed 写进 ContextVar，工具内部读全局开关时按覆盖返回。
_RUNTIME_RELAXED_OVERRIDE: contextvars.ContextVar[bool | None] = contextvars.ContextVar(
    "rf_assistant_relaxed_override", default=None
)


def _write_json_setting(db: Session, key: str, value: object) -> None:
    """写一条 JSON 编码的 KV 设置（不提交；调用方决定事务边界）。"""
    serialized = json.dumps(value)
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=serialized))
    else:
        row.value = serialized


def set_runtime_relaxed_override(value: bool | None) -> contextvars.Token:
    """把本轮请求的读轴覆盖写进当前上下文；返回 token 供恢复。"""
    return _RUNTIME_RELAXED_OVERRIDE.set(value)


def reset_runtime_relaxed_override(token: contextvars.Token) -> None:
    """恢复上一个上下文的值（流式生成器的 finally 里必须调用，避免跨请求泄漏）。"""
    _RUNTIME_RELAXED_OVERRIDE.reset(token)


def get_assistant_relaxed_mode(db: Session) -> bool:
    """读取「求职助手放宽模式」开关；缺失或脏数据退回默认**关**。

    放宽模式会把助手的可读范围从"岗位筛选需要的资料"扩大到**全部资料**：姓名、
    电话等敏感身份字段、网申填表的真实填写值、历史对话。它改变的是"发往模型的
    个人信息面"，与网申放宽模式一样默认保守，由用户在知情的前提下显式开启。
    API 密钥等凭据无论如何都不在解锁范围内。当前上下文若设置了请求级覆盖（T11 四档权限），
    以覆盖值为准——工具执行没有请求体，只能靠这条运行时通道拿到本次请求的读轴。
    """
    override = _RUNTIME_RELAXED_OVERRIDE.get()
    if override is not None:
        return override
    row = db.get(AppSetting, _ASSISTANT_RELAXED_MODE_KEY)
    if row is None:
        return False
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("助手放宽模式设置数据损坏，已重置为默认关闭")
        return False
    return value if isinstance(value, bool) else False


def save_assistant_relaxed_mode(db: Session, enabled: bool) -> bool:
    """持久化旧「放宽模式」开关，并**反向同步**四档新键的读轴。

    四档写新键时会同步旧键；这里反过来同步一次，避免两个写入点写完之后互相矛盾。
    写轴保持不变——旧开关从来没有表达过写权限。
    """
    _read_axis, write_axis = permission_axes(get_assistant_permission(db))
    _write_json_setting(db, _ASSISTANT_PERMISSION_KEY, permission_from_axes(enabled, write_axis))
    _write_json_setting(db, _ASSISTANT_RELAXED_MODE_KEY, bool(enabled))
    db.commit()
    return bool(enabled)


def permission_axes(level: str) -> tuple[bool, bool]:
    """四档 → (relaxed_mode, allow_write)；未知档位属调用方 bug，直接抛。"""
    try:
        return _PERMISSION_AXES[level]
    except KeyError as exc:
        raise ValueError(f"未知的助手数据权限档位：{level}") from exc


def permission_from_axes(relaxed: bool, allow_write: bool) -> str:
    """两轴 → 四档（映射是双射；旧开关反向同步四档时用）。"""
    return _PERMISSION_BY_AXES[(bool(relaxed), bool(allow_write))]


def resolve_assistant_relaxed_mode(db: Session, override: bool | None) -> bool:
    """本次请求的「读」轴：**请求覆盖优先**，None 才读全局设置。

    发送端点与流式工具循环共用这一处实现，避免两处判定分叉——流式侧漏改会让覆盖在
    真实流式路径里被静默忽略，而单测多半走非流式端点，会全绿。
    """
    if override is not None:
        return override
    return get_assistant_relaxed_mode(db)


def get_assistant_permission(db: Session) -> str:
    """读取全局数据权限档位；缺失/脏数据退回「仅查看」。

    老库里没有新键：旧开关 assistant_relaxed_mode=True 当年等价于「放宽读取」（只开了
    读轴，写轴仍由请求级 allow_write 控制），False = 「仅查看」。
    """
    row = db.get(AppSetting, _ASSISTANT_PERMISSION_KEY)
    if row is not None:
        try:
            level = json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            logger.warning("助手数据权限设置数据损坏，已重置为默认（仅查看）")
            return ASSISTANT_PERMISSION_DEFAULT
        if isinstance(level, str) and level in _PERMISSION_AXES:
            return level
        logger.warning("助手数据权限设置数据损坏，已重置为默认（仅查看）")
        return ASSISTANT_PERMISSION_DEFAULT
    return "read_full" if get_assistant_relaxed_mode(db) else ASSISTANT_PERMISSION_DEFAULT


def save_assistant_permission(db: Session, level: str) -> str:
    """保存全局数据权限档位，并**同步写旧键**（读轴），保证旧读点不分叉。"""
    if level not in _PERMISSION_AXES:
        raise ValueError(f"未知的助手数据权限档位：{level}")
    relaxed, _allow_write = _PERMISSION_AXES[level]
    _write_json_setting(db, _ASSISTANT_PERMISSION_KEY, level)
    _write_json_setting(db, _ASSISTANT_RELAXED_MODE_KEY, bool(relaxed))
    db.commit()
    return level


__all__ = [
    "ASSISTANT_PERMISSION_DEFAULT",
    "ASSISTANT_PERMISSION_LEVELS",
    "get_assistant_permission",
    "get_assistant_relaxed_mode",
    "permission_axes",
    "permission_from_axes",
    "reset_runtime_relaxed_override",
    "resolve_assistant_relaxed_mode",
    "save_assistant_permission",
    "save_assistant_relaxed_mode",
    "set_runtime_relaxed_override",
]
