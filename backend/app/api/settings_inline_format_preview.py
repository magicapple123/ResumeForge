# SPDX-License-Identifier: Apache-2.0
"""制作台「行内格式预览」开关的读写端点（从 `api/settings.py` 拆出）。

拆出来的原因是行数预算：`settings.py` 加完这条功能已经 **502 行**，贴线意味着"下次改动
必须先拆"。这里只搬走两条端点 + 它们独占的 schema 依赖，既有路径、方法、响应模型一字未改
（`/api/settings/inline-format-preview`），所以前端与测试不需要任何调整。

**为什么用子路由而不是继续往 settings.py 里塞**：`settings.py` 是按"设置项分区"长的巨文件，
每加一个开关就多 12–15 行；按开关拆出独立模块后，新开关的代价不再压在父文件上。
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.setting import InlineFormatPreviewSetting
from ..services.settings_service import (
    get_editor_inline_format_preview,
    save_editor_inline_format_preview,
)

# 前缀由父路由（`api/settings.py` 的 `/api/settings`）提供；这里再写一遍会变成
# `/api/settings/api/settings/...`（404），所以本模块的 router 不带 prefix。
router = APIRouter(tags=["settings"])


@router.get("/inline-format-preview", response_model=InlineFormatPreviewSetting)
def read_inline_format_preview(db: Session = Depends(get_db)):
    """制作台：未编辑时按真实行内样式预览（默认关）。"""
    return InlineFormatPreviewSetting(enabled=get_editor_inline_format_preview(db))


@router.put("/inline-format-preview", response_model=InlineFormatPreviewSetting)
def write_inline_format_preview(payload: InlineFormatPreviewSetting, db: Session = Depends(get_db)):
    return InlineFormatPreviewSetting(
        enabled=save_editor_inline_format_preview(db, payload.enabled)
    )
