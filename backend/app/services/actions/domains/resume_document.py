# SPDX-License-Identifier: Apache-2.0
"""简历文档域的 action 契约（T28 最后一批：8 对里安全迁移 3 对）。

迁移（真实成对存在、handler 同步、两侧入参可用同一 input_model 表达）：

- list_versions     ↔ GET  /api/resumes/{resume_id}/versions
- list_variants     ↔ GET  /api/resumes/{resume_id}/variants
- get_resume_status ↔ POST /api/resumes/{resume_id}/pagination/report

跳过（名字 + 原因，证据见 tests/test_actions_resume_document_batch.py）：

- update_resume_field ↔ POST /api/resumes/{resume_id}/writing/rewrite-field：
  该路由是 **async + Request + 模型调用**，产物是"建议、不落库"；工具是确定性写字段，
  两者既不能共用同步 run，语义也不同（迁移会让工具变成"只返回建议不写库"）。
- add_resume_entry ↔ POST /api/resumes/{resume_id}/append-profile-entries：
  后者按「资料条目 id 列表」把资料条目确定性补进分区，入参是 entry_ids/section；
  工具是按 {fields, body, layout} 现造一条新条目——无法用同一 input_model 表达。
- get_entry：没有单条读取路由（只有整份 GET /api/resumes/{resume_id}）。
- reorder_sections：没有"重排这份简历的板块"路由——/api/profile/section-order 是**资料**
  板块顺序（另一个对象），PUT /content 是整份文档替换，均不等价。
- set_entry_layout：没有条目级布局路由——PATCH /{resume_id}/layout 是**简历级**版式参数
  （模板/页数/字号/format_config），不是条目级 head/columns/align/layout。

行为保持（硬要求）：run 委托既有路由 handler（route_runner），run_tool 委托既有工具
handler（tool_runner），不改任何业务逻辑。唯一差异是**错误形状**：旧 handler 抛
HTTPException，迁移后按 T28 统一口径映射成 ActionError（路由 detail 变 {code,message}）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ....schemas.export import PreviewPdfRequest
from ....schemas.versions import VariantListOut, VersionListOut
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import (
    ActionError,
    ActionOutcome,
    ActionSpec,
    ErrorCode,
    HttpRoute,
    permission_enum,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

# 与 assistant_tools/_shared.py 的 MAX_LIST_LIMIT 一致（旧工具 limit 缺省 + 上限都是 50）。
_DEFAULT_LIST_LIMIT = 50

# 旧 handler 抛 HTTPException；迁移后按 T28 统一错误表映射成 ActionError。
# 显式标注 ErrorCode：不标时字典被推断成 dict[int, str]，ActionError 的形参拒绝 str。
_HTTP_STATUS_TO_CODE: dict[int, ErrorCode] = {
    400: "invalid_request",
    403: "permission_denied",
    404: "not_found",
    409: "conflict",
    422: "invalid_input",
    500: "internal",
    502: "unavailable",
    503: "unavailable",
}


def _contract_errors(runner):
    """把 route_runner 抛出的 HTTPException 收敛成契约层 ActionError（不改数据路径）。"""

    def run(db: Session, payload: BaseModel) -> ActionOutcome:
        try:
            return runner(db, payload)
        except HTTPException as exc:
            code = _HTTP_STATUS_TO_CODE.get(int(exc.status_code))
            if code is None:
                raise
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            raise ActionError(code, detail) from exc

    run.__doc__ = f"委托旧路由 handler 并把 HTTPException 映射为 ActionError：{runner.__doc__}"
    return run


# list_versions 两侧共用入参：路由只用 resume_id，工具另有 limit 截断。
# 说明写在注释而不是 docstring：Pydantic 会把 docstring 塞进工具 schema 的 description，
# 每轮提示词都付这份固定成本（旧声明没有这段）。
class ListVersionsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(description="简历 id")
    limit: int = Field(
        default=_DEFAULT_LIST_LIMIT,
        ge=1,
        le=_DEFAULT_LIST_LIMIT,
        description="可选，默认 50",
    )


# list_variants 两侧共用入参（结构同 list_versions）。理由同上：不用 docstring。
class ListVariantsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(description="简历 id")
    limit: int = Field(
        default=_DEFAULT_LIST_LIMIT,
        ge=1,
        le=_DEFAULT_LIST_LIMIT,
        description="可选，默认 50",
    )


# get_resume_status 两侧共用入参：
# - 路由 body 是完整的精确预览请求（可用未保存正文/版式覆盖）；
# - 工具历史上只接受 resume_id，因此 tool_fields 只暴露 resume_id——模型看不到、也
#   传不进 content 等路由专属字段；路由侧仍拿到完整 input_model（继承 PreviewPdfRequest，
#   字段与旧路由逐项一致）。
# 说明留在注释而非 docstring：Pydantic 会把 docstring 写进工具 schema.description，
# 每轮提示词都要付这份固定成本（旧声明没有）。
class GetResumeStatusInput(PreviewPdfRequest):
    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(description="简历 id（先用 list_resumes 查）")


_ACTIONS: dict[str, ActionSpec] | None = None


def resume_document_actions() -> dict[str, ActionSpec]:
    """构建（并注册）简历文档域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS

    Permission = permission_enum()
    list_versions = define_action(
        ActionSpec(
            name="list_versions",
            description=(
                "列出某份简历保存过的命名版本（名称、改动摘要、是否冻结、来自第几版、创建时间）。"
                "用户问「有哪些历史版本」「上次保存的那版叫什么」时用它。"
                "恢复版本要由用户在制作台「版本」里操作，这里只读。"
            ),
            input_model=ListVersionsInput,
            permission=Permission.READ_ONLY,
            run=_contract_errors(route_runner("app.api.resumes.versions_routes", "list_versions")),
            run_tool=tool_runner(
                "app.services.assistant_tools.document_tools", "_tool_list_versions"
            ),
            tool_fields=("resume_id", "limit"),
            # 旧 GET 路由只认识 resume_id，未知 query 被忽略（不是 422）。
            ignore_unknown_arguments=True,
            service_entry="resume.document_versions.list_versions",
            http=HttpRoute(
                "GET",
                "/api/resumes/{resume_id}/versions",
                VersionListOut,
                tags=("resumes",),
            ),
        )
    )
    list_variants = define_action(
        ActionSpec(
            name="list_variants",
            description=(
                "列出某份简历派生过的岗位变体（名称、目标岗位/公司、语言、基于哪版派生、最近同步时间）。"
                "用户问「有没有为这个岗位单独做过变体」「变体有哪些」时用它。变体的派生与同步只在"
                "制作台「版本」里操作。"
            ),
            input_model=ListVariantsInput,
            permission=Permission.READ_ONLY,
            run=_contract_errors(route_runner("app.api.resumes.versions_routes", "list_variants")),
            run_tool=tool_runner(
                "app.services.assistant_tools.document_tools", "_tool_list_variants"
            ),
            tool_fields=("resume_id", "limit"),
            ignore_unknown_arguments=True,
            service_entry="resume.document_variants.list_variants",
            http=HttpRoute(
                "GET",
                "/api/resumes/{resume_id}/variants",
                VariantListOut,
                tags=("resumes",),
            ),
        )
    )
    get_resume_status = define_action(
        ActionSpec(
            name="get_resume_status",
            description=(
                "读取一份简历的**版面状态**：按当前正文与版式真实排一遍 PDF，返回实际页数、"
                "是否需要更多页（pages_needed）、是否溢出（overflow）、页数上限、末页占用、"
                "被截断的位置（哪一段/哪一条）与手动断页，并附带内容+排版预检的告警计数。"
                "用户问「这版几页」「有没有溢出/超页」「分页里断页在哪」「版面有没有问题」时用它。"
                "返回值里的 pagination_panel 是界面上看断页的面板与按钮，回答时指过去。"
            ),
            input_model=GetResumeStatusInput,
            permission=Permission.READ_ONLY,
            run=_contract_errors(
                route_runner("app.api.resumes.layout_render_routes", "pagination_report")
            ),
            run_tool=tool_runner(
                "app.services.assistant_tools.document_tools", "_tool_get_resume_status"
            ),
            # 工具历史上只吃 resume_id：其余字段（content/watermark/variant_id…）是路由
            # 的精确预览参数，模型侧看不到也传不进；路由侧仍按旧 body 全量接收。
            tool_fields=("resume_id",),
            service_entry="resume.document_pagination.build_pagination_report",
            http=HttpRoute(
                "POST",
                "/api/resumes/{resume_id}/pagination/report",
                dict,
                tags=("resumes",),
            ),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (list_versions, list_variants, get_resume_status)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return resume_document_actions()


__all__ = [
    "GetResumeStatusInput",
    "ListVariantsInput",
    "ListVersionsInput",
    "actions",
    "resume_document_actions",
]
