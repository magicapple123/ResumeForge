# SPDX-License-Identifier: Apache-2.0
"""webform 域 action 契约（T28 收尾）：网申填充记录（放宽模式只读）。

迁移对（行为零漂移：run / run_tool 都直接委托既有实现）：

- list_web_form_fills ↔ GET /api/webform/records
  （handler app.api.webform.fill_routes.list_records）

**跳过 get_web_form_fill（不做迁移）**：路由路径参数叫 record_id（
GET /api/webform/records/{record_id}），旧工具参数叫 fill_id；HttpRoute 要求路径参数必须
是 input_model 的必填字段，而工具调用拿不到路由侧 id 名——同一 input_model 无法同时
表达两侧入参（除非在 kernel 加参数别名机制）。按迁移规则跳过并保留原 Tool 声明。

放宽模式门控必须原样保留（requires_relaxed=True）：记录里含用户填进别人网页的真实值。
路由默认 limit 来自 services.webform.history.DEFAULT_LIST_LIMIT / MAX_LIST_LIMIT（20/200），
工具默认 limit=20（旧 handler 口径）由 tool_defaults 保留。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.webform import WebFormFillRecordOut
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

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


_ACTIONS: dict[str, ActionSpec] | None = None


def webform_actions() -> dict[str, ActionSpec]:
    """构建（并注册）webform 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
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
    list_web_form_fills = define_action(
        ActionSpec(
            name="list_web_form_fills",
            description=(
                "列出网申填表的填充记录（页面、成功/未核对/失败数、方式与时间），"
                "可按关键词搜页面标题或网址。**放宽模式工具**：记录里含用户填进网页的真实值，"
                "仅当用户在设置里开启助手放宽模式后你才有这个工具。只读；删除与发起填充"
                "在网申填表页操作。"
            ),
            input_model=ListWebFormFillsInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.webform.fill_routes", "list_records"),
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.webform_fills",
                "_tool_list_web_form_fills",
            ),
            requires_relaxed=True,
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
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
    )
    get_web_form_fill = define_action(
        ActionSpec(
            name="get_web_form_fill",
            description=(
                "读取一次网申填充的完整明细：每个框认成了什么字段、真实填写了什么值、"
                "成功还是失败。**放宽模式工具**：内容含身份证号、手机号等敏感值，仅当用户"
                "开启助手放宽模式后才可用；除非用户明确询问当时填了什么，否则不要主动复述其中的敏感值。"
            ),
            input_model=GetWebFormFillInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.webform.fill_routes", "read_record"),
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.webform_fills",
                "_tool_get_web_form_fill",
                argument_map=lambda payload: {"fill_id": payload.record_id},
            ),
            requires_relaxed=True,
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
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
    )
    _ACTIONS = {
        list_web_form_fills.name: list_web_form_fills,
        get_web_form_fill.name: get_web_form_fill,
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return webform_actions()


__all__ = ["ListWebFormFillsInput", "actions", "webform_actions"]
