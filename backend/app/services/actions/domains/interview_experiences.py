# SPDX-License-Identifier: Apache-2.0
"""interview_experiences 域的 action 契约（T28 Batch B：report 类域）。

迁移对（工具 ↔ 路由，真实成对存在）：

- list_interview_experiences ↔ GET /api/interview-experiences（只读）

**未迁移**：create_interview_experience 的工具声明在 assistant_tools/p3_tools.py（不在本批
允许改动的文件内），POST /api/interview-experiences 保持原 handler。

说明：路由 GET 的 limit 默认 100（全量列表语义），工具历史默认 20 且封顶 50；这里用
tool_defaults 保住工具默认值，路由默认值仍由 input_model 的 100 保持。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.interview_experience import (
    InterviewExperienceCreate,
    InterviewExperienceOut,
)
from ..registry import define_action
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

_DEFAULT_TOOL_LIST_LIMIT = 20


class ListInterviewExperiencesInput(BaseModel):
    """list_interview_experiences 两侧共用入参（路由 GET 查询参数与工具 JSON 参数）。"""

    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(default="", description="可选，标题/岗位/正文里的关键词")
    company: str = Field(default="", description="可选，公司名")
    source: Literal["self", "peer", "public", ""] = Field(
        default="", description="可选：self 自己 / peer 同行 / public 公开"
    )
    limit: int = Field(default=100, ge=1, le=500, description="可选，最多返回多少条，默认 20")


def _run_list_interview_experiences(
    db: Session, payload: ListInterviewExperiencesInput
) -> ActionOutcome:
    from ...assistant_tools.report_tools import _tool_list_interview_experiences
    from ...interview.interview_experience_service import list_experiences

    rows = list_experiences(
        db,
        keyword=payload.keyword,
        company=payload.company,
        source=payload.source,
        limit=payload.limit,
    )
    legacy = _tool_list_interview_experiences(
        db,
        {
            "keyword": payload.keyword,
            "company": payload.company,
            "source": payload.source,
            "limit": payload.limit,
        },
    )
    return ActionOutcome(
        summary=legacy.summary,
        text=legacy.text,
        link=legacy.link,
        data=rows,
    )


def _run_create_interview_experience(
    db: Session, payload: InterviewExperienceCreate
) -> ActionOutcome:
    from ...interview.interview_experience_service import create_experience

    experience = create_experience(db, payload)
    summary = f"新增了面经「{experience.title or experience.company or experience.id}」"
    return ActionOutcome(
        summary=summary,
        text=json.dumps(
            {
                "id": experience.id,
                "title": experience.title,
                "company": experience.company,
            },
            ensure_ascii=False,
        ),
        link="/interview",
        changed=True,
        data=experience,
    )


def _run_tool_create_interview_experience(
    db: Session, payload: InterviewExperienceCreate
) -> ActionOutcome:
    """工具侧保留旧 handler 的语义：问题清单去掉空白项。"""
    questions = [str(item) for item in payload.questions if str(item).strip()]
    if questions != list(payload.questions):
        payload = payload.model_copy(update={"questions": questions})
    return _run_create_interview_experience(db, payload)


def _preview_create_interview_experience(
    db: Session, payload: InterviewExperienceCreate
) -> WritePreview:
    from ...assistant_tools.previews import preview_create_interview_experience

    return preview_create_interview_experience(
        db, payload.model_dump(exclude_unset=True, mode="json")
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def interview_experience_actions() -> dict[str, ActionSpec]:
    """构建（并注册）interview_experiences 域 action（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    list_experiences = define_action(
        ActionSpec(
            name="list_interview_experiences",
            description=(
                "列出真实面经（公司/岗位/来源/难度/被问问题数），可按关键词、公司或来源筛选。"
                "用户问「有没有 XX 公司的面经」「我记过哪些面经」时用它。"
            ),
            input_model=ListInterviewExperiencesInput,
            permission=Permission.READ_ONLY,
            run=_run_list_interview_experiences,
            service_entry="interview.interview_experience_service.list_experiences",
            tool_defaults=(("limit", _DEFAULT_TOOL_LIST_LIMIT),),
            http=HttpRoute(
                "GET",
                "/api/interview-experiences",
                list[InterviewExperienceOut],
                tags=("interview-experiences",),
            ),
        )
    )
    create_experience = define_action(
        ActionSpec(
            name="create_interview_experience",
            description=(
                "把一条真实面经记进面经知识库（公司/岗位/来源/被问到的真实问题/难度/轮次/日期）。"
                "用户说「记个面经」「把这次面试经历存下来」时调用；"
                "至少要有标题、公司、正文或问题清单之一，否则记不成。"
            ),
            input_model=InterviewExperienceCreate,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_interview_experience,
            run_tool=_run_tool_create_interview_experience,
            preview=_preview_create_interview_experience,
            service_entry="interview.interview_experience_service.create_experience",
            http=HttpRoute(
                "POST",
                "/api/interview-experiences",
                InterviewExperienceOut,
                status_code=201,
                tags=("interview-experiences",),
            ),
        )
    )
    _ACTIONS = {
        list_experiences.name: list_experiences,
        create_experience.name: create_experience,
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return interview_experience_actions()


__all__ = [
    "ListInterviewExperiencesInput",
    "actions",
    "interview_experience_actions",
]
