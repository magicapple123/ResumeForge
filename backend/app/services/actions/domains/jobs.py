# SPDX-License-Identifier: Apache-2.0
"""jobs 域的 action 契约（T28 Batch A 续）。

迁移对（工具 ↔ 路由，全部真实成对存在）：

- list_jobs  ↔ GET  /api/jobs（只读；分页/筛选/排序是路由形状，工具侧用 limit 截断）
- create_job ↔ POST /api/jobs（可逆写；工具历史默认 recognition_source 用 tool_defaults 保留）
- update_job ↔ PUT  /api/jobs/{job_id}（可逆写；note_images 磁盘副本副作用原样保留）
- get_job 已在 T28 首批迁到 pilots.py（同一域，后续可并入本模块）

行为保持：路由路径/方法/响应模型/状态码、工具 name/description/permission/preview 不变；
run 惰性 import 既有 api helper 与 service，避免 import 环。已记录差异：错误 detail 变契约层
统一形状（与 T27 试点一致）；input_model extra=forbid 让路由对未知字段从静默忽略变 422；
工具 schema 增加 page/page_size/sort/order 等路由侧参数（OpenAPI diff 见 T28 证据）。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.common import Page
from ....schemas.job import JobCreate, JobListOut, JobOut, JobUpdate
from ...job.job_sorting import JobSort, JobSortOrder
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

# 与 assistant_tools/_shared.py 的列表上限一致；tests/test_actions_jobs_batch.py 钉住。
_DEFAULT_LIST_LIMIT = 20
_MAX_LIST_LIMIT = 50
#: 工具历史行为：新增岗位时把录入方式默认标注为助手（便于在来源里溯源）。
_TOOL_CREATE_RECOGNITION_SOURCE = "AI 助手录入"


class ListJobsInput(BaseModel):
    """list_jobs 两侧共用入参：路由是分页 GET，工具用 limit 截断。"""

    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(
        default="", description="可选，标题/公司/城市/描述/其他信息/备注里的关键词"
    )
    job_type: str = Field(default="", description="可选，岗位类型（校招/实习/社招/其他）")
    status: str = Field(default="", description="可选，岗位状态（如 开放中）")
    favorite: bool | None = Field(
        default=None, description="可选，只看收藏（true）或不收藏（false）"
    )
    source_kind: str = Field(
        default="", description="可选，录入方式：collected=自动采集，manual=其余"
    )
    sort: JobSort = Field(
        default="created_desc",
        description="排序键：created_desc/updated_desc/title_asc/company_asc/posted_desc",
    )
    order: JobSortOrder | None = Field(
        default=None, description="方向覆盖：asc/desc；不传则用 sort 自带方向"
    )
    # le=100000：上限防 `(page-1)*page_size` 变成超出 SQLite INTEGER 的 Python 大整数
    # （`page=10^20` 曾让 offset 换算抛 OverflowError → 500，应为 422 参数错误）。
    page: int = Field(default=1, ge=1, le=100000, description="页码，从 1 开始")
    page_size: int = Field(default=20, ge=1, le=100, description="每页条数")
    limit: int | None = Field(
        default=None, ge=1, description="工具侧最多返回多少条；不传则按路由分页参数"
    )


class CreateJobInput(JobCreate):
    """create_job 两侧共用入参（继承既有 JobCreate，校验器只有一份）。"""

    model_config = ConfigDict(extra="forbid")


class UpdateJobInput(JobUpdate):
    """update_job 两侧共用入参：路由的 job_id 来自路径，工具来自 JSON。"""

    model_config = ConfigDict(extra="forbid")

    job_id: int = Field(ge=1, description="要修改的岗位 id")


def _run_list_jobs(db: Session, payload: ListJobsInput) -> ActionOutcome:
    from ....api.jobs import _filtered_query, _to_list_out
    from ...assistant_tools._shared import _job_brief
    from ...job.job_sorting import job_order_by

    if payload.limit is not None:
        # 工具侧：历史行为是"最近更新倒序 + limit 条"；默认值由 tool_defaults 注入。
        page, page_size = 1, min(payload.limit, _MAX_LIST_LIMIT)
        sort: JobSort = "updated_desc"
        order: JobSortOrder | None = None
    else:
        page, page_size, sort, order = (
            payload.page,
            payload.page_size,
            payload.sort,
            payload.order,
        )
    query = _filtered_query(
        db,
        payload.keyword,
        payload.job_type,
        payload.status,
        payload.favorite,
        payload.source_kind,
    )
    total = query.count()
    jobs = (
        query.order_by(*job_order_by(sort, order))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    if payload.limit is not None:
        text = json.dumps(
            {"总数": total, "返回": len(jobs), "岗位": [_job_brief(job) for job in jobs]},
            ensure_ascii=False,
        )
        summary = f"查看了 {len(jobs)} 个岗位"
    else:
        text = ""
        summary = f"列出了 {len(jobs)} 个岗位（共 {total} 个）"
    return ActionOutcome(
        summary=summary,
        text=text,
        link="/jobs",
        data=Page(items=[_to_list_out(job) for job in jobs], total=total),
    )


def _preview_create_job(db: Session, payload: CreateJobInput) -> WritePreview:
    from ...assistant_tools.previews import preview_create_job

    arguments = payload.model_dump(exclude_unset=True, mode="json")
    return preview_create_job(db, arguments)


def _run_create_job(db: Session, payload: CreateJobInput) -> ActionOutcome:
    from ....api.jobs import _save_note_image_copies, _to_out
    from ...job.job_service import create_job_record

    job = create_job_record(db, payload)
    if payload.note_images:
        _save_note_image_copies(db, job.id, payload.note_images)
    return ActionOutcome(
        summary=f"新增岗位「{job.title}」",
        text=json.dumps({"id": job.id, "title": job.title}, ensure_ascii=False),
        link="/jobs",
        changed=True,
        data=_to_out(job),
    )


def _preview_update_job(db: Session, payload: UpdateJobInput) -> WritePreview:
    from ...assistant_tools.previews import preview_update_job

    # 预览需要 job_id 才能显示"目标：岗位「xxx」"；它不会把 job_id 当字段改动。
    arguments = payload.model_dump(exclude_unset=True, mode="json")
    return preview_update_job(db, arguments)


def _run_update_job(db: Session, payload: UpdateJobInput) -> ActionOutcome:
    from ....api.jobs import _save_note_image_copies, _to_out
    from ....models.job import Job
    from ... import trash
    from ...job.job_service import update_job_record

    job = trash.get_live(db, Job, payload.job_id)
    if job is None:
        raise ActionError("not_found", f"岗位 {payload.job_id} 不存在")
    fields = payload.model_dump(exclude={"job_id"}, exclude_unset=True, mode="json")
    if not fields:
        # 空 PUT 在路由侧一直是"200 且什么都不改"的 no-op；这里统一成两侧一致的
        # no-op 结果（工具侧此前会报错，属于本次有记录的行为差异）。
        return ActionOutcome(
            summary=f"未修改岗位「{job.title}」（没有给出要改的字段）",
            text=json.dumps({"id": job.id, "updated": []}, ensure_ascii=False),
            link="/jobs",
            changed=False,
            data=_to_out(job),
        )
    update_payload = JobUpdate.model_validate(fields)
    updated = update_job_record(db, job, update_payload)
    if "note_images" in update_payload.model_fields_set:
        _save_note_image_copies(db, job.id, update_payload.note_images)
    return ActionOutcome(
        summary=f"修改了岗位「{updated.title}」",
        text=json.dumps({"id": updated.id, "updated": sorted(fields)}, ensure_ascii=False),
        link="/jobs",
        changed=True,
        data=_to_out(updated),
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def job_actions() -> dict[str, ActionSpec]:
    """构建（并注册）jobs 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    list_jobs = define_action(
        ActionSpec(
            name="list_jobs",
            description="列出岗位。可按关键词（标题/公司/描述）、状态或是否收藏筛选。",
            input_model=ListJobsInput,
            permission=Permission.READ_ONLY,
            run=_run_list_jobs,
            service_entry=None,
            service_reason="内联 ORM 查询/组装，复用 api.jobs._filtered_query（T27 收口候选）",
            tool_defaults=(("limit", _DEFAULT_LIST_LIMIT),),
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/jobs", Page[JobListOut], tags=("jobs",)),
        )
    )
    create_job = define_action(
        ActionSpec(
            name="create_job",
            description="新增一个岗位。只在用户明确要求录入招聘信息时调用；至少要有 title。",
            input_model=CreateJobInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_job,
            preview=_preview_create_job,
            service_entry="job.job_service.create_job_record",
            tool_defaults=(("recognition_source", _TOOL_CREATE_RECOGNITION_SOURCE),),
            # 历史行为：POST /api/jobs 会原样接收 parse-text 草稿里的额外字段（skill_tags 等），
            # 前端"解析→确认→创建"链路依赖这一点；契约层用开关保持旧客户端行为不变。
            ignore_unknown_arguments=True,
            http=HttpRoute("POST", "/api/jobs", JobOut, status_code=201, tags=("jobs",)),
        )
    )
    update_job = define_action(
        ActionSpec(
            name="update_job",
            description="修改已有岗位的字段（只传要改的那些）。收藏/取消收藏用 favorite。",
            input_model=UpdateJobInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_update_job,
            preview=_preview_update_job,
            service_entry="job.job_service.update_job_record",
            ignore_unknown_arguments=True,
            http=HttpRoute("PUT", "/api/jobs/{job_id}", JobOut, tags=("jobs",)),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (list_jobs, create_job, update_job)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return job_actions()


__all__ = ["CreateJobInput", "ListJobsInput", "UpdateJobInput", "actions", "job_actions"]
