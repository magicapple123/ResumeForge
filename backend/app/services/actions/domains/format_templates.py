# SPDX-License-Identifier: Apache-2.0
"""简历版式（format_templates）域的 action 契约（T28 收尾批）：list / create。

迁移对（工具 ↔ 路由，真实成对存在）：

- list_format_templates   ↔ GET  /api/resume-templates（只读；kind 是路由筛选参数）
- create_format_template  ↔ POST /api/resume-templates（可逆写）

**未迁移 update_format_template（跳过，原因见 T28 汇报）**：路由路径参数 ``template_id``
必须是必填字段（``HttpRoute`` 的硬校验），而旧工具允许「只给 template_name、不给 id」
按名字定位——同一份 ``input_model`` 无法同时表达两种必填语义。硬改会让工具失去按名字
改版式的能力，属于对模型侧契约的行为回退，故保留静态 Tool 声明。

两侧入参差异：路由 body 是 ``ResumeTemplateCreate``（``config`` 是整份 dict + ``kind``），
旧工具则是「name/description + 扁平排版参数」并只用 kind=format。契约层用一个 input_model
取并集：路由字段照旧，工具字段通过 ``tool_fields`` 投影后可见；``run_tool`` 委托旧 handler
（它负责把扁平参数拼成 config 并校验），``run`` 走路由语义（kind 必须是 format）。

行为保持：路由 path/method/response_model/status_code、工具 name/description/permission/
preview/service_entry 不变；错误统一走契约层映射（旧路由 400 的 detail 形状改为
{code,message}，状态码不变）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, create_model

from ....schemas.resume_template import (
    MAX_TEMPLATE_DESCRIPTION_CHARS,
    MAX_TEMPLATE_NAME_CHARS,
    ResumeTemplateCreate,
    ResumeTemplateDetail,
    ResumeTemplateOut,
)
from ....services.resume.resume_template_format import FORMAT_FIELD_KEYS, FORMAT_FIELDS
from ..legacy import preview_runner, tool_runner
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

# 旧工具 handler 所在模块：run_tool 直接委托它们，行为零漂移。
_TOOL_HANDLERS = "app.services.assistant_tools.data_tools.format_templates"
# 旧工具 preview_* 只理解「扁平排版参数」，路由专属字段永远不会出现在工具入参里。
_ROUTE_ONLY_FIELDS = frozenset({"kind", "html", "config", "source_name"})


def _format_field_definitions() -> dict[str, tuple[Any, Any]]:
    """按 ``FORMAT_FIELDS`` 生成扁平排版参数字段（与旧工具声明同源、描述逐字保留）。

    旧工具用 ``_format_tool_properties()`` 手工拼 JSON schema；契约层的唯一真源是
    Pydantic 模型，所以同一份 FORMAT_FIELDS 改成模型字段：颜色是字符串，其余是数值并带
    旧声明里的 min/max 与中文说明。新增可调项时这里自动跟着变，不用两处同步。
    """
    definitions: dict[str, tuple[Any, Any]] = {}
    for spec in FORMAT_FIELDS:
        key = spec["key"]
        if spec["type"] == "color":
            definitions[key] = (
                str | None,
                Field(
                    default=None,
                    description=f"{spec['label']}，十六进制颜色，如 #2f6feb",
                ),
            )
            continue
        note = f"（{spec['description']}）" if spec.get("description") else ""
        # 刻意不在这里加 ge/le：范围校验的唯一实现是旧 handler 的 validated_format_config
        # （它会逐个点名"哪一项、允许范围多少"，越界时给模型可读中文原因）。若模型层先用
        # 数字约束拒绝，模型只会看到英文 schema 错误，失去"改哪一个、改到多少"的提示。
        definitions[key] = (
            float | None,
            Field(
                default=None,
                description=f"{spec['label']}，范围 {spec['min']}–{spec['max']}{note}",
            ),
        )
    return definitions


# list_format_templates 两侧共用入参：kind 是路由 query，工具不需要参数。
class ListFormatTemplatesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str | None = Field(
        default=None, pattern="^(style|format)$", description="可选，按类型筛选（路由参数）"
    )


# 动态模型：路由字段来自既有 schema（约束不重写），工具扁平字段来自 FORMAT_FIELDS。
# 扁平字段先落到 ``dict[str, Any]`` 再展开：直接 ``**_format_field_definitions()`` 时
# pyright 会按 tuple 值逐个对齐 create_model 的具名参数（__config__/__module__…）并报
# 类型错；值类型收宽后类型检查不再猜键名，运行时仍是同一份 Pydantic 动态模型。
_FIELD_DEFINITIONS: dict[str, Any] = _format_field_definitions()
CreateFormatTemplateInput = create_model(  # type: ignore[call-overload]
    "CreateFormatTemplateInput",
    __base__=ResumeTemplateCreate,
    __doc__=None,
    name=(
        str,
        Field(
            ...,
            min_length=1,
            max_length=MAX_TEMPLATE_NAME_CHARS,
            description="版式名称（1-40 字符，中文/字母/数字/空格/下划线/连字符）",
        ),
    ),
    description=(
        str,
        Field(
            default="",
            max_length=MAX_TEMPLATE_DESCRIPTION_CHARS,
            description="可选，一句话说明用途",
        ),
    ),
    **_FIELD_DEFINITIONS,
)


def _run_list_format_templates(db: Session, payload: ListFormatTemplatesInput) -> ActionOutcome:
    from ....schemas.resume_template import ResumeTemplateOut as _Out
    from ...resume.resume_template_store import list_user_templates

    rows = list_user_templates(db, payload.kind)
    return ActionOutcome(data=[_Out.model_validate(row) for row in rows])


def _run_create_format_template(db: Session, payload: Any) -> ActionOutcome:
    from ....api.resume_templates import STYLE_OFFLINE_DETAIL, _to_detail
    from ...resume.resume_template_store import TemplateError, create_user_template

    tool_only = set(FORMAT_FIELD_KEYS) & set(payload.model_fields_set)
    if tool_only:
        # 旧路由 body 是 extra=forbid 的 ResumeTemplateCreate：扁平排版参数在旧路由是 422。
        raise ActionError("invalid_input", f"路由不接受这些只有工具才有的字段：{sorted(tool_only)}")
    # 旧路由：kind 只接受 format（style 已下线，400）；缺省值是 style，同样 400。
    if payload.kind != "format":
        raise ActionError("invalid_request", STYLE_OFFLINE_DETAIL)
    try:
        template = create_user_template(
            db,
            name=payload.name,
            kind=payload.kind,
            description=payload.description,
            html=payload.html,
            config=payload.config,
            source_name=payload.source_name,
        )
    except TemplateError as exc:
        raise ActionError("invalid_request", str(exc)) from exc
    return ActionOutcome(
        summary=f"新建了版式「{template.name}」",
        changed=True,
        data=_to_detail(template),
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def format_template_actions() -> dict[str, ActionSpec]:
    """构建（并注册）版式域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    list_format_templates = define_action(
        ActionSpec(
            name="list_format_templates",
            description=(
                "列出用户自制的版式（id、名称、说明、排版参数如强调色/行高/页边距）。"
                "用户问「我有哪些版式」「之前那个版式设了哪些参数」时用它，"
                "也用于在 update_format_template 之前确认要改哪一个。"
                "内置版式与模板（完整 HTML）不在此列，它们只能在「工作台」页查看。"
            ),
            input_model=ListFormatTemplatesInput,
            permission=Permission.READ_ONLY,
            run=_run_list_format_templates,
            run_tool=tool_runner(_TOOL_HANDLERS, "_tool_list_format_templates"),
            service_entry="resume.resume_template_store.list_user_templates",
            tool_fields=(),
            # 旧 GET 路由的未知 query 参数一律忽略（FastAPI 默认行为）。
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET", "/api/resume-templates", list[ResumeTemplateOut], tags=("resume-templates",)
            ),
        )
    )
    create_format_template = define_action(
        ActionSpec(
            name="create_format_template",
            description=(
                "新建一个「版式」——只调排版参数（强调色/行高/页边距/区块间距/字号系数），不写 HTML。"
                "用户说「版式太挤」「帮我压进一页」「换个强调色」「做一个版式」时用它。"
                "至少设置一项参数。名称限 1-40 个字符、只能含中文/字母/数字/空格/下划线/连字符，"
                "且不能与内置或已有的模板、版式重名；自制模板与版式的总数上限 40 个。"
                "注意：**模板（外观骨架、完整 HTML）这一层不能用工具创建**，那需要用户到「工作台」页操作；"
                "版式这一层可以，本工具就是做这个的。"
            ),
            input_model=CreateFormatTemplateInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_format_template,
            run_tool=tool_runner(_TOOL_HANDLERS, "_tool_create_format_template"),
            preview=preview_runner(
                "app.services.assistant_tools.previews", "preview_create_format_template"
            ),
            service_entry="resume.resume_template_store.create_user_template",
            tool_fields=("name", "description", *FORMAT_FIELD_KEYS),
            http=HttpRoute(
                "POST",
                "/api/resume-templates",
                ResumeTemplateDetail,
                status_code=201,
                tags=("resume-templates",),
            ),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (list_format_templates, create_format_template)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return format_template_actions()


__all__ = [
    "CreateFormatTemplateInput",
    "ListFormatTemplatesInput",
    "actions",
    "format_template_actions",
]
