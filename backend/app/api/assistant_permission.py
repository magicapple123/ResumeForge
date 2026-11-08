# SPDX-License-Identifier: Apache-2.0
"""求职助手「数据权限」四档设置端点（T11）。

为什么单独一个模块：四档 = 一档同时决定读、写两轴（仅查看 / 放宽读取 / 可修改 / 完全权限），
设置页保存的是**全局默认**；输入框旁的下拉按会话覆盖，覆盖只存前端本机 localStorage，
所以后端只需要这一个"全局默认"的读写端点。助手主路由 assistant.py 已贴 500 行预算，
放进 settings.py 又会与协议线改同一个文件——单独成模块（前缀同 /api/assistant，
路径 /permission 与既有 /conversations/*、/write-proposals 不重叠）。
"""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.assistant import AssistantPermissionLevel, AssistantPermissionSetting
from ..services.settings_service import get_assistant_permission, save_assistant_permission

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.get("/permission", response_model=AssistantPermissionSetting)
def read_assistant_permission(db: Session = Depends(get_db)):
    """全局默认数据权限档位（默认「仅查看」；老库从旧开关换算）。"""
    return AssistantPermissionSetting(
        # 服务层取到的是库内字符串；合法域由保存入口（Pydantic schema）保证，
        # 读路径这里收窄成 Literal 让类型与运行时契约一致（行为不变）。
        permission=cast(AssistantPermissionLevel, get_assistant_permission(db))
    )


@router.put("/permission", response_model=AssistantPermissionSetting)
def write_assistant_permission(payload: AssistantPermissionSetting, db: Session = Depends(get_db)):
    """保存全局默认档位；写新键时同步写旧键 assistant_relaxed_mode 的读轴。"""
    return AssistantPermissionSetting(
        permission=cast(AssistantPermissionLevel, save_assistant_permission(db, payload.permission))
    )
