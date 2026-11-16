# SPDX-License-Identifier: Apache-2.0
"""旧协议「整份替换」写入的对外编排：写资料 + 顺带落照片副本。

从 ``api/profile.py`` 的 ``save_profile`` 搬出来。这一段原本只有路由在用，助手动作
``update_profile`` 也只能去调路由才能拿到同一行为；搬进服务层之后两边调同一个函数，
"要不要落磁盘副本""副本叫什么名字"这类判断不会再出现第二份。

``services/profile/profile_service.py`` 已贴着文件行数预算，所以放在单独模块，
不改那边的职责划分（它只管旧协议 -> 新模型条目的映射与写库）。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ...schemas import profile as profile_schemas
from ..user_files import save_from_data_url
from .profile_service import update_profile

logger = logging.getLogger(__name__)


def save_photo_copy(db: Session, data_url: str, source_ref: str, fallback_name: str) -> None:
    """best-effort：把照片 data URL 落一份磁盘副本（失败只记日志）。

    副本是锦上添花：磁盘写失败绝不能挡住"照片已经存进资料"这个既成事实。
    """
    try:
        save_from_data_url(
            db,
            data_url,
            source_type="photo",
            source_ref=source_ref,
            fallback_name=fallback_name,
        )
    except Exception:  # noqa: BLE001 - 副本失败不影响资料写入
        logger.warning("个人照片磁盘副本保存失败 ref=%s", source_ref, exc_info=True)


def save_profile_with_photo(db: Session, payload: profile_schemas.ProfileUpdate):
    """旧协议 ``PUT /api/profile``：整体替换资料，传了照片就顺带落一份副本。

    写库语义完全由 :func:`profile_service.update_profile` 决定；这里只负责"照片副本"
    这件附带动作，返回 ``ProfileOut``。
    """
    profile = update_profile(db, payload)
    if payload.photo:
        save_photo_copy(db, payload.photo, f"profile:{profile.id}", f"profile-{profile.id}")
    return profile


__all__ = ["save_photo_copy", "save_profile_with_photo"]
