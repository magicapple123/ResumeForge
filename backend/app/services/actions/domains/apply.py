# SPDX-License-Identifier: Apache-2.0
"""apply 域的 action 契约（T28 收尾批）：list_apply_queue / list_apply_records。

迁移范式：run 直接调**服务层**（``apply_service.queue_overview`` /
``apply_service.record_batch_page``），路由 handler 是同一函数的薄壳；run_tool 直接委托既有
工具 handler（assistant_tools.apply_tools._tool_list_apply_*），零业务逻辑复制。

行为保持：
- list_apply_queue 旧路由没有 limit 参数，工具历史默认 limit=20 且封顶 50；
  input_model 里 limit 是工具字段（tool_defaults 保住默认 20），路由侧不使用它。
- list_apply_records 与旧路由 GET /api/apply/records/grouped 成对：分页/失败分类/
  include_items 是路由专属字段（tool_fields 不暴露给模型），keyword/result/limit 是
  旧工具字段；工具历史默认"最多 10 个批次"。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.apply import ApplyQueueListOut, ApplyRecordBatchOut
from ....schemas.common import Page
from ...apply import apply_service
from ..legacy import tool_runner
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_DEFAULT_QUEUE_LIMIT = 20
_DEFAULT_RECORD_LIMIT = 10


class ListApplyQueueInput(BaseModel):
    """list_apply_queue 入参：路由无参，工具用 limit 截断文案。"""

    model_config = ConfigDict(extra="forbid")

    limit: int | None = Field(
        default=None, ge=1, le=50, description="可选，最多返回多少条，默认 20"
    )


class ListApplyRecordsInput(BaseModel):
    """list_apply_records 入参：路由是分页 GET，工具只看 keyword/result/limit。"""

    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(default="", description="可选，岗位/公司关键词")
    result: str = Field(
        default="",
        description="可选，按每条记录的结果筛选：pending/running/success/failed/skipped",
    )
    limit: int | None = Field(
        default=None,
        ge=1,
        le=50,
        description="可选，最多返回多少个批次（组内岗位不截断），默认 10",
    )
    # 以下为路由专属（旧 GET 查询参数；工具侧不暴露）
    failure_category: str = Field(default="", description="按失败分类筛选（路由用）")
    # le=100000：见 jobs.py 同名字段——上限防 offset 换算溢出 SQLite INTEGER（500→422）。
    page: int = Field(default=1, ge=1, le=100000, description="页码，从 1 开始（路由分页用）")
    page_size: int = Field(default=10, ge=1, le=20, description="每页批次（组）数（路由分页用）")
    include_items: bool = Field(default=True, description="false 时不携带明细（路由用）")


def _run_list_apply_queue(db: Session, payload: ListApplyQueueInput) -> ActionOutcome:
    """投递队列：与 ``GET /api/apply/queue`` 同一个服务函数（截断判据只此一处）。"""
    return ActionOutcome(data=apply_service.queue_overview(db))


def _run_list_apply_records(db: Session, payload: ListApplyRecordsInput) -> ActionOutcome:
    """投递记录（按批次分组）：与 ``GET /api/apply/records/grouped`` 同一个服务函数。

    路由专属的筛选与分页字段（failure_category / page / page_size / include_items）在这里
    原样透传；工具侧的 keyword/result/limit 走 run_tool，与迁移前一致。
    """
    return ActionOutcome(
        data=apply_service.record_batch_page(
            db,
            keyword=payload.keyword,
            result=payload.result,
            failure_category=payload.failure_category,
            page=payload.page,
            page_size=payload.page_size,
            include_items=payload.include_items,
        )
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def apply_actions() -> dict[str, ActionSpec]:
    global _ACTIONS
    if _ACTIONS is not None:
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # permission_enum 可能触发工具声明模块重入本构建器（首次 import 顺序）
        return _ACTIONS
    list_apply_queue = ActionSpec(
        name="list_apply_queue",
        description=(
            "查看「投递台」的队列状态：每个待投递/已投递/失败的岗位、对应简历、"
            "是否支持自动投递以及最近一次匹配结论。用户问「队列里还有什么」"
            "「那家公司投出去了吗」时用它。"
            "**发起投递需经提案卡确认；确认后会真的提交，且不可撤销。**"
        ),
        input_model=ListApplyQueueInput,
        permission=Permission.READ_ONLY,
        run=_run_list_apply_queue,
        run_tool=tool_runner("app.services.assistant_tools.apply_tools", "_tool_list_apply_queue"),
        service_entry="apply._queue.queue_overview",
        tool_fields=("limit",),
        tool_defaults=(("limit", _DEFAULT_QUEUE_LIMIT),),
        ignore_unknown_arguments=True,
        http=HttpRoute("GET", "/api/apply/queue", ApplyQueueListOut, tags=("apply",)),
    )
    list_apply_records = ActionSpec(
        name="list_apply_records",
        description=(
            "查看投递记录（按投递批次分组）：每个批次的状态与成功/失败/跳过计数，"
            "以及批次里每个岗位的投递结果、失败分类与可操作诊断。"
            "用户问「上次投递结果怎么样」「为什么投失败」时用它。"
            "重投需经提案卡确认；确认后会真的提交，且不可撤销。"
        ),
        input_model=ListApplyRecordsInput,
        permission=Permission.READ_ONLY,
        run=_run_list_apply_records,
        run_tool=tool_runner(
            "app.services.assistant_tools.apply_tools", "_tool_list_apply_records"
        ),
        service_entry="apply._records.record_batch_page",
        tool_fields=("keyword", "result", "limit"),
        tool_defaults=(("limit", _DEFAULT_RECORD_LIMIT),),
        ignore_unknown_arguments=True,
        http=HttpRoute(
            "GET",
            "/api/apply/records/grouped",
            Page[ApplyRecordBatchOut],
            tags=("apply",),
        ),
    )
    _ACTIONS = {spec.name: spec for spec in (list_apply_queue, list_apply_records)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return apply_actions()


__all__ = ["ListApplyQueueInput", "ListApplyRecordsInput", "actions", "apply_actions"]
