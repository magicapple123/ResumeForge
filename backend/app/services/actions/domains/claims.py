# SPDX-License-Identifier: Apache-2.0
"""事实台账（claims）域的 action 契约（T28 Batch B）。

迁移对（工具 ↔ 路由，真实成对存在）：

- get_claim    ↔ GET  /api/claims/{claim_id}（只读）
- create_claim ↔ POST /api/claims（可逆写）
- update_claim ↔ PUT  /api/claims/{claim_id}（可逆写；路由是 PUT 整体替换语义）
- list_claims 已在 T27 试点迁到 pilots.py（这里是同一域，后续可并入本模块）。

**安全边界（必须保住）**：助手不能替用户改核实状态——一条主张能不能进正式简历只能由
用户自己确认；新建条目一律是「待确认」。旧工具 handler 用"过滤字段 + 拒绝只给状态"实现
这条边界，而旧路由的 POST/PUT 必须接受并应用 verification_status（用户在台账页上确认）。
一份契约只有一套入参校验，因此用 **隐藏的 tool_call 标记**（tool_adapter 的 tool_defaults
仅对工具调用注入）在 run 里保留工具侧语义：忽略/拒绝 status、update 做局部合并而不是整体
替换。标记用 SkipJsonSchema 隐去，不出现在工具参数与 OpenAPI 里。

**schema 差异（已记入 T28 证据）**：create 的 source_fact 在模型层仍由「原始事实或简历表述
至少一条」的既有校验保证，工具 schema 的 required 因此从 ["source_fact"] 变成 []（行为等价）；
verification_status 等路由侧字段用 SkipJsonSchema 从请求 schema 隐去（运行时仍接受并校验），
以保住迁移前工具 schema 的字段面、避免模型误以为它能改核实状态。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ....models.claim import (
    CLAIM_CATEGORY_OTHER,
    RESPONSIBILITY_PARTICIPATED,
)
from ....schemas.claim import (
    MAX_CLAIM_BOUNDARY_CHARS,
    MAX_CLAIM_RISK_NOTES,
    MAX_CLAIM_SUBJECT_CHARS,
    MAX_CLAIM_TEXT_CHARS,
    MAX_CLAIM_TITLE_CHARS,
    ClaimCreate,
    ClaimOut,
    ClaimUpdate,
)
from ..legacy import tool_runner
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

_CLAIM_CATEGORY_DESC = "分类：教育经历、实习/工作、项目经历、校园经历、专业技能、荣誉奖项、其他"
_CLAIM_RESPONSIBILITY_DESC = "本人在其中的承担程度，判断不了就用「参与」"
#: 旧工具 update_claim 允许修改的字段（核实状态刻意不在其中）。
_TOOL_MUTABLE_FIELDS = (
    "title",
    "category",
    "subject",
    "source_fact",
    "candidate_wording",
    "responsibility_level",
    "boundary",
    "risk_notes",
    "sources",
    "allowed_uses",
    "interview_details",
    "last_verified",
)
_RESPONSIBILITY_LITERAL = Literal["参与", "负责模块", "主导方案或交付", "项目负责人"]
_STATUS_MODIFIED_MESSAGE = (
    "核实状态不能由助手修改——一条主张能不能进正式简历要由用户自己判断，请让他在「事实台账」页上确认"
)


class GetClaimInput(BaseModel):
    """get_claim 两侧共用入参：claim_id 来自路由路径 / 工具参数。"""

    model_config = ConfigDict(extra="forbid")

    claim_id: int = Field(description="台账条目 id")


class CreateClaimInput(ClaimCreate):
    """create_claim 两侧共用入参（继承 ClaimCreate，校验器只有一份）。

    工具侧可见字段由 ActionSpec.tool_fields 限制为旧声明字段；路由侧仍用完整
    ClaimCreate（OpenAPI 与运行时都能收 sources/verification_status 等字段）。
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=MAX_CLAIM_TITLE_CHARS, description="便于检索的标题")
    category: str = Field(
        default=CLAIM_CATEGORY_OTHER, max_length=32, description=_CLAIM_CATEGORY_DESC
    )
    subject: str = Field(
        default="",
        max_length=MAX_CLAIM_SUBJECT_CHARS,
        description="这条主张关于谁：公司/项目/学校/技能名",
    )
    source_fact: str = Field(
        default="", max_length=MAX_CLAIM_TEXT_CHARS, description="原始事实，忠实复述，不包装"
    )
    candidate_wording: str = Field(
        default="",
        max_length=MAX_CLAIM_TEXT_CHARS,
        description="准备写进简历的版本，不得比原始事实更强",
    )
    responsibility_level: _RESPONSIBILITY_LITERAL = Field(
        default=RESPONSIBILITY_PARTICIPATED, description=_CLAIM_RESPONSIBILITY_DESC
    )
    boundary: str = Field(
        default="",
        max_length=MAX_CLAIM_BOUNDARY_CHARS,
        description="团队做了什么、本人做了什么的分界",
    )
    risk_notes: list[str] = Field(
        default_factory=list,
        max_length=MAX_CLAIM_RISK_NOTES,
        description="面试可能被追问但还站不住的地方",
    )

    # 覆盖父类的跨字段校验（同名 no-op）：工具侧要先与记录现值合并再校验（旧语义），
    # 路由侧在 run 里用 ClaimCreate/ClaimUpdate 复核同一份校验器。
    @model_validator(mode="after")
    def must_be_describable(self):
        return self

    @model_validator(mode="after")
    def confirmed_must_not_be_incomplete(self):
        return self


class UpdateClaimInput(ClaimUpdate):
    """update_claim 两侧共用入参：路由整份替换、工具只合并显式给出的字段（run_tool 分流）。"""

    model_config = ConfigDict(extra="forbid")

    claim_id: int = Field(description="台账条目 id")

    @model_validator(mode="after")
    def must_be_describable(self):
        return self

    @model_validator(mode="after")
    def confirmed_must_not_be_incomplete(self):
        return self


def _validate_business_payload(model: type[BaseModel], fields: dict[str, Any]) -> Any:
    """用业务 schema 复核同一份校验器；失败统一转 invalid_input（两侧同码）。

    契约层 input_model 为了保住工具侧的部分合并语义跳过了跨字段校验（见类文档），
    真正的业务校验在这里做——不复制规则，直接复用 ClaimCreate/ClaimUpdate。
    """
    try:
        return model.model_validate(fields)
    except ValidationError as exc:
        details = "；".join(
            f"{'.'.join(str(item) for item in error.get('loc', ())) or 'arguments'}: "
            f"{error.get('msg', '参数不合法')}"
            for error in exc.errors()
        )
        raise ActionError("invalid_input", details or "参数校验失败") from exc


def _record_fields(record) -> dict[str, Any]:
    """旧工具 update 的合并基线：先取记录现值，再叠加显式给出的字段。"""
    return {
        "title": record.title,
        "category": record.category,
        "subject": record.subject,
        "source_fact": record.source_fact,
        "candidate_wording": record.candidate_wording,
        "sources": record.sources or [],
        "responsibility_level": record.responsibility_level,
        "verification_status": record.verification_status,
        "allowed_uses": record.allowed_uses or [],
        "interview_details": record.interview_details or {},
        "boundary": record.boundary,
        "risk_notes": record.risk_notes or [],
        "last_verified": record.last_verified,
    }


def _run_get_claim(db: Session, payload: GetClaimInput) -> ActionOutcome:
    from ...claims import claim_detail_text, claim_or_none, claim_out
    from ...ui_locale import get_ui_locale

    record = claim_or_none(db, payload.claim_id)
    if record is None:
        raise ActionError("not_found", "台账条目不存在或已被删除")
    return ActionOutcome(
        summary=f"读取了台账条目「{record.title or record.subject}」",
        text=claim_detail_text(record),
        link="/claims",
        data=claim_out(record, get_ui_locale(db)),
    )


def _run_create_claim(db: Session, payload: CreateClaimInput) -> ActionOutcome:
    """路由语义：整份 ClaimCreate 校验后新建（核实状态由服务层默认「待确认」）。"""
    from ...claims import claim_out
    from ...claims import create_claim as create_claim_record
    from ...ui_locale import get_ui_locale

    record = create_claim_record(db, _validate_business_payload(ClaimCreate, payload.model_dump()))
    return ActionOutcome(
        summary=f"把「{record.title or record.subject}」记进了事实台账（待你确认）",
        text=json.dumps(
            {"id": record.id, "核实状态": record.verification_status}, ensure_ascii=False
        ),
        link="/claims",
        changed=True,
        data=claim_out(record, get_ui_locale(db)),
    )


def _run_update_claim(db: Session, payload: UpdateClaimInput) -> ActionOutcome:
    """路由语义：PUT 整份替换；工具侧走 run_tool（旧 tool handler 的合并语义）。"""
    from ...claims import claim_or_none, claim_out
    from ...claims import update_claim as update_claim_record
    from ...ui_locale import get_ui_locale

    record = claim_or_none(db, payload.claim_id)
    if record is None:
        raise ActionError("not_found", "台账条目不存在或已被删除")
    fields = payload.model_dump(exclude={"claim_id"})
    # 路由入参为了保住工具侧的"局部合并"语义把没传的字段补成了默认值；entry_ids 是新
    # 列，旧客户端不知道它。请求里没带时**不能**顺手清空既有链接（用户看不见这次清空），
    # 所以这里把它从字段集里去掉，交给服务层"未显式提供就保留"的规则。
    if "entry_ids" not in payload.model_fields_set:
        fields.pop("entry_ids", None)
    update_payload = _validate_business_payload(ClaimUpdate, fields)
    updated = update_claim_record(db, record, update_payload)
    return ActionOutcome(
        summary=f"更新了台账条目「{updated.title or updated.subject}」",
        text=json.dumps(
            {"id": updated.id, "updated": [], "核实状态": updated.verification_status},
            ensure_ascii=False,
        ),
        link="/claims",
        changed=True,
        data=claim_out(updated, get_ui_locale(db)),
    )


def _preview_create_claim(db: Session, payload: CreateClaimInput) -> WritePreview:
    from ...assistant_tools.previews import preview_create_claim

    return preview_create_claim(db, payload.model_dump(exclude_unset=True, mode="json"))


def _preview_update_claim(db: Session, payload: UpdateClaimInput) -> WritePreview:
    from ...assistant_tools.previews import preview_update_claim

    return preview_update_claim(db, payload.model_dump(exclude_unset=True, mode="json"))


_ACTIONS: dict[str, ActionSpec] | None = None


def claim_actions() -> dict[str, ActionSpec]:
    """构建（并注册）本模块负责的 claims action，返回 name -> ActionSpec（幂等、可重入）。"""
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
    get_claim = define_action(
        ActionSpec(
            name="get_claim",
            description=(
                "按 id 读取一条台账条目的完整内容：原始事实、简历表述、个人边界、证据来源、"
                "面试细节（决策/难点/验证/结果）与待改进项。准备面试追问或核对表述时用它。"
            ),
            input_model=GetClaimInput,
            permission=Permission.READ_ONLY,
            run=_run_get_claim,
            service_entry="claims.claim_detail_text",
            tool_fields=("claim_id",),
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/claims/{claim_id}", ClaimOut, tags=("claims",)),
        )
    )
    create_claim = define_action(
        ActionSpec(
            name="create_claim",
            description=(
                "把一条经历整理成台账条目记下来。只在用户明确要求记录时调用。"
                "新条目一律是「待确认」——是否确认由用户自己判断，你不能替他确认。"
                "原始事实要照实写、不加包装；信息不全时写【待补：缺什么】而不是猜测。"
            ),
            input_model=CreateClaimInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_claim,
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.claims", "_tool_create_claim"
            ),
            preview=_preview_create_claim,
            service_entry="claims.create_claim",
            tool_fields=(
                "title",
                "category",
                "subject",
                "source_fact",
                "candidate_wording",
                "responsibility_level",
                "boundary",
                "risk_notes",
            ),
            http=HttpRoute("POST", "/api/claims", ClaimOut, status_code=201, tags=("claims",)),
        )
    )
    update_claim = define_action(
        ActionSpec(
            name="update_claim",
            description=(
                "修改一条已有的台账条目（只传要改的字段）。**核实状态改不了**——"
                "已确认、待确认这类判断必须由用户自己下。"
            ),
            input_model=UpdateClaimInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_update_claim,
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.claims", "_tool_update_claim"
            ),
            preview=_preview_update_claim,
            service_entry="claims.update_claim",
            tool_fields=(
                "claim_id",
                "title",
                "subject",
                "source_fact",
                "candidate_wording",
                "responsibility_level",
                "boundary",
                "risk_notes",
            ),
            http=HttpRoute("PUT", "/api/claims/{claim_id}", ClaimOut, tags=("claims",)),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (get_claim, create_claim, update_claim)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return claim_actions()


__all__ = [
    "CreateClaimInput",
    "GetClaimInput",
    "UpdateClaimInput",
    "actions",
    "claim_actions",
]
