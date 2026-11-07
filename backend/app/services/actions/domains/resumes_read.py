# SPDX-License-Identifier: Apache-2.0
"""resumes_read 域的 action 契约（T28 收尾批）：list_resumes / get_resume。

迁移对（**旧实现委托**范式，零业务逻辑复制）：

- list_resumes ↔ GET /api/resumes（只读；路由是分页/筛选/排序，工具只暴露 limit）
- get_resume   ↔ GET /api/resumes/{resume_id}（只读；路由详情带 content 与 profile_usage，
  工具文本由旧 handler 生成——两套输出视图各自保留）

run 委托既有路由 handler（app.api.resumes.crud_routes），data 即原响应体；run_tool 委托
既有工具 handler（assistant_tools.job_tools），text/summary 不变。路由专属参数
（page/page_size/keyword/sort/job_id/favorite/has_job/include_general）不进 tool_fields：
模型侧看不到，也传不进这些字段。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.common import Page
from ....schemas.resume import ResumeBrief, ResumeOut
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401

# 与 app.api.resumes.crud_routes.list_resumes 的 Query 取值逐字一致（路由排序键）。
ResumeSort = Literal[
    "updated_desc",
    "updated_asc",
    "created_desc",
    "created_asc",
    "title_asc",
    "title_desc",
    "company_asc",
    "company_desc",
    "job_title_asc",
    "job_title_desc",
]

#: 旧工具 list_resumes 声明过的参数（只有 limit；分页/筛选/排序都是路由专属）。
_LIST_TOOL_FIELDS = ("limit",)


class ListResumesInput(BaseModel):
    """list_resumes 两侧共用入参：路由用分页/筛选/排序，工具只暴露 limit。"""

    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(default="", description="可选，标题/岗位/公司/正文里的关键词（仅路由）")
    # le=100000：见 jobs.py 同名字段——上限防 offset 换算溢出 SQLite INTEGER（500→422）。
    page: int = Field(default=1, ge=1, le=100000, description="页码，从 1 开始（仅路由）")
    page_size: int = Field(default=20, ge=1, le=100, description="每页条数（仅路由）")
    job_id: int | None = Field(
        default=None, ge=1, description="可选，只看关联该岗位的简历（仅路由）"
    )
    favorite: bool | None = Field(default=None, description="可选，只看收藏/未收藏（仅路由）")
    has_job: bool | None = Field(
        default=None, description="可选，true=只看关联岗位的、false=只看通用简历（仅路由）"
    )
    include_general: bool = Field(
        default=False, description="可选，与 job_id 组合时同时返回通用简历（仅路由）"
    )
    sort: ResumeSort = Field(default="updated_desc", description="排序键（仅路由）")
    limit: int = Field(default=20, description="可选，默认 20")


class GetResumeInput(BaseModel):
    """get_resume 两侧共用入参：resume_id 在路由里来自路径参数。"""

    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(description="简历 id")


_ACTIONS: dict[str, ActionSpec] | None = None


def resume_read_actions() -> dict[str, ActionSpec]:
    """构建（并注册）简历只读两条 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # 内层重入已完成构建（工具声明模块在 assistant_tools 初始化期调用）
        return _ACTIONS
    list_resumes = define_action(
        ActionSpec(
            name="list_resumes",
            description="列出已生成的简历（标题、目标岗位、来源）。",
            input_model=ListResumesInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.resumes.crud_routes", "list_resumes"),
            run_tool=tool_runner("app.services.assistant_tools.job_tools", "_tool_list_resumes"),
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
            tool_fields=_LIST_TOOL_FIELDS,
            # 旧路由忽略未知 query 参数（FastAPI 默认行为）：保持同样的宽容。
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/resumes", Page[ResumeBrief], tags=("resumes",)),
        )
    )
    get_resume = define_action(
        ActionSpec(
            name="get_resume",
            description="按 id 读取某份简历的完整内容。",
            input_model=GetResumeInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.resumes.crud_routes", "get_resume"),
            run_tool=tool_runner("app.services.assistant_tools.job_tools", "_tool_get_resume"),
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
            tool_fields=("resume_id",),
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/resumes/{resume_id}", ResumeOut, tags=("resumes",)),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (list_resumes, get_resume)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return resume_read_actions()


__all__ = ["GetResumeInput", "ListResumesInput", "ResumeSort", "actions", "resume_read_actions"]
