# SPDX-License-Identifier: Apache-2.0
"""referrals 域的 action 契约（T28 Batch B：report 类域）。

迁移对（工具 ↔ 路由，真实成对存在）：

- list_referrals ↔ GET /api/referrals（只读）

**未迁移**：create_referral 的工具声明在 assistant_tools/p3_tools.py（不在本批允许改动的
文件内），因此 POST /api/referrals 保持原 handler；待 Lead 分配 p3_tools.py 后可迁。

行为保持：路由路径/方法/响应模型不变；工具 name/description/permission/service_entry 不变；
错误走契约层统一映射（旧路由的 422 校验错误改为 detail={code,message}）。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.referral import ReferralCreate, ReferralOut
from ..registry import define_action
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

# 与 assistant_tools/_shared.py 的列表默认值一致；tests/test_actions_report_batch.py 钉住。
_DEFAULT_TOOL_LIST_LIMIT = 20


class ListReferralsInput(BaseModel):
    """list_referrals 两侧共用入参：GET /api/referrals 与工具 list_referrals。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["active", "submitted", "closed", "invalid", ""] = Field(
        default="", description="可选，内推状态"
    )
    keyword: str = Field(default="", description="可选，公司/岗位/内推人关键词")
    limit: int = Field(default=200, ge=1, le=500, description="可选，最多返回多少条，默认 20")


def _run_list_referrals(db: Session, payload: ListReferralsInput) -> ActionOutcome:
    from ...assistant_tools.report_tools import _tool_list_referrals
    from ...referral_service import list_referrals, referrals_out

    rows = list_referrals(db, status=payload.status, keyword=payload.keyword, limit=payload.limit)
    # 模型侧文案复用旧 handler（同一份服务实现；工具路径因此多一次同参查询，见证据日志）。
    legacy = _tool_list_referrals(
        db,
        {
            "status": payload.status,
            "keyword": payload.keyword,
            "limit": payload.limit,
        },
    )
    return ActionOutcome(
        summary=legacy.summary,
        text=legacy.text,
        link=legacy.link,
        data=referrals_out(db, rows),
    )


def _referral_tool_text(referral, summary: str) -> ActionOutcome:
    return ActionOutcome(
        summary=summary,
        text=json.dumps(
            {
                "id": referral.id,
                "company": referral.company,
                "position": referral.position or referral.job_title,
                "referrer_name": referral.referrer_name,
                "status": referral.status,
            },
            ensure_ascii=False,
        ),
        link="/apply",
        changed=True,
    )


def _run_create_referral(db: Session, payload: ReferralCreate) -> ActionOutcome:
    from ...referral_service import create_referral, referral_out

    referral = create_referral(db, payload)
    outcome = _referral_tool_text(
        referral, f"新增了内推记录（{referral.company or referral.referrer_name}）"
    )
    return ActionOutcome(
        summary=outcome.summary,
        text=outcome.text,
        link=outcome.link,
        changed=True,
        data=referral_out(db, referral),
    )


def _run_tool_create_referral(db: Session, payload: ReferralCreate) -> ActionOutcome:
    """工具侧保留旧 handler 的两条语义：公司/内推人至少其一 + position 回填 job_title。"""
    if not payload.company.strip() and not payload.referrer_name.strip():
        raise ValueError("至少要提供公司或内推人之一，否则这条内推没法跟别人区分")
    if not payload.job_title and payload.position:
        payload = payload.model_copy(update={"job_title": payload.position})
    return _run_create_referral(db, payload)


def _preview_create_referral(db: Session, payload: ReferralCreate) -> WritePreview:
    from ...assistant_tools.previews import preview_create_referral

    return preview_create_referral(db, payload.model_dump(exclude_unset=True, mode="json"))


_ACTIONS: dict[str, ActionSpec] | None = None


def referral_actions() -> dict[str, ActionSpec]:
    """构建（并注册）referrals 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    list_referrals = define_action(
        ActionSpec(
            name="list_referrals",
            description=(
                "列出内推记录（公司/岗位/内推人/关系/状态/是否已转化）。"
                "用户问「我有几个内推」「内推进展怎么样」时用它。"
            ),
            input_model=ListReferralsInput,
            permission=Permission.READ_ONLY,
            run=_run_list_referrals,
            service_entry="referral_service.list_referrals",
            tool_defaults=(("limit", _DEFAULT_TOOL_LIST_LIMIT),),
            http=HttpRoute("GET", "/api/referrals", list[ReferralOut], tags=("referrals",)),
        )
    )
    create_referral = define_action(
        ActionSpec(
            name="create_referral",
            description=(
                "新增一条内推记录（公司/岗位/内推人/关系/渠道/状态）。"
                "用户说「记一条内推」「XX 帮我内推了」时调用，至少要给公司或内推人之一；"
                "状态默认进行中。内推码与备注图片等完整编辑请在「投递台」页做。"
            ),
            input_model=ReferralCreate,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_referral,
            run_tool=_run_tool_create_referral,
            preview=_preview_create_referral,
            service_entry="referral_service.create_referral",
            http=HttpRoute(
                "POST", "/api/referrals", ReferralOut, status_code=201, tags=("referrals",)
            ),
        )
    )
    _ACTIONS = {
        list_referrals.name: list_referrals,
        create_referral.name: create_referral,
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return referral_actions()


__all__ = ["ListReferralsInput", "actions", "referral_actions"]
