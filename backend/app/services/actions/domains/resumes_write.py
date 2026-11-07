# SPDX-License-Identifier: Apache-2.0
"""resumes_write 域的 action 契约（T28 收尾批）：update_resume_layout。

迁移对：update_resume_layout ↔ PATCH /api/resumes/{resume_id}/layout（可逆写，带 preview）。
- run 委托既有路由 handler（app.api.resumes.layout_render_routes.update_resume_layout），
  保持"真·局部 PATCH"（按 model_fields_set 判据）、版本条件写与响应体；
- run_tool 委托既有工具 handler（assistant_tools.report_tools._tool_update_resume_layout），
  保持工具侧"只改三个版式字段、没有可改字段就报错"的既有语义；
- preview 委托既有 previews.preview_update_resume_layout。

**未迁移（跳过）**：update_resume（工具只改 favorite/note，对应路由是两个不同端点
/api/resumes/{id}/favorite 与 /api/resumes/{id}/note；而 PATCH /api/resumes/{resume_id}
实际是改名且 title 必填——无法用同一 input_model / 单个 http 安全表达，按规则跳过）。

路由专属字段（format_name/document_mode/language/format_config/expected_revision）不进
tool_fields：模型侧看不到、也传不进这些字段（写工具尤其重要）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import ConfigDict, Field

from ....schemas.resume import ResumeFontScale, ResumeLayoutUpdate, ResumeOut
from ..legacy import preview_runner, route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401


class UpdateResumeLayoutInput(ResumeLayoutUpdate):
    """update_resume_layout 两侧共用入参：resume_id 在路由侧来自路径、工具侧来自 JSON。

    其余字段沿用 ResumeLayoutUpdate（extra=forbid / 局部 PATCH 判据的唯一真源）；
    覆盖 template/page_limit/font_scale 只为保住旧工具声明里的中文说明与枚举语义。
    """

    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(ge=1, description="简历 id")
    template: str = Field(
        default="classic",
        max_length=64,
        description="模板（内置：classic 经典 / modern 现代 / compact 精简；也接受用户自制模板名）",
    )
    page_limit: int = Field(default=1, ge=0, description="最大页数 1-3（0=不限）")
    font_scale: ResumeFontScale = Field(
        default="standard", description="字号：small 小 / standard 标准 / large 大"
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def resumes_write_actions() -> dict[str, ActionSpec]:
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
    update_resume_layout = define_action(
        ActionSpec(
            name="update_resume_layout",
            description=(
                "调整某份简历的版式：模板（classic 经典 / modern 现代 / compact 精简）、"
                "最大页数（1-3）与字号（small 小 / standard 标准 / large 大）。"
                "用户抱怨「内容太多排不下」「字太小」或要求换模板时用它。"
            ),
            input_model=UpdateResumeLayoutInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=route_runner("app.api.resumes.layout_render_routes", "update_resume_layout"),
            run_tool=tool_runner(
                "app.services.assistant_tools.report_tools", "_tool_update_resume_layout"
            ),
            preview=preview_runner(
                "app.services.assistant_tools.previews", "preview_update_resume_layout"
            ),
            service_entry="resume.resume_templates.template_spec",
            tool_fields=("resume_id", "template", "page_limit", "font_scale"),
            http=HttpRoute(
                "PATCH",
                "/api/resumes/{resume_id}/layout",
                ResumeOut,
                tags=("resumes",),
            ),
        )
    )
    _ACTIONS = {update_resume_layout.name: update_resume_layout}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return resumes_write_actions()


__all__ = ["UpdateResumeLayoutInput", "actions", "resumes_write_actions"]
