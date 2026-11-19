# SPDX-License-Identifier: Apache-2.0
"""桌面版「托盘图标跟随系统主题」开关的存取（WF-20 兜底开关）。

独立成模块的原因：``settings_service.py`` 已贴 500 行硬预算，新增开关按
``llm_settings`` / ``web_search_settings`` 的拆法下沉到本模块；``settings_service``
仍按原名再导出，既有调用点取符号的路径不变。

语义：默认 **关** —— 托盘跟应用内主题。打开后托盘忽略应用内主题、只跟系统的
``nativeTheme.shouldUseDarkColors``；只有"浅色任务栏 + 应用内暗色"这种对比度
组合才需要打开它，所以不能替用户默认打开。
"""

import json
import logging

from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from .settings_defaults import default_for

logger = logging.getLogger(__name__)

_TRAY_ICON_FOLLOW_SYSTEM_KEY = "tray_icon_follow_system"


def get_tray_icon_follow_system(db: Session) -> bool:
    """读取「托盘图标跟随系统主题」；缺失或脏数据退回注册表的出厂值（默认关）。

    默认关的语义是「托盘跟应用内主题」：浅色任务栏配应用内暗色是已知的对比度问题，
    这个开关就是给那种组合准备的兜底，不能替用户默认打开。
    """
    fallback = bool(default_for(_TRAY_ICON_FOLLOW_SYSTEM_KEY))
    row = db.get(AppSetting, _TRAY_ICON_FOLLOW_SYSTEM_KEY)
    if row is None:
        return fallback
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("托盘图标跟随系统主题设置数据损坏，已重置为默认值")
        return fallback
    return value if isinstance(value, bool) else fallback


def save_tray_icon_follow_system(db: Session, enabled: bool) -> bool:
    """持久化「托盘图标跟随系统主题」开关。"""
    row = db.get(AppSetting, _TRAY_ICON_FOLLOW_SYSTEM_KEY)
    serialized = json.dumps(bool(enabled))
    if row is None:
        db.add(AppSetting(key=_TRAY_ICON_FOLLOW_SYSTEM_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return bool(enabled)
