# SPDX-License-Identifier: Apache-2.0
"""user_files 域的 action 契约（T28）：list_user_files。

本域是「动作直接调服务层」的最小样板：
- run 直接调用 services.user_files.list_file_copies（路由 handler 是同一函数的薄壳），
  data 即原响应体；
- run_tool 直接调用既有工具 handler（data_tools._tool_list_user_files），text/summary 不变；
- tool_fields 只把旧工具声明过的参数暴露给模型（page/page_size 是路由分页参数，不暴露）；
- tool_defaults 保住旧工具默认 limit=20。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ...user_files import list_file_copies
from ..legacy import tool_runner
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_DEFAULT_TOOL_LIMIT = 20


class ListUserFilesInput(BaseModel):
    """list_user_files 两侧共用入参：路由用分页，工具用 limit 截断。"""

    model_config = ConfigDict(extra="forbid")

    # le=100000：见 jobs.py 同名字段——上限防 offset 换算溢出 SQLite INTEGER（500→422）。
    page: int = Field(default=1, ge=1, le=100000, description="页码，从 1 开始（路由分页用）")
    page_size: int = Field(default=20, ge=1, le=200, description="每页条数（路由分页用）")
    source_type: str = Field(
        default="",
        description="可选，按来源筛选：material/photo/job_note/candidate_image/chat_attachment",
    )
    keyword: str = Field(default="", description="可选，文件名里的关键词")
    limit: int | None = Field(default=None, ge=1, description="工具侧最多返回多少条，默认 20")


def _run_list_user_files(db: Session, payload: ListUserFilesInput) -> ActionOutcome:
    """文件副本分页列表：与 ``GET /api/user-files`` 同一个服务函数。

    路由侧参数是 page/page_size（旧工具侧的 limit 只走 run_tool），与迁移前
    ``route_runner`` 调 handler 的口径一致：``limit`` 不参与路由。
    """
    return ActionOutcome(
        data=list_file_copies(
            db,
            page=payload.page,
            page_size=payload.page_size,
            source_type=payload.source_type,
            keyword=payload.keyword,
        )
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def user_file_actions() -> dict[str, ActionSpec]:
    global _ACTIONS
    if _ACTIONS is not None:
        return _ACTIONS
    Permission = permission_enum()
    list_user_files = ActionSpec(
        name="list_user_files",
        description=(
            "列出文件副本库（资料箱「文件副本」页签）里的文件副本：所有存入简历通的文件都会"
            "自动留一份副本（资料箱附件、简历照片、岗位备注图、备选岗位截图、助手消息附件），"
            "同一份内容按指纹去重。用户问「我存过哪些文件」「那张照片/截图还在吗」时用它。"
            "**只返回元数据（文件名、类型、大小、来源）**，你读不了文件内容。"
        ),
        input_model=ListUserFilesInput,
        permission=Permission.READ_ONLY,
        run=_run_list_user_files,
        run_tool=tool_runner("app.services.assistant_tools.data_tools", "_tool_list_user_files"),
        # RF-03b：run 真的调的就是这个服务函数（路由 handler 是它的薄壳），如实登记。
        service_entry="user_files.list_file_copies",
        tool_fields=("keyword", "source_type", "limit"),
        tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
        ignore_unknown_arguments=True,
        http=HttpRoute("GET", "/api/user-files", dict, tags=("user-files",)),
    )
    _ACTIONS = {list_user_files.name: list_user_files}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return user_file_actions()


__all__ = ["ListUserFilesInput", "actions", "user_file_actions"]
