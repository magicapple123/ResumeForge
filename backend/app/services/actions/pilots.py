# SPDX-License-Identifier: Apache-2.0
"""T27 三个试点动作：一份 ActionSpec 同时生成 HTTP 路由与 Agent 工具。

试点选择（2026-11-07 Lead 裁决；偏离手册原稿的理由见 deliverables T27 证据）：

- list_claims：只读；工具与 GET /api/claims 都真实存在；
- create_reminder：可逆写；工具与 POST /api/reminders 都真实存在（有 preview）；
- update_skill：不可逆写；工具与 PUT /api/assistant/skills/{skill_id} 都真实存在
  （有 preview，T17 定级 IRREVERSIBLE_WRITE）。

**import 环与惰性构建**：本模块同时被两处导入——工具声明模块（assistant_tools 包初始化
期间）与 api 模块。工具声明模块在 import 期就要把 Tool 建出来，因此必须在这里拿到
ActionSpec；而 ActionSpec 校验又需要 T17 的 ToolPermission（在 assistant_tools 包里）。
pilot_actions() 用惰性构建打破"先 import 谁"的先后依赖，详见该函数文档。

**为什么 run/preview 里大量局部导入**：顶层导入 assistant_tools 的内部 helper 或 api 视图
函数同样会形成 import 环；同一原因，工具描述里的上限数字只能写在这里（不能 import
_shared），由 tests/test_actions_pilots.py 守护与 _shared 常量一致。
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from ...models.claim import CLAIM_CATEGORIES
from ...models.reminder import REMINDER_KIND_OTHER, REMINDER_STATUS_PENDING
from ...schemas.claim import ClaimListOut
from ...schemas.job import JobOut
from ...schemas.reminder import (
    MAX_REMINDER_NOTE_CHARS,
    MAX_REMINDER_TITLE_CHARS,
    ReminderCreate,
    ReminderKind,
    ReminderOut,
    ReminderStatus,
)
from ...schemas.skill import (
    MAX_SKILL_FILES,
    AssistantSkillDetail,
    AssistantSkillFileInput,
    AssistantSkillUpdate,
)
from .registry import define_action
from .spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ..assistant_tools.authorization import WritePreview

# 与 assistant_tools/_shared.py 的两个列表上限一致。这里不能 import（见模块文档），
# tests/test_actions_pilots.py 会断言两边相等，防止漂移。
_DEFAULT_LIST_LIMIT = 20
_MAX_LIST_LIMIT = 50


# ----------------------------- 共用入参模型 -----------------------------


ClaimStatusFilter = Literal["已确认", "待确认", "已过期", "不采用", ""]


class ListClaimsInput(BaseModel):
    """list_claims 的两侧共用入参（路由侧是 query，工具侧是 JSON 参数）。"""

    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(default="", description="可选，标题/主体/事实/表述里的关键词")
    category: str = Field(
        default="",
        description=(
            "可选，分类：教育经历、实习/工作、项目经历、校园经历、专业技能、荣誉奖项、其他"
        ),
    )
    status: ClaimStatusFilter = Field(default="", description="可选，按核实状态筛选")
    limit: int = Field(
        default=_DEFAULT_LIST_LIMIT, ge=0, description="可选，最多返回多少条，默认 20"
    )


class CreateReminderInput(ReminderCreate):
    """create_reminder 的两侧共用入参。

    继承 ReminderCreate（路由原本就用它，字段约束/校验器只有一份）；覆盖字段只为保住
    工具 schema 里给模型看的说明文案——ReminderCreate 是给前端用的，没有这些描述。
    """

    title: str = Field(
        ...,
        min_length=1,
        max_length=MAX_REMINDER_TITLE_CHARS,
        description="提醒内容，必填",
    )
    remind_at: datetime = Field(..., description="提醒时间，ISO 格式，如 2026-09-20T10:00:00，必填")
    kind: ReminderKind = Field(default=REMINDER_KIND_OTHER, description="提醒类型，默认 other")
    status: ReminderStatus = Field(
        default=REMINDER_STATUS_PENDING, description="提醒状态，默认 pending"
    )
    track_id: int | None = Field(default=None, ge=1, description="可选，关联求职进度记录 id")
    job_id: int | None = Field(default=None, ge=1, description="可选，关联岗位 id")
    resume_id: int | None = Field(default=None, ge=1, description="可选，关联简历 id")
    note: str = Field(default="", max_length=MAX_REMINDER_NOTE_CHARS, description="备注，可选")


class UpdateSkillInput(AssistantSkillUpdate):
    """update_skill 的两侧共用入参：路由侧 skill_id 来自路径参数，工具侧来自 JSON 参数。"""

    model_config = ConfigDict(extra="forbid")

    skill_id: int = Field(ge=1, description="技能 id")
    files: list[AssistantSkillFileInput] | None = Field(
        default=None,
        max_length=MAX_SKILL_FILES,
        description="可选，整体替换该技能的知识文件；不传则保留原文件。",
    )


# ----------------------------- list_claims（只读） -----------------------------


def _run_list_claims(db: Session, payload: ListClaimsInput) -> ActionOutcome:
    from ..assistant_tools._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
    from ..claims import claim_brief, claim_out, list_claims, summarize
    from ..ui_locale import get_ui_locale

    if payload.category and payload.category not in CLAIM_CATEGORIES:
        raise ActionError("invalid_input", "未知的台账分类")
    records = list_claims(
        db, category=payload.category, status=payload.status, keyword=payload.keyword
    )
    # limit 只影响工具侧给模型看的条数：GET /api/claims 的响应一直是全量列表，
    # 这里不能因为共用 input_model 就把路由响应截断（行为保持不变）。
    limit = min(payload.limit or DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
    shown = records[:limit]
    locale = get_ui_locale(db)
    return ActionOutcome(
        summary=f"查看了事实台账里的 {len(shown)} 条记录",
        text=json.dumps(
            {
                "总数": len(records),
                "返回": len(shown),
                "条目": [claim_brief(record) for record in shown],
            },
            ensure_ascii=False,
        ),
        link="/claims",
        data=ClaimListOut(
            items=[claim_out(record, locale) for record in records],
            **summarize(records),
        ),
    )


# ----------------------------- create_reminder（可逆写） -----------------------------


def _preview_create_reminder(db: Session, payload: CreateReminderInput) -> WritePreview:
    from ..assistant_tools.previews import preview_create_reminder

    # 只把模型显式给出的字段交给既有预览实现：预览卡片原本就只展示"这次要改什么"。
    arguments = payload.model_dump(exclude_unset=True, mode="json")
    return preview_create_reminder(db, arguments)


def _run_create_reminder(db: Session, payload: CreateReminderInput) -> ActionOutcome:
    # 必须经 report_tools 的**模块属性**调用（而不是直接 import 函数）：T01 的既有测试
    # 用 monkeypatch 替换 report_tools.create_reminder_record 来模拟执行失败，直接引用
    # 函数会让接缝失效、失败路径静默变成成功。
    from ..assistant_tools import report_tools

    reminder = report_tools.create_reminder_record(db, payload)
    return ActionOutcome(
        summary=f"新增了提醒「{reminder.title}」",
        text=json.dumps(
            {
                "id": reminder.id,
                "title": reminder.title,
                "remind_at": reminder.remind_at.isoformat() if reminder.remind_at else None,
            },
            ensure_ascii=False,
        ),
        link="/tracker",
        changed=True,
        data=reminder,
    )


# ----------------------------- update_skill（不可逆写） -----------------------------


def _preview_update_skill(db: Session, payload: UpdateSkillInput) -> WritePreview:
    from ..assistant_tools.previews import preview_update_skill

    arguments = payload.model_dump(exclude_unset=True, mode="json")
    return preview_update_skill(db, arguments)


def _run_update_skill(db: Session, payload: UpdateSkillInput) -> ActionOutcome:
    from ...api.skills import _to_detail
    from ..assistant.assistant_skills import update_skill as update_skill_record
    from ..assistant_tools.data_tools.skills import _skill_files_from_arguments

    arguments = payload.model_dump(exclude_unset=True, mode="json")
    if not any(
        value is not None
        for value in (
            payload.name,
            payload.description,
            payload.prompt,
            payload.enabled,
            payload.files,
        )
    ):
        raise ActionError("invalid_input", "至少提供一个要修改的技能字段")
    try:
        # 复用工具侧的知识文件规范化（控制字符清洗 / 空正文 / 单文件与合计上限）：
        # 让路由与工具走同一条校验，路由此前只依赖 schema 的逐文件长度。
        files = _skill_files_from_arguments(arguments)
        skill = update_skill_record(
            db,
            payload.skill_id,
            name=payload.name,
            description=payload.description,
            prompt=payload.prompt,
            enabled=payload.enabled,
            files=files,
        )
    except ValueError as exc:
        # 迁移前这些领域规则在路由侧是 HTTPException(400)、工具侧是 ValueError；
        # 统一成 invalid_request（400）后两侧错误仍来自同一张映射表。
        raise ActionError("invalid_request", str(exc)) from exc
    if skill is None:
        raise ActionError("not_found", "技能不存在或已被删除")
    updated = [
        field
        for field in ("name", "description", "prompt", "enabled")
        if getattr(payload, field) is not None
    ]
    if files is not None:
        updated.append("files")
    return ActionOutcome(
        summary=f"更新了助手技能「{skill.name}」",
        text=json.dumps({"id": skill.id, "updated": sorted(updated)}, ensure_ascii=False),
        link="/skills",
        changed=True,
        data=_to_detail(skill),
    )


# ----------------------------- T28 首批：get_job（只读，jobs 域） -----------------------------


class GetJobInput(BaseModel):
    """get_job 的两侧共用入参：GET /api/jobs/{job_id} 与工具 get_job。"""

    model_config = ConfigDict(extra="forbid")

    job_id: int = Field(description="岗位 id")


def _run_get_job(db: Session, payload: GetJobInput) -> ActionOutcome:
    from ...api.jobs import _to_out
    from ...models.job import Job
    from .. import trash
    from ..assistant_tools.job_tools import _tool_get_job

    job = trash.get_live(db, Job, payload.job_id)
    if job is None:
        raise ActionError("not_found", f"岗位 {payload.job_id} 不存在")
    # 工具侧文案沿用既有 handler（它把 JD 正文与元信息都组装好了），路由侧用既有 _to_out：
    # 两个视图各自保持原样，契约层只负责"同一份入参 + 同一条错误映射"。
    legacy = _tool_get_job(db, {"job_id": payload.job_id})
    return ActionOutcome(
        summary=legacy.summary,
        text=legacy.text,
        link=legacy.link,
        data=_to_out(job),
    )


# ----------------------------- 惰性构建与注册 -----------------------------

_PILOT_ACTIONS: dict[str, ActionSpec] | None = None


def pilot_actions() -> dict[str, ActionSpec]:
    """构建（并注册）三个试点动作，返回 name -> ActionSpec。

    第一次调用可能发生在 assistant_tools 包初始化期间（工具声明模块 import 本模块后
    立刻构建 Tool）。若第一次调用来自 api 模块（先 import 了本模块），Permission 的
    延迟导入会触发 assistant_tools 完整初始化，其中工具声明模块会**重入**本函数：
    内层先把动作建好并放进缓存，外层拿到缓存直接返回，因此 define_action 每个名字
    只执行一次。这就是用惰性构建换掉"模块级常量"的原因（模块级常量在 import 环里
    会以半成品状态被工具声明模块读到）。
    """
    global _PILOT_ACTIONS
    if _PILOT_ACTIONS is not None:
        # 注册表可能被测试 reset_registry() 清空；缓存还在时按需自愈，避免
        # "工具已注册、action 注册表却空了"的半状态（守卫测试会踩到）。
        from .registry import get_action

        for spec in _PILOT_ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _PILOT_ACTIONS
    Permission = permission_enum()
    if _PILOT_ACTIONS is not None:  # 内层重入已完成构建
        return _PILOT_ACTIONS

    list_claims = define_action(
        ActionSpec(
            name="list_claims",
            description=(
                "列出事实台账里的条目（用户逐条核对过的、可以写进简历的事实，含核实状态与"
                "承担程度）。用户提到「台账」「那条经历有没有核对过」「哪些还没确认」时用它。"
            ),
            input_model=ListClaimsInput,
            permission=Permission.READ_ONLY,
            run=_run_list_claims,
            service_entry="claims.list_claims",
            http=HttpRoute("GET", "/api/claims", ClaimListOut, tags=("claims",)),
        )
    )
    create_reminder = define_action(
        ActionSpec(
            name="create_reminder",
            description=(
                "新增一条日历提醒（面试、测评截止、催 HR 回复等）。"
                "只在用户明确要求「帮我记个提醒」时调用；remind_at 必填，ISO 格式。"
            ),
            input_model=CreateReminderInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_reminder,
            preview=_preview_create_reminder,
            service_entry="reminder_service.create_reminder",
            http=HttpRoute(
                "POST", "/api/reminders", ReminderOut, status_code=201, tags=("reminders",)
            ),
        )
    )
    update_skill = define_action(
        ActionSpec(
            name="update_skill",
            description=(
                "修改一个技能的提示词、名称、适用场景、启用状态或知识文件（只传要改的字段）。"
                "传 files 会**整体替换**该技能现有的知识文件（不是追加）；不传 files 则不动已有文件。"
                "files 限制：最多 10 个文件、单文件 ≤ 20000 字符、合计 ≤ 60000 字符。"
            ),
            input_model=UpdateSkillInput,
            permission=Permission.IRREVERSIBLE_WRITE,
            run=_run_update_skill,
            preview=_preview_update_skill,
            service_entry="assistant.assistant_skills.update_skill",
            http=HttpRoute(
                "PUT",
                "/api/assistant/skills/{skill_id}",
                AssistantSkillDetail,
                tags=("assistant",),
            ),
        )
    )
    get_job = define_action(
        ActionSpec(
            name="get_job",
            description="按 id 读取某个岗位的完整内容（含岗位职责与任职要求）。",
            input_model=GetJobInput,
            permission=Permission.READ_ONLY,
            run=_run_get_job,
            service_entry="profile.profile_relevance.build_job_prompt_text",
            http=HttpRoute("GET", "/api/jobs/{job_id}", JobOut, tags=("jobs",)),
        )
    )
    _PILOT_ACTIONS = {
        list_claims.name: list_claims,
        create_reminder.name: create_reminder,
        update_skill.name: update_skill,
        get_job.name: get_job,
    }
    return _PILOT_ACTIONS


__all__ = [
    "CreateReminderInput",
    "GetJobInput",
    "ListClaimsInput",
    "UpdateSkillInput",
    "pilot_actions",
]
