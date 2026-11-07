# SPDX-License-Identifier: Apache-2.0
"""ActionSpec → 既有 ``Tool(...)`` 的适配层，以及 Pydantic schema → 工具 JSON schema。

模型侧只吃 function calling 的 JSON schema 子集（DeepSeek 同款）：不接受 ``$defs`` /
``$ref`` / ``title``。``to_tool_schema()`` 把 ``model_json_schema()`` 展开成扁平结构，
保留 ``enum`` / ``required`` / ``description`` / ``additionalProperties``；``required``
必须与 ``input_model`` 逐项一致（T27 验收之一）。

本模块只生成 ``Tool`` 对象、**不注册**：注册仍由 ``assistant_tools._registry._TOOLS`` 的
显式清单决定，避免"import 即有副作用"。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from .spec import ActionError, ActionOutcome, ActionSpec, validate_input

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ..assistant_tools._types import Tool, ToolResult

_JSON_SCHEMA_REF_PREFIX = "#/$defs/"

# 只对**工具 schema** 生效的瘦身键：模型侧不需要这些 JSON-schema 装饰，留着会按
# 每个参数几十字节地推高每轮固定 prompt（test_assistant_prompt_budget 的 45,000
# 字符上限就是量这个）。路由 OpenAPI 仍保留完整约束（to_tool_schema compact=False）。
_TOOL_SCHEMA_OMIT_KEYS = frozenset(
    {
        "default",
        "maxLength",
        "minLength",
        "maximum",
        "minimum",
        "exclusiveMaximum",
        "exclusiveMinimum",
        "multipleOf",
        "pattern",
        "examples",
        # additionalProperties 由契约层的 input_model（extra=forbid）在运行期兜底，
        # 模型侧看不到它也不影响安全性；每个工具省 ~31 字符，79 个工具约省 2.4k。
        "additionalProperties",
    }
)


def _expand(node: Any, defs: dict[str, Any], stack: tuple[str, ...], *, compact: bool) -> Any:
    """展开 ``$ref`` 并去掉 ``title``；递归模型无法扁平化，直接报错。"""
    if isinstance(node, list):
        return [_expand(item, defs, stack, compact=compact) for item in node]
    if not isinstance(node, dict):
        return node
    # 只去掉 JSON schema 的 title **注解**（值一定是字符串）；属性本身叫 title 时
    # 它在 properties 映射里，值是 schema 对象——不能连属性一起删掉（create_reminder
    # 的 title 参数就是这么消失的）。
    cleaned = {
        key: value
        for key, value in node.items()
        if not (key == "title" and isinstance(value, str))
        and not (compact and key in _TOOL_SCHEMA_OMIT_KEYS)
    }
    ref = cleaned.pop("$ref", None)
    if ref is not None:
        ref_text = str(ref)
        if not ref_text.startswith(_JSON_SCHEMA_REF_PREFIX):
            raise ValueError(f"无法展开的 JSON schema 引用：{ref_text!r}")
        name = ref_text[len(_JSON_SCHEMA_REF_PREFIX) :]
        if name not in defs:
            raise ValueError(f"JSON schema 引用了不存在的定义：{name!r}")
        if name in stack:
            raise ValueError(f"input_model 存在递归结构，无法扁平化为工具 schema：{name}")
        expanded = _expand(defs[name], defs, (*stack, name), compact=compact)
        if not isinstance(expanded, dict):
            raise ValueError(f"JSON schema 定义必须是对象：{name!r}")
        cleaned = {**expanded, **cleaned}
    all_of = cleaned.get("allOf")
    if isinstance(all_of, list) and len(all_of) == 1:
        # Pydantic 对"带描述的模型字段"会生成 allOf: [{$ref}]，同样要拍平。
        merged = _expand(all_of[0], defs, stack, compact=compact)
        if isinstance(merged, dict):
            cleaned = {**merged, **{key: value for key, value in cleaned.items() if key != "allOf"}}
    return {key: _expand(value, defs, stack, compact=compact) for key, value in cleaned.items()}


def to_tool_schema(input_model: type[BaseModel], *, compact: bool = False) -> dict[str, Any]:
    """把 Pydantic 模型的 JSON schema 适配成工具参数 schema（无 ``$defs``/``$ref``/``title``）。"""
    raw = input_model.model_json_schema()
    defs = raw.get("$defs") or {}
    root = {key: value for key, value in raw.items() if key != "$defs"}
    schema = _expand(root, defs, (), compact=compact)
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise ValueError(f"{input_model.__name__} 的工具参数 schema 必须是 object")
    # 与既有工具声明口径一致：没有必填字段时也显式给出 required=[]。
    schema.setdefault("required", [])
    if compact:
        # 模型侧不需要 input_model 的类 docstring（工具描述已经说了用途）；
        # 它还会随每个迁移动作增加几十到几百字符的固定 prompt 成本。
        schema.pop("description", None)
    return schema


def project_tool_schema(schema: dict[str, Any], allowed: tuple[str, ...]) -> dict[str, Any]:
    """按 tool_fields 白名单投影工具参数 schema（properties/required 同步裁剪）。"""
    keep = set(allowed)
    projected = dict(schema)
    projected["properties"] = {
        name: value for name, value in (schema.get("properties") or {}).items() if name in keep
    }
    required = [name for name in schema.get("required") or () if name in keep]
    projected["required"] = required
    return projected


def _apply_tool_aliases(spec: ActionSpec, arguments: dict[str, Any]) -> dict[str, Any]:
    """把旧工具参数名换成 input_model 字段名（见 ActionSpec.tool_argument_aliases）。"""
    if not spec.tool_argument_aliases:
        return arguments
    renamed = dict(arguments)
    for alias, field in spec.tool_argument_aliases:
        if alias in renamed and field not in renamed:
            renamed[field] = renamed.pop(alias)
    return renamed


def _validate_tool_arguments(spec: ActionSpec, arguments: dict[str, Any]) -> Any:
    """工具侧校验：先按 tool_fields 剥离非工具字段，再走与路由同一条校验路径。

    这里选择**剥离而不是报错**：迁移前旧工具 handler 对声明之外的字段就是忽略
    （例如 create_claim 会忽略模型塞进来的 verification_status 并强制「待确认」），
    报错会让旧调用方行为发生变化；字段剥离后 run_tool 里的旧 handler 仍按原语义执行。
    """
    arguments = _apply_tool_aliases(spec, arguments)
    if spec.tool_fields is not None:
        allowed = set(spec.tool_fields)
        arguments = {key: value for key, value in arguments.items() if key in allowed}
    return validate_input(spec, arguments)


def _with_tool_defaults(spec: ActionSpec, arguments: dict[str, Any]) -> dict[str, Any]:
    """合并工具侧专属默认值（路由侧不经过这里，见 ActionSpec.tool_defaults）。"""
    if not spec.tool_defaults:
        return arguments
    merged = dict(arguments)
    for key, value in spec.tool_defaults:
        merged.setdefault(key, value)
    return merged


def _preview_adapter(spec: ActionSpec, preview_func: Any) -> Any:
    def preview(db: Session, arguments: dict[str, Any]) -> Any:
        # 预览**不应用** tool_defaults：工具历史预览就只看"模型显式要求的改动"，
        # 加上默认值会让预览卡片多出用户没要求的行（执行时仍按 run 的默认值落库）。
        return preview_func(db, _validate_tool_arguments(spec, arguments))

    return preview


def _run_action(spec: ActionSpec, db: Session, arguments: dict[str, Any]) -> ActionOutcome:
    payload = _validate_tool_arguments(spec, _with_tool_defaults(spec, arguments))
    # 只有确实存在"路由/工具写语义不同"时才用 run_tool（见 ActionSpec 字段注释）。
    runner = spec.run_tool if spec.run_tool is not None else spec.run
    outcome = runner(db, payload)
    if not isinstance(outcome, ActionOutcome):
        raise ActionError("internal", f"action {spec.name} 的 run 未返回 ActionOutcome")
    return outcome


def as_tool(spec: ActionSpec) -> Tool:
    """按 ActionSpec 生成现有工具层的 ``Tool``（只生成、不注册）。"""
    if not isinstance(spec, ActionSpec):
        raise TypeError(f"as_tool 只接受 ActionSpec：{type(spec)!r}")
    # 延迟导入：迁移后工具声明模块会在 assistant_tools 包初始化期间调用本函数，
    # 模块顶层导入会形成 import 环（见 spec.py 文档）。
    from ..assistant_tools._types import Tool, ToolResult

    parameters = to_tool_schema(spec.input_model, compact=True)
    if spec.tool_fields is not None:
        parameters = project_tool_schema(parameters, spec.tool_fields)
    for alias, field in spec.tool_argument_aliases:
        props = parameters.get("properties") or {}
        if field in props:
            parameters["properties"] = {
                (alias if key == field else key): value for key, value in props.items()
            }
            parameters["required"] = [
                alias if item == field else item for item in parameters.get("required", [])
            ]

    def handler(db: Session, arguments: dict[str, Any]) -> ToolResult:
        outcome = _run_action(spec, db, arguments)
        # ToolResult 没有 data 字段：data 是路由返回体，模型侧只该看到 text/summary。
        return ToolResult(
            text=outcome.text,
            summary=outcome.summary,
            link=outcome.link,
            changed=outcome.changed,
        )

    adapted_preview = _preview_adapter(spec, spec.preview) if spec.preview is not None else None
    return Tool(
        name=spec.name,
        description=spec.description,
        parameters=parameters,
        handler=handler,
        permission=spec.permission,
        requires_web_search=spec.requires_web_search,
        requires_relaxed=spec.requires_relaxed,
        preview=adapted_preview,
        service_entry=spec.service_entry,
        service_reason=spec.service_reason,
    )


__all__ = ["as_tool", "to_tool_schema"]
