# SPDX-License-Identifier: Apache-2.0
"""resumes_write 域的 action 契约（T28 收尾批）：update_resume_layout。

迁移对：update_resume_layout ↔ PATCH /api/resumes/{resume_id}/layout（可逆写，带 preview）。
- run 直接调 ``services/resume/layout_update.apply_layout_update``（路由 handler 是同一函数
  的薄壳），保持"真·局部 PATCH"（按 model_fields_set 判据）、版本条件写与响应体；
- run_tool 委托既有工具 handler（assistant_tools.report_tools._tool_update_resume_layout），
  保持工具侧"只改三个版式字段、没有可改字段就报错"的既有语义；
- preview 委托既有 previews.preview_update_resume_layout。

**RF-03b**：run 从"委托路由 handler"改成"直接调服务层"——handler 里除了"调服务 + 包装
错误"没有别的活，委托只会让同一段版式编排同时长在 api 层。冲突响应沿用迁移前的形状：
``RevisionConflict`` 时返回 ``revision_conflict_response(...)``（409 + 顶层业务码），
与路由逐字节一致。

**未迁移（跳过）**：update_resume（工具只改 favorite/note，对应路由是两个不同端点
/api/resumes/{id}/favorite 与 /api/resumes/{id}/note；而 PATCH /api/resumes/{resume_id}
实际是改名且 title 必填——无法用同一 input_model / 单个 http 安全表达，按规则跳过）。

路由专属字段（format_name/document_mode/language/format_config/expected_revision）不进
tool_fields：模型侧看不到、也传不进这些字段（写工具尤其重要）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException
from pydantic import ConfigDict, Field

from ....schemas.resume import ResumeFontScale, ResumeLayoutUpdate, ResumeOut
from ...resume.document_save import RevisionConflict, revision_conflict_response
from ...resume.layout_update import apply_layout_update
from ...resume.resume_read_service import ResumeNotFound
from ..legacy import preview_runner, tool_runner
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


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


def _run_update_resume_layout(db: Session, payload: UpdateResumeLayoutInput) -> ActionOutcome:
    """版式保存：与 ``PATCH /{resume_id}/layout`` 同一个服务函数。

    两种边界与迁移前逐条一致：

    - 条件写没命中 → 返回 ``revision_conflict_response(...)``（409 + 顶层业务码），
      不抛异常：前置校验（``preview``）已经把"要不要跟用户确认"挡在写入之前，
      真跑到这里说明是另一个窗口抢先写了，界面要拿这个响应体去弹比较面板；
    - 简历不存在/已进回收站 → ``HTTPException(404)``，与旧 handler 同一句话。
    """
    try:
        return ActionOutcome(
            data=apply_layout_update(db, resume_id=payload.resume_id, payload=payload)
        )
    except RevisionConflict as exc:
        return ActionOutcome(data=revision_conflict_response(exc.current_revision))
    except ResumeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def resumes_write_actions() -> dict[str, ActionSpec]:
    global _ACTIONS
    if _ACTIONS is not None:
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # permission_enum 可能触发工具声明模块重入本构建器（首次 import 顺序）
        return _ACTIONS
    update_resume_layout = ActionSpec(
        name="update_resume_layout",
        description=(
            "调整某份简历的版式：模板（classic 经典 / modern 现代 / compact 精简）、"
            "最大页数（1-3）与字号（small 小 / standard 标准 / large 大）。"
            "用户抱怨「内容太多排不下」「字太小」或要求换模板时用它。"
        ),
        input_model=UpdateResumeLayoutInput,
        permission=Permission.REVERSIBLE_WRITE,
        run=_run_update_resume_layout,
        run_tool=tool_runner(
            "app.services.assistant_tools.report_tools", "_tool_update_resume_layout"
        ),
        preview=preview_runner(
            "app.services.assistant_tools.previews", "preview_update_resume_layout"
        ),
        # RF-03b：指向 run 的第一跳（版式保存的唯一编排）。原值是
        # ``resume.resume_templates.template_spec``——那只是链路上更深的辅助函数，
        # 元数据该指入口而不是内部实现。
        service_entry="resume.layout_update.apply_layout_update",
        tool_fields=("resume_id", "template", "page_limit", "font_scale"),
        http=HttpRoute(
            "PATCH",
            "/api/resumes/{resume_id}/layout",
            ResumeOut,
            tags=("resumes",),
        ),
    )
    _ACTIONS = {update_resume_layout.name: update_resume_layout}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return resumes_write_actions()


__all__ = ["UpdateResumeLayoutInput", "actions", "resumes_write_actions"]
