# SPDX-License-Identifier: Apache-2.0
"""桌面版「托盘图标跟随系统主题」开关的读写端点（WF-20 兜底开关）。

按 ``settings_inline_format_preview.py`` 的拆法独立成模块：``api/settings.py`` 已贴
500 行硬预算，新增开关一律走子路由（前缀由父路由提供，这里不带 prefix）。

语义：默认 **关** —— 托盘跟应用内主题。打开后托盘忽略应用内主题、只跟
``nativeTheme.shouldUseDarkColors``；主进程侧见 ``desktop/main.js`` 的 trayIsDark。
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.setting import TrayIconFollowSystemSetting
from ..services.settings_tray_icon import (
    get_tray_icon_follow_system,
    save_tray_icon_follow_system,
)

router = APIRouter(tags=["settings"])


@router.get("/tray-icon-follow-system", response_model=TrayIconFollowSystemSetting)
def read_tray_icon_follow_system(db: Session = Depends(get_db)):
    """桌面版：托盘图标是否跟随系统主题（默认关）。"""
    return TrayIconFollowSystemSetting(enabled=get_tray_icon_follow_system(db))


@router.put("/tray-icon-follow-system", response_model=TrayIconFollowSystemSetting)
def write_tray_icon_follow_system(
    payload: TrayIconFollowSystemSetting, db: Session = Depends(get_db)
):
    return TrayIconFollowSystemSetting(enabled=save_tray_icon_follow_system(db, payload.enabled))
