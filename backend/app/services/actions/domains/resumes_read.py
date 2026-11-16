# SPDX-License-Identifier: Apache-2.0
"""resumes_read 域的 action 契约（T28 收尾批）：list_resumes / get_resume。

迁移对（**动作直接调服务层**，RF-03b 收口）：

- list_resumes ↔ GET /api/resumes（只读；路由是分页/筛选/排序，工具只暴露 limit）
- get_resume   ↔ GET /api/resumes/{resume_id}（只读；路由详情带 content 与 profile_usage，
  工具文本由旧工具 handler 生成——两套输出视图各自保留）

run 直接调用 ``services/resume/resume_read_service``（路由 handler 是同一函数的薄壳），
data 即原响应体；run_tool 委托既有工具 handler（assistant_tools.job_tools），text/summary
不变。路由专属参数（page/page_size/keyword/sort/job_id/favorite/has_job/include_general）
不进 tool_fields：模型侧看不到，也传不进这些字段。

**为什么不再 route_runner**：这两条的 handler 除了"调服务 + 包一层响应"没有别的活，
委托 handler 只会让同一段编排同时长在 api 层。``get_resume`` 的 404 文案与状态码保持
不变——服务层抛 ``ResumeNotFound``，这里翻成同一句 ``HTTPException``（迁移前的形状）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ....schemas.common import Page
from ....schemas.resume import ResumeBrief, ResumeOut
from ...resume.resume_read_service import ResumeNotFound, list_resumes_page, resume_detail
from ..legacy import tool_runner
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

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


def _run_list_resumes(db: Session, payload: ListResumesInput) -> ActionOutcome:
    """简历列表分页：与 ``GET /api/resumes`` 同一个服务函数（筛选/排序/分页口径同源）。"""
    return ActionOutcome(
        data=list_resumes_page(
            db,
            keyword=payload.keyword,
            page=payload.page,
            page_size=payload.page_size,
            job_id=payload.job_id,
            favorite=payload.favorite,
            has_job=payload.has_job,
            include_general=payload.include_general,
            sort=payload.sort,
        )
    )


def _run_get_resume(db: Session, payload: GetResumeInput) -> ActionOutcome:
    """简历详情：与 ``GET /api/resumes/{resume_id}`` 同一个服务函数。

    404 的形状沿用迁移前（``HTTPException``，detail 就是那句中文）：
    ``ResumeNotFound`` 只在服务层表达"没有这一行"，状态码是接口层契约。
    """
    try:
        return ActionOutcome(data=resume_detail(db, payload.resume_id))
    except ResumeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def resume_read_actions() -> dict[str, ActionSpec]:
    """构建（不注册）简历只读两条 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # 内层重入已完成构建（工具声明模块在 assistant_tools 初始化期调用）
        return _ACTIONS
    list_resumes = ActionSpec(
        name="list_resumes",
        description="列出已生成的简历（标题、目标岗位、来源）。",
        input_model=ListResumesInput,
        permission=Permission.READ_ONLY,
        run=_run_list_resumes,
        run_tool=tool_runner("app.services.assistant_tools.job_tools", "_tool_list_resumes"),
        service_entry="resume.resume_read_service.list_resumes_page",
        tool_fields=_LIST_TOOL_FIELDS,
        # 旧路由忽略未知 query 参数（FastAPI 默认行为）：保持同样的宽容。
        ignore_unknown_arguments=True,
        http=HttpRoute("GET", "/api/resumes", Page[ResumeBrief], tags=("resumes",)),
    )
    get_resume = ActionSpec(
        name="get_resume",
        description="按 id 读取某份简历的完整内容。",
        input_model=GetResumeInput,
        permission=Permission.READ_ONLY,
        run=_run_get_resume,
        run_tool=tool_runner("app.services.assistant_tools.job_tools", "_tool_get_resume"),
        service_entry="resume.resume_read_service.resume_detail",
        tool_fields=("resume_id",),
        ignore_unknown_arguments=True,
        http=HttpRoute("GET", "/api/resumes/{resume_id}", ResumeOut, tags=("resumes",)),
    )
    _ACTIONS = {spec.name: spec for spec in (list_resumes, get_resume)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return resume_read_actions()


__all__ = ["GetResumeInput", "ListResumesInput", "ResumeSort", "actions", "resume_read_actions"]
