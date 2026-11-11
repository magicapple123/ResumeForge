# SPDX-License-Identifier: Apache-2.0
"""收藏状态与收藏时间的唯一写入口（#28E）。

收藏现在涉及两个字段：favorite 布尔列（查询条件）与 favorited_at 时间戳（排序/展示依据）。
任何一处只改布尔列，症状都是静默的：收藏成功了但「按收藏时间」排到最后；取消收藏了却还留着
一个时间戳。所以三个写入点（岗位 PUT / 简历收藏端点 / 助手简历工具）统一走这里。

语义三条：① 收藏写当前时间并置 estimated=False；② 取消清空时间（与「从未收藏」同形）；
③ 幂等：已收藏再次提交收藏不刷新时间——重新点一次星星不该把它顶到列表最前面。
"""

from __future__ import annotations

from datetime import datetime

from ..models.profile import utcnow


def apply_favorite(target: object, favorite: bool, *, now: datetime | None = None) -> None:
    """把 favorite 与 favorited_at 一起改（Job / ResumeRecord 同一套语义）。

    target 只要求具备 favorite / favorited_at / favorited_at_estimated 三个属性；
    不返回值、不 commit——事务边界留在调用方（与 job_service 的其余更新一致）。
    """
    value = bool(favorite)
    current_value = bool(getattr(target, "favorite", False))
    current_timestamp = getattr(target, "favorited_at", None)
    if value == current_value and value == (current_timestamp is not None):
        return
    target.favorite = value  # type: ignore[attr-defined]
    if value:
        target.favorited_at = now or utcnow()  # type: ignore[attr-defined]
        target.favorited_at_estimated = False  # type: ignore[attr-defined]
    else:
        target.favorited_at = None  # type: ignore[attr-defined]
        target.favorited_at_estimated = False  # type: ignore[attr-defined]


__all__ = ["apply_favorite"]
