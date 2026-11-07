# SPDX-License-Identifier: Apache-2.0
"""备选岗位（candidate_jobs）域的 action 契约（T28 收尾批）。

迁移对（工具 ↔ 路由，真实成对存在）：

- list_candidate_jobs   ↔ GET  /api/candidate-jobs（只读；路由分页/批次筛选是路由形状，
  工具侧用 limit 截断，旧工具默认 20）
- get_candidate_job     ↔ GET  /api/candidate-jobs/{candidate_id}（只读）
- create_candidate_job  ↔ POST /api/candidate-jobs（可逆写；路由保留截图副本落盘副作用）
- update_candidate_job  ↔ PUT  /api/candidate-jobs/{candidate_id}（可逆写；同上）
- import_candidate_job  ↔ POST /api/candidate-jobs/{candidate_id}/imported（可逆写）

**两侧既有语义不同的一对是 import_candidate_job**：路由只做"标记已导入"（body 需给
job_id），工具则会自己建正式岗位并回填（job_id 是路由专属字段，通过 tool_fields 从
工具 schema 中排除）。因此工具侧走 ``run_tool`` 委托旧 handler，路由侧走 ``run``。

行为保持：路由 path/method/response_model/status_code、工具 name/description/permission/
preview/service_entry 不变；run/run_tool 都委托既有 service 或旧 handler，不重写业务逻辑。
错误统一走契约层映射（旧路由 404/422 的 detail 形状改为 {code,message}，状态码不变）。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.material import (
    CandidateJobCreate,
    CandidateJobDetailOut,
    CandidateJobOut,
    CandidateJobUpdate,
)
from ...candidate_jobs import MAX_CANDIDATE_LIST
from ..legacy import preview_runner, tool_runner
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

# 与 assistant_tools/_shared.py 的 DEFAULT_LIST_LIMIT 一致；tests 钉住两边相等。
_DEFAULT_TOOL_LIMIT = 20
# 旧工具 handler 所在模块：run_tool 直接委托它们，行为零漂移。
_TOOL_HANDLERS = "app.services.assistant_tools.data_tools.candidate_jobs"


# list_candidate_jobs 两侧共用入参：路由是 query，工具是 JSON 参数。
# （模型不放 docstring：Pydantic 会把 docstring 渲染成工具 schema 的顶层 description，
#   每轮固定 prompt 都要为它付 token，而字段自己的 description 已足够。）
class ListCandidateJobsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["pending", "imported", ""] = Field(
        default="", description="可选：pending 待处理，imported 已导入"
    )
    keyword: str = Field(default="", description="可选，岗位/公司/原文里的关键词")
    collect_task_id: int | None = Field(
        default=None, ge=1, description="可选，按采集批次筛选（路由参数）"
    )
    collect_task_ids: str = Field(default="", description="可选，逗号分隔的采集批次 id（路由参数）")
    limit: int = Field(
        default=MAX_CANDIDATE_LIST,
        ge=1,
        le=MAX_CANDIDATE_LIST,
        description="可选，最多返回多少条，默认 20",
    )


# get_candidate_job 两侧共用入参：candidate_id 来自路由路径 / 工具参数。
class GetCandidateJobInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: int = Field(ge=1, description="备选岗位 id")


# create_candidate_job 两侧共用入参（继承 CandidateJobCreate，校验器只有一份）。
class CreateCandidateJobInput(CandidateJobCreate):
    model_config = ConfigDict(extra="forbid")


# update_candidate_job 两侧共用入参：candidate_id 路由来自路径、工具来自 JSON。
class UpdateCandidateJobInput(CandidateJobUpdate):
    model_config = ConfigDict(extra="forbid")

    candidate_id: int = Field(ge=1, description="备选岗位 id")


# import_candidate_job 两侧共用入参：job_id 是路由专属（标记已导入哪个正式岗位）；
# title/company 是工具专属（工具会自己建正式岗位，可覆盖名称/公司）。两边各用一部分。
class ImportCandidateJobInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: int = Field(ge=1, description="备选岗位 id")
    job_id: int | None = Field(
        default=None, ge=1, description="要标记为已导入的正式岗位 id（路由侧必填）"
    )
    title: str | None = Field(default=None, description="可选，覆盖导入后的岗位名称")
    company: str | None = Field(default=None, description="可选，覆盖公司名称")


def _parse_collect_task_ids(raw: str) -> list[int]:
    """与旧路由 ``_parse_collect_task_ids`` 同口径：去重保序的正整数列表，非法 422。

    错误按契约层映射成 ``invalid_input``（旧路由是 HTTPException(422)，状态码不变）。
    """
    if not raw.strip():
        return []
    try:
        parsed = [int(value) for value in raw.split(",") if value.strip()]
    except ValueError:
        raise ActionError("invalid_input", "采集批次编号无效") from None
    if any(value < 1 for value in parsed):
        raise ActionError("invalid_input", "采集批次编号无效")
    return list(dict.fromkeys(parsed))


def _run_list_candidate_jobs(db: Session, payload: ListCandidateJobsInput) -> ActionOutcome:
    from ...candidate_jobs import candidate_brief, list_candidate_jobs

    rows = list_candidate_jobs(
        db,
        status=payload.status,
        keyword=payload.keyword,
        collect_task_id=payload.collect_task_id,
        collect_task_ids=_parse_collect_task_ids(payload.collect_task_ids),
        limit=payload.limit,
    )
    return ActionOutcome(
        summary=f"查看了 {len(rows)} 条备选岗位",
        text=json.dumps(
            {"返回": len(rows), "备选岗位": [candidate_brief(row) for row in rows]},
            ensure_ascii=False,
        ),
        link="/jobs",
        data=[CandidateJobOut.model_validate(row) for row in rows],
    )


def _run_get_candidate_job(db: Session, payload: GetCandidateJobInput) -> ActionOutcome:
    from ...candidate_jobs import candidate_detail_text, candidate_or_none

    candidate = candidate_or_none(db, payload.candidate_id)
    if candidate is None:
        raise ActionError("not_found", "备选岗位不存在或已被删除")
    return ActionOutcome(
        summary=f"读取了备选岗位「{candidate.title or candidate.company or candidate.id}」",
        text=candidate_detail_text(candidate),
        link="/jobs",
        data=CandidateJobDetailOut.model_validate(candidate),
    )


def _run_create_candidate_job(db: Session, payload: CreateCandidateJobInput) -> ActionOutcome:
    from ....api.candidate_jobs import _save_image_copies
    from ...candidate_jobs import create_candidate_job

    candidate = create_candidate_job(db, payload)
    # 路由既有副作用：截图的 data URL 落一份磁盘副本（工具侧此前的声明没有 images，
    # tool_fields 已把它排除，因此工具调用这里永远是空列表 = no-op）。
    _save_image_copies(db, candidate.id, payload.images)
    return ActionOutcome(changed=True, data=CandidateJobOut.model_validate(candidate))


def _run_update_candidate_job(db: Session, payload: UpdateCandidateJobInput) -> ActionOutcome:
    from ....api.candidate_jobs import _save_image_copies
    from ...candidate_jobs import candidate_or_none, update_candidate_job

    candidate = candidate_or_none(db, payload.candidate_id)
    if candidate is None:
        raise ActionError("not_found", "备选岗位不存在或已被删除")
    fields = payload.model_dump(exclude={"candidate_id"}, exclude_unset=True)
    update_payload = CandidateJobUpdate.model_validate(fields)
    updated = update_candidate_job(db, candidate, update_payload)
    if "images" in update_payload.model_fields_set:
        _save_image_copies(db, updated.id, update_payload.images)
    return ActionOutcome(changed=True, data=CandidateJobOut.model_validate(updated))


def _run_import_candidate_job(db: Session, payload: ImportCandidateJobInput) -> ActionOutcome:
    from ...candidate_jobs import candidate_or_none, mark_candidate_imported

    # 路由侧不接受工具专属字段（旧路由 body 是 extra=forbid 的 CandidateJobImportRequest）：
    # 显式传 title/company 在旧路由是 422，这里映射成同码的 invalid_input。
    tool_only = {"title", "company"} & set(payload.model_fields_set)
    if tool_only:
        raise ActionError("invalid_input", f"路由不接受这些只有工具才有的字段：{sorted(tool_only)}")
    if payload.job_id is None:
        raise ActionError("invalid_input", "缺少 job_id：要把这条候选标记成已导入哪个正式岗位")
    candidate = candidate_or_none(db, payload.candidate_id)
    if candidate is None:
        raise ActionError("not_found", "备选岗位不存在或已被删除")
    updated = mark_candidate_imported(db, candidate, payload.job_id)
    return ActionOutcome(changed=True, data=CandidateJobOut.model_validate(updated))


_ACTIONS: dict[str, ActionSpec] | None = None


def candidate_job_actions() -> dict[str, ActionSpec]:
    """构建（并注册）备选岗位域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    list_candidate_jobs = define_action(
        ActionSpec(
            name="list_candidate_jobs",
            description="列出备选岗位（还没导入正式岗位的招聘信息），可按状态或关键词筛选。",
            input_model=ListCandidateJobsInput,
            permission=Permission.READ_ONLY,
            run=_run_list_candidate_jobs,
            run_tool=tool_runner(_TOOL_HANDLERS, "_tool_list_candidate_jobs"),
            service_entry="candidate_jobs.candidate_brief",
            tool_fields=("status", "keyword", "limit"),
            tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
            # 旧 GET 路由的未知 query 参数一律忽略（FastAPI 默认行为）。
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET", "/api/candidate-jobs", list[CandidateJobOut], tags=("candidate-jobs",)
            ),
        )
    )
    get_candidate_job = define_action(
        ActionSpec(
            name="get_candidate_job",
            description="按 id 读取一条备选岗位的完整招聘原文。",
            input_model=GetCandidateJobInput,
            permission=Permission.READ_ONLY,
            run=_run_get_candidate_job,
            run_tool=tool_runner(_TOOL_HANDLERS, "_tool_get_candidate_job"),
            service_entry="candidate_jobs.candidate_detail_text",
            tool_fields=("candidate_id",),
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET",
                "/api/candidate-jobs/{candidate_id}",
                CandidateJobDetailOut,
                tags=("candidate-jobs",),
            ),
        )
    )
    create_candidate_job = define_action(
        ActionSpec(
            name="create_candidate_job",
            description=(
                "把还没核对的招聘信息放进备选岗位。用户说「先记下来」「放到备选」时使用；"
                "已在正式岗位里的招聘信息不要再放这里。"
            ),
            input_model=CreateCandidateJobInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_candidate_job,
            run_tool=tool_runner(_TOOL_HANDLERS, "_tool_create_candidate_job"),
            preview=preview_runner(
                "app.services.assistant_tools.previews", "preview_create_candidate_job"
            ),
            service_entry=None,
            service_reason="内联 ORM 写入，无 services 收口（T27 收口候选）",
            tool_fields=("title", "company", "raw_text", "note"),
            http=HttpRoute(
                "POST",
                "/api/candidate-jobs",
                CandidateJobOut,
                status_code=201,
                tags=("candidate-jobs",),
            ),
        )
    )
    update_candidate_job = define_action(
        ActionSpec(
            name="update_candidate_job",
            description="修改一条备选岗位的内容（只传要改的字段）。",
            input_model=UpdateCandidateJobInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_update_candidate_job,
            run_tool=tool_runner(_TOOL_HANDLERS, "_tool_update_candidate_job"),
            preview=preview_runner(
                "app.services.assistant_tools.previews", "preview_update_candidate_job"
            ),
            service_entry=None,
            service_reason="内联 ORM 写入，无 services 收口（T27 收口候选）",
            tool_fields=("candidate_id", "title", "company", "raw_text", "note"),
            http=HttpRoute(
                "PUT",
                "/api/candidate-jobs/{candidate_id}",
                CandidateJobOut,
                tags=("candidate-jobs",),
            ),
        )
    )
    import_candidate_job = define_action(
        ActionSpec(
            name="import_candidate_job",
            description=(
                "把备选岗位导入成岗位广场里的正式岗位。用户明确要求导入时调用；"
                "重复调用不会创建第二份，会返回已导入的岗位 id。"
            ),
            input_model=ImportCandidateJobInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_import_candidate_job,
            run_tool=tool_runner(_TOOL_HANDLERS, "_tool_import_candidate_job"),
            preview=preview_runner(
                "app.services.assistant_tools.previews", "preview_import_candidate_job"
            ),
            service_entry="candidate_jobs.mark_candidate_imported",
            tool_fields=("candidate_id", "title", "company"),
            http=HttpRoute(
                "POST",
                "/api/candidate-jobs/{candidate_id}/imported",
                CandidateJobOut,
                tags=("candidate-jobs",),
            ),
        )
    )
    _ACTIONS = {
        spec.name: spec
        for spec in (
            list_candidate_jobs,
            get_candidate_job,
            create_candidate_job,
            update_candidate_job,
            import_candidate_job,
        )
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return candidate_job_actions()


__all__ = [
    "CreateCandidateJobInput",
    "GetCandidateJobInput",
    "ImportCandidateJobInput",
    "ListCandidateJobsInput",
    "UpdateCandidateJobInput",
    "actions",
    "candidate_job_actions",
]
