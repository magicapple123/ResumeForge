# SPDX-License-Identifier: Apache-2.0
"""webform 域 action 契约（T28 收尾）：网申填充记录（放宽模式只读）。

迁移对（行为零漂移：run / run_tool 都直接委托既有实现）：

- list_web_form_fills ↔ GET /api/webform/records
  （run 调 services.webform.history.list_records，路由 handler 是它的薄壳）
- get_web_form_fill   ↔ GET /api/webform/records/{record_id}
  （run 调 services.webform.history.record_or_none + 同一句 404 文案）

**跳过 get_web_form_fill（不做迁移）**：路由路径参数叫 record_id（
GET /api/webform/records/{record_id}），旧工具参数叫 fill_id；HttpRoute 要求路径参数必须
是 input_model 的必填字段，而工具调用拿不到路由侧 id 名——同一 input_model 无法同时
表达两侧入参（除非在 kernel 加参数别名机制）。按迁移规则跳过并保留原 Tool 声明。

放宽模式门控必须原样保留（requires_relaxed=True）：记录里含用户填进别人网页的真实值。
路由默认 limit 来自 services.webform.history.DEFAULT_LIST_LIMIT / MAX_LIST_LIMIT（20/200），
工具默认 limit=20（旧 handler 口径）由 tool_defaults 保留。
"""

from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ....schemas.webform import WebFormFillRecordOut
from ...webform import history as webform_history
from ..legacy import tool_runner
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

# 与 app/services/webform/history.py 的 DEFAULT_LIST_LIMIT / MAX_LIST_LIMIT 一致
# （路由 handler 的 Query 默认值/上限来自它们；tests/test_actions_relaxed_batch.py 钉住）。
_ROUTE_LIST_LIMIT = 20
_ROUTE_MAX_LIMIT = 200
_DEFAULT_TOOL_LIMIT = 20


class GetWebFormFillInput(BaseModel):
    """get_web_form_fill 两侧共用入参：路由路径参数叫 record_id，旧工具参数叫 fill_id。"""

    model_config = ConfigDict(extra="forbid")

    record_id: int = Field(description="填充记录 id，来自 list_web_form_fills")


class ListWebFormFillsInput(BaseModel):
    """list_web_form_fills 两侧共用入参：路由只认 limit，工具另有 keyword。"""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(
        default=_ROUTE_LIST_LIMIT,
        ge=1,
        le=_ROUTE_MAX_LIMIT,
        description="可选，最多返回多少条，默认 20",
    )
    keyword: str = Field(default="", description="可选，按页面标题或网址模糊匹配")


def _run_list_web_form_fills(db, payload: ListWebFormFillsInput) -> ActionOutcome:
    """填充记录列表：与 ``GET /api/webform/records`` 同一个服务函数。"""
    return ActionOutcome(data=webform_history.list_records(db, limit=payload.limit))


def _run_get_web_form_fill(db, payload: GetWebFormFillInput) -> ActionOutcome:
    """填充记录详情：与 ``GET /api/webform/records/{record_id}`` 同一个取数函数。

    404 的形状沿用旧路由（``HTTPException``，detail 就是那句中文），文案常量在
    ``services.webform.history``：换成 ``ActionError`` 会把 detail 变成 ``{code, message}``。
    """
    record = webform_history.record_or_none(db, payload.record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=webform_history.RECORD_NOT_FOUND_DETAIL)
    return ActionOutcome(data=record)


_ACTIONS: dict[str, ActionSpec] | None = None


def webform_actions() -> dict[str, ActionSpec]:
    """构建（不注册）webform 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # 内层重入已完成构建（工具声明模块在 assistant_tools 初始化期调用）
        return _ACTIONS
    list_web_form_fills = ActionSpec(
        name="list_web_form_fills",
        description=(
            "列出网申填表的填充记录（页面、成功/未核对/失败数、方式与时间），"
            "可按关键词搜页面标题或网址。**放宽模式工具**：记录里含用户填进网页的真实值，"
            "仅当用户在设置里开启助手放宽模式后你才有这个工具。只读；删除与发起填充"
            "在网申填表页操作。"
        ),
        input_model=ListWebFormFillsInput,
        permission=Permission.READ_ONLY,
        run=_run_list_web_form_fills,
        run_tool=tool_runner(
            "app.services.assistant_tools.data_tools.webform_fills",
            "_tool_list_web_form_fills",
        ),
        requires_relaxed=True,
        # RF-03b：run 真的调的就是这个服务函数（路由 handler 是它的薄壳），如实登记。
        service_entry="webform.history.list_records",
        tool_fields=("keyword", "limit"),
        tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
        ignore_unknown_arguments=True,
        http=HttpRoute(
            "GET",
            "/api/webform/records",
            list[WebFormFillRecordOut],
            tags=("webform",),
        ),
    )
    get_web_form_fill = ActionSpec(
        name="get_web_form_fill",
        description=(
            "读取一次网申填充的完整明细：每个框认成了什么字段、真实填写了什么值、"
            "成功还是失败。**放宽模式工具**：内容含身份证号、手机号等敏感值，仅当用户"
            "开启助手放宽模式后才可用；除非用户明确询问当时填了什么，否则不要主动复述其中的敏感值。"
        ),
        input_model=GetWebFormFillInput,
        permission=Permission.READ_ONLY,
        run=_run_get_web_form_fill,
        run_tool=tool_runner(
            "app.services.assistant_tools.data_tools.webform_fills",
            "_tool_get_web_form_fill",
            argument_map=lambda payload: {"fill_id": payload.record_id},
        ),
        requires_relaxed=True,
        # RF-03b：run 真的调的就是这个取数函数（404 文案也来自同一个服务模块）。
        service_entry="webform.history.record_or_none",
        tool_fields=("record_id",),
        # 旧工具参数叫 fill_id；路由路径参数叫 record_id，用别名机制对齐两侧。
        tool_argument_aliases=(("fill_id", "record_id"),),
        ignore_unknown_arguments=True,
        http=HttpRoute(
            "GET",
            "/api/webform/records/{record_id}",
            WebFormFillRecordOut,
            tags=("webform",),
        ),
    )
    _ACTIONS = {
        list_web_form_fills.name: list_web_form_fills,
        get_web_form_fill.name: get_web_form_fill,
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return webform_actions()


__all__ = ["ListWebFormFillsInput", "actions", "webform_actions"]
