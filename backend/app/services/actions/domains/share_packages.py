# SPDX-License-Identifier: Apache-2.0
"""share_packages 域的 action 契约（T28 收尾批）：list_share_packages。

只读：GET /api/share-packages ↔ 工具 list_share_packages。
路由 limit 默认 200，工具默认 20；tool_defaults 保住工具历史默认值。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.share_package import SharePackageBrief
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401

_DEFAULT_TOOL_LIMIT = 20


class ListSharePackagesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(default="", description="可选，标题关键词")
    limit: int = Field(default=200, ge=1, le=500, description="可选，默认 20")


_ACTIONS: dict[str, ActionSpec] | None = None


def share_package_actions() -> dict[str, ActionSpec]:
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # permission_enum 可能触发工具声明模块重入本构建器（首次 import 顺序）
        return _ACTIONS
    list_share_packages = define_action(
        ActionSpec(
            name="list_share_packages",
            description=(
                "列出已生成的离线分享包（脱敏后的简历快照，含标题/权限/文件数/生成时间）。"
                "用户问「我发过哪些分享包」时用它。"
            ),
            input_model=ListSharePackagesInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.share_packages", "read_share_packages"),
            run_tool=tool_runner(
                "app.services.assistant_tools.report_tools", "_tool_list_share_packages"
            ),
            service_entry="share_package.list_share_packages",
            tool_fields=("keyword", "limit"),
            tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET", "/api/share-packages", list[SharePackageBrief], tags=("share-packages",)
            ),
        )
    )
    _ACTIONS = {list_share_packages.name: list_share_packages}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return share_package_actions()


__all__ = ["ListSharePackagesInput", "actions", "share_package_actions"]
