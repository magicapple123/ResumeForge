# SPDX-License-Identifier: Apache-2.0
"""求职偏好域的 action 契约（T12）：读工具 + 两个写工具（必走提案）+ 三个 HTTP 入口。

迁移对（工具 ↔ 路由同源）：

- get_job_preferences   ↔ GET   /api/job-preferences（只读；列表与目录一次拿全）
- create_job_preference ↔ POST  /api/job-preferences（可逆写，带 preview）
- update_job_preference ↔ PATCH /api/job-preferences/{pref_id}（可逆写，带 preview）

**同一个 run 不能同时服务路由与工具**（刻意用 ActionSpec.run_tool，与 update_profile
同一范式）：路由 = 用户在本机页面上直接编辑（source=user_edited），工具 = 模型发起、
用户在确认卡上批准后执行（source=user_stated，必须能核对到那条已批准提案）。
两者共用 input_model / 校验 / 预览，写入都委托 services/job_preference_service.upsert_preference。

写工具**永远走提案**：名字登记在 policy.ALWAYS_PROPOSAL_TOOLS，即使 write_full 也不直接落库。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict

from ....schemas.job_preference import (
    CreateJobPreferenceInput,
    JobPreferenceCatalogItem,
    JobPreferenceListOut,
    JobPreferenceOut,
    UpdateJobPreferenceInput,
)
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

# 偏好页在「设置 → 助手行为」下（前端路由 /settings）。
_PREFERENCE_PAGE = "/settings"


class ListJobPreferencesInput(BaseModel):
    """get_job_preferences 两侧共用入参：没有参数。"""

    model_config = ConfigDict(extra="forbid")


def _preview_fingerprint(preview: WritePreview) -> str:
    from ...assistant_tools.proposal_store import preview_fingerprint

    return preview_fingerprint(preview)


def _resolve_source_proposal(db: Session, tool_name: str, preview: WritePreview) -> str:
    """approve 端点执行 handler 时拿不到 proposal_id：按"已批准 + 预览指纹"核对来源。"""
    from ...job_preference_service import find_executing_proposal

    return find_executing_proposal(db, tool_name, _preview_fingerprint(preview))


def _out_now(db: Session):
    """延迟导入契约层以外的服务符号（domain 模块在 assistant_tools 包初始化期间被 import）。"""
    from ... import job_preference_catalog as catalog
    from ... import job_preference_service as service

    return catalog, service


def _render_out(db: Session, record: Any) -> JobPreferenceOut:
    _catalog, service = _out_now(db)
    return JobPreferenceOut.from_record(record, has_previous=service.has_previous(db, record))


def _render_change(db: Session, result: Any) -> ActionOutcome:
    _catalog, service = _out_now(db)
    data = _render_out(db, result.record)
    text = json.dumps(
        {
            "pref_id": result.record.pref_id,
            "kind": result.record.kind,
            "label": data.label,
            "value": result.record.value,
            "state": result.record.state,
            "summary": result.summary,
        },
        ensure_ascii=False,
    )
    return ActionOutcome(
        summary=result.summary, text=text, link=_PREFERENCE_PAGE, changed=result.created, data=data
    )


def _raise_not_found() -> ActionError:
    return ActionError("not_found", "这条求职偏好不存在或已被删除")


def _normalize_for_record(db: Session, kind: str, value: Any) -> Any:
    catalog, _service = _out_now(db)
    try:
        return catalog.normalize_value(kind, value)
    except catalog.PreferenceValidationError as exc:
        raise ActionError("invalid_input", str(exc)) from exc


# ===== 读 =====


def _run_get_job_preferences(db: Session, _payload: ListJobPreferencesInput) -> ActionOutcome:
    catalog, service = _out_now(db)
    views = service.list_preferences(db)
    items = [
        JobPreferenceOut.from_record(view.record, has_previous=view.has_previous) for view in views
    ]
    data = JobPreferenceListOut(
        items=items,
        catalog=[JobPreferenceCatalogItem(**item) for item in catalog.catalog_items()],
    )
    text = json.dumps(
        {
            "items": [
                {
                    "pref_id": item.pref_id,
                    "kind": item.kind,
                    "label": item.label,
                    "value": item.value,
                    "note": item.note,
                }
                for item in items
            ],
            "catalog": [
                {"kind": entry["kind"], "value_kind": entry["value_kind"], "label": entry["label"]}
                for entry in catalog.catalog_items()
            ],
        },
        ensure_ascii=False,
    )
    return ActionOutcome(summary=f"查看了 {len(items)} 条求职偏好", text=text, data=data)


# ===== 写（路由侧 = 用户直接编辑） =====


def _run_create_job_preference(db: Session, payload: CreateJobPreferenceInput) -> ActionOutcome:
    from ....models.job_preference import PREF_SOURCE_USER_EDITED
    from ...job_preference_service import upsert_preference

    result = upsert_preference(
        db,
        payload.kind,
        payload.value,
        source=PREF_SOURCE_USER_EDITED,
        note=payload.note,
    )
    return _render_change(db, result)


def _run_update_job_preference(db: Session, payload: UpdateJobPreferenceInput) -> ActionOutcome:
    from ....models.job_preference import PREF_SOURCE_USER_EDITED
    from ...job_preference_service import active_preference_by_id, upsert_preference

    record = active_preference_by_id(db, payload.pref_id)
    if record is None:
        raise _raise_not_found()
    value = _normalize_for_record(db, record.kind, payload.value)
    result = upsert_preference(
        db,
        record.kind,
        value,
        source=PREF_SOURCE_USER_EDITED,
        note=record.note if payload.note is None else payload.note,
    )
    return _render_change(db, result)


# ===== 写（工具侧 = 用户确认过的提案；source=user_stated） =====


def _run_tool_create_job_preference(
    db: Session, payload: CreateJobPreferenceInput
) -> ActionOutcome:
    from ....models.job_preference import PREF_SOURCE_USER_STATED
    from ...job_preference_service import upsert_preference

    preview = _preview_create_job_preference(db, payload)
    proposal_id = _resolve_source_proposal(db, "create_job_preference", preview)
    result = upsert_preference(
        db,
        payload.kind,
        payload.value,
        source=PREF_SOURCE_USER_STATED,
        source_proposal_id=proposal_id,
        note=payload.note,
    )
    return _render_change(db, result)


def _run_tool_update_job_preference(
    db: Session, payload: UpdateJobPreferenceInput
) -> ActionOutcome:
    from ....models.job_preference import PREF_SOURCE_USER_STATED
    from ...job_preference_service import active_preference_by_id, upsert_preference

    preview = _preview_update_job_preference(db, payload)
    proposal_id = _resolve_source_proposal(db, "update_job_preference", preview)
    record = active_preference_by_id(db, payload.pref_id)
    if record is None:
        raise _raise_not_found()
    value = _normalize_for_record(db, record.kind, payload.value)
    result = upsert_preference(
        db,
        record.kind,
        value,
        source=PREF_SOURCE_USER_STATED,
        source_proposal_id=proposal_id,
        note=record.note if payload.note is None else payload.note,
    )
    return _render_change(db, result)


# ===== 写前预览（确认卡的内容；只读复刻写入意图，绝不提前执行写入） =====


def _preview_create_job_preference(db: Session, payload: CreateJobPreferenceInput) -> WritePreview:
    from ...assistant_tools.authorization import FieldChange, WritePreview
    from ...job_preference_service import active_pref, current_dataset_key

    catalog, _service = _out_now(db)
    spec = catalog.spec_for_kind(payload.kind)
    active = active_pref(db, current_dataset_key(), spec.kind)
    before = catalog.describe_value(spec.kind, active.value) if active is not None else None
    after = catalog.describe_value(spec.kind, payload.value)
    return WritePreview(
        target=f"求职偏好 · {spec.label}",
        scope=("更新 1 项偏好" if active is not None else "新增 1 项偏好"),
        changes=[FieldChange(field=spec.label, before=before, after=after)],
    )


def _preview_update_job_preference(db: Session, payload: UpdateJobPreferenceInput) -> WritePreview:
    from ...assistant_tools.authorization import FieldChange, WritePreview
    from ...job_preference_service import active_preference_by_id

    catalog, _service = _out_now(db)
    record = active_preference_by_id(db, payload.pref_id)
    if record is None:
        raise _raise_not_found()
    spec = catalog.spec_for_kind(record.kind)
    after = catalog.describe_value(
        record.kind, _normalize_for_record(db, record.kind, payload.value)
    )
    return WritePreview(
        target=f"求职偏好 · {spec.label}",
        scope="更新 1 项偏好",
        changes=[
            FieldChange(
                field=spec.label,
                before=catalog.describe_value(record.kind, record.value),
                after=after,
            )
        ],
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def job_preference_actions() -> dict[str, ActionSpec]:
    """构建（并注册）求职偏好域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    get_job_preferences = define_action(
        ActionSpec(
            name="get_job_preferences",
            description=(
                "查看用户的求职偏好设定（期望岗位方向、城市、薪资底线、工作方式、排除项、"
                "写作红线、到岗时间等），返回每条的 pref_id 与取值。"
                "回答「我设过哪些偏好」「你记住了我什么」或准备更新偏好前先调用它。"
                "偏好是用户设定、不是经历：只能当行为约束，不得引用为事实。"
            ),
            input_model=ListJobPreferencesInput,
            permission=Permission.READ_ONLY,
            run=_run_get_job_preferences,
            service_entry="job_preference_service.list_preferences",
            tool_fields=(),
            http=HttpRoute(
                "GET", "/api/job-preferences", JobPreferenceListOut, tags=("job-preferences",)
            ),
        )
    )
    create_job_preference = define_action(
        ActionSpec(
            name="create_job_preference",
            description=(
                "新增一条求职偏好（长期生效，需用户在确认卡上点「以后都这样」）。"
                "kind 来自闭集目录；value 按类别传数组或对象（薪资可写「月薪 15k」）。"
                "用户说「这次 / 暂时 / 先 / 本次」这类临时意愿时也调用本工具：kind 用 session_note，"
                "此时 value 必须是**一段纯文本**（例：「这次不想去上海，暂时不投上海的岗位」），"
                "不要传数组或对象；长期还是仅本会话由用户在确认卡上最终点选，不要追问。"
                "偏好不是经历：绝不能把用户没说过的事实当成偏好或反过来。"
            ),
            input_model=CreateJobPreferenceInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_job_preference,
            run_tool=_run_tool_create_job_preference,
            preview=_preview_create_job_preference,
            service_entry="job_preference_service.upsert_preference",
            http=HttpRoute(
                "POST",
                "/api/job-preferences",
                JobPreferenceOut,
                status_code=201,
                tags=("job-preferences",),
            ),
        )
    )
    update_job_preference = define_action(
        ActionSpec(
            name="update_job_preference",
            description=(
                "修改一条已存在的求职偏好（长期生效，需用户确认）。先用 get_job_preferences "
                "拿到 pref_id；类别沿用该条偏好，不能在更新时改类别。"
                "用户说「之前记的城市改成北京」时用它。"
            ),
            input_model=UpdateJobPreferenceInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_update_job_preference,
            run_tool=_run_tool_update_job_preference,
            preview=_preview_update_job_preference,
            service_entry="job_preference_service.upsert_preference",
            http=HttpRoute(
                "PATCH",
                "/api/job-preferences/{pref_id}",
                JobPreferenceOut,
                tags=("job-preferences",),
            ),
        )
    )
    _ACTIONS = {
        spec.name: spec
        for spec in (get_job_preferences, create_job_preference, update_job_preference)
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return job_preference_actions()


__all__ = [
    "CreateJobPreferenceInput",
    "ListJobPreferencesInput",
    "UpdateJobPreferenceInput",
    "actions",
    "job_preference_actions",
]
