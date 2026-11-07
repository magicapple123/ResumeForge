# SPDX-License-Identifier: Apache-2.0
"""action 契约层的类型定义（T27）：一份 ActionSpec 同时生成 HTTP 路由与 Agent 工具。

**单一真源**：参数 schema 只写在 ``input_model``（Pydantic，``extra="forbid"``）；权限级别、
写前预览、HTTP 元数据都挂在同一个 ``ActionSpec`` 上。``tool_adapter`` / ``route_adapter``
只做翻译，不允许各自补字段——这正是 T27 要消灭的"两套契约各自演化"。

**权限级别复用 T17**：四级权限的唯一真源是 ``assistant_tools._types.ToolPermission``，
这里用别名 ``Permission`` 导出，不复制第二份枚举（否则两处分级迟早漂移）。

**延迟导入**：本模块 import 期不拉起 ``assistant_tools`` 包。T28 迁移后工具声明模块会在
该包初始化期间反向 import 本包（拿 ``as_tool`` / ``define_action``），提前导入会形成
import 环；因此 ``Permission`` 走 PEP 562 的模块级 ``__getattr__`` 惰性导出。
"""

from __future__ import annotations

import inspect
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ValidationError

from ...runtime.validation_copy import validation_message

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ..assistant_tools._types import ToolPermission as Permission
    from ..assistant_tools.authorization import WritePreview


def permission_enum() -> type:
    """T17 的四级权限枚举（延迟导入，见下方 __getattr__）。"""
    from ..assistant_tools._types import ToolPermission

    return ToolPermission


def __getattr__(name: str) -> Any:
    """PEP 562 惰性导出 Permission：`from app.services.actions import Permission` 仍可用。"""
    if name == "Permission":
        return permission_enum()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


_HTTP_METHODS: tuple[str, ...] = ("GET", "POST", "PUT", "PATCH", "DELETE")
_ACTION_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
_PATH_RE = re.compile(r"^/[A-Za-z0-9_./{}-]*$")
_PATH_PARAM_RE = re.compile(r"\{([a-z_][a-z0-9_]*)\}")

# payload 用 Any 而不是 BaseModel：每个动作的入参模型都不同，而 Callable 的形参是
# **逆变**的——写成 Callable[[Session, BaseModel], X] 时，接收具体模型（CreateJobInput 等）
# 的 run 反而不被接受。模型正确性由 ``input_model`` 这个唯一真源保证，适配层一定先
# 校验再调用；这里只钉"两个位置、同步函数、返回类型"。
RunFunc = Callable[["Session", Any], "ActionOutcome"]
PreviewFunc = Callable[["Session", Any], "WritePreview"]

ErrorCode = Literal[
    "invalid_input",
    "invalid_request",
    "not_found",
    "conflict",
    "permission_denied",
    "unavailable",
    "internal",
]


@dataclass(frozen=True, slots=True)
class ErrorSemantics:
    """一个错误码在两侧的语义：路由用 ``http_status``，工具用 ``tool_error``。"""

    http_status: int
    tool_error: str


ERROR_CODES: tuple[ErrorCode, ...] = (
    "invalid_input",
    # invalid_request：请求结构合法但违反领域规则（迁移前是 HTTPException(400) 的路径）；
    # invalid_input 专指 schema 校验失败（422）。
    "invalid_request",
    "not_found",
    "conflict",
    "permission_denied",
    "unavailable",
    "internal",
)
# 错误语义的**唯一**映射表：路由侧取 http_status、工具侧取 tool_error（T27 验收：
# 两侧同源）。新增错误码只改这里；ActionError 构造时立刻校验，未知码直接报错。
ERROR_SEMANTICS: Mapping[ErrorCode, ErrorSemantics] = MappingProxyType(
    {
        "invalid_input": ErrorSemantics(422, "invalid_input"),
        "invalid_request": ErrorSemantics(400, "invalid_request"),
        "not_found": ErrorSemantics(404, "not_found"),
        "conflict": ErrorSemantics(409, "conflict"),
        "permission_denied": ErrorSemantics(403, "permission_denied"),
        "unavailable": ErrorSemantics(503, "unavailable"),
        "internal": ErrorSemantics(500, "internal_error"),
    }
)


def error_semantics(code: str) -> ErrorSemantics:
    """取错误码的语义；未知码是契约层 bug，直接 ValueError。"""
    semantics = ERROR_SEMANTICS.get(code)  # type: ignore[arg-type]
    if semantics is None:
        raise ValueError(f"未知的 action 错误码：{code!r}")
    return semantics


class ActionError(ValueError):
    """契约层错误：既是 ActionError（路由/奇偶校验按 code 映射），也是 ValueError
    （工具层的历史契约是"失败抛 ValueError"，assistant_stream 统一转结构化结果），
    这样迁移前后的工具对既有调用方保持同一异常族。"""

    """契约层统一错误：同一个 code 在路由侧出 HTTP 状态码、在工具侧出稳定 error token。

    工具执行层（``api/assistant_tool_exec.run_tool_call``）把 ``str(exc)`` 原样写进
    ``record["error"]``，所以 ``__str__`` 以映射后的 token 开头——T28 的奇偶校验据此
    断言两侧错误来自同一张表。
    """

    __slots__ = ("code", "http_status", "message", "tool_error")

    def __init__(self, code: ErrorCode, message: str) -> None:
        semantics = error_semantics(code)
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message
        self.http_status = semantics.http_status
        self.tool_error = semantics.tool_error

    def __str__(self) -> str:
        return f"{self.tool_error}: {self.message}"


def validate_input(spec: ActionSpec, payload: Mapping[str, Any]) -> BaseModel:
    """按 ``input_model`` 校验参数；失败统一转成 ``invalid_input``。

    路由适配层与工具适配层**共用这一条校验路径**，否则同一份非法输入会在两侧得到
    不同的错误形状（T27 的奇偶校验就是钉这件事）。
    """
    try:
        if spec.ignore_unknown_arguments:
            allowed = set(spec.input_model.model_fields)
            payload = {key: value for key, value in payload.items() if key in allowed}
        return spec.input_model.model_validate(payload)
    except ValidationError as exc:
        parts = []
        for error in exc.errors():
            location = ".".join(str(item) for item in error.get("loc", ())) or "arguments"
            # 文案与 HTTP 422 handler 共用同一张映射表（``runtime.validation_copy``）：
            # 同一份非法输入，界面上看到的和助手复述的必须是同一句中文。
            parts.append(f"{location}: {validation_message(error)}")
        raise ActionError("invalid_input", "；".join(parts) or "参数校验失败") from exc


@dataclass(frozen=True, slots=True)
class HttpRoute:
    """动作对应的 HTTP 入口。method / path / response_model **三项都显式声明**。

    路径不从 action 名自动推导（``/api/jobs/{job_id}/status`` 这类嵌套路径必须逐字写）；
    ``path`` 里的 ``{param}`` 必须同时是 ``ActionSpec.input_model`` 的必填字段。
    """

    method: str
    path: str
    response_model: Any
    status_code: int = 200
    tags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.method not in _HTTP_METHODS:
            raise ValueError(f"http.method 必须是 {_HTTP_METHODS} 之一：{self.method!r}")
        if not _PATH_RE.fullmatch(self.path):
            raise ValueError(f"http.path 必须以 / 开头且不含空白或查询串：{self.path!r}")
        if self.path.count("{") != len(self.path_parameters) or self.path.count("}") != len(
            self.path_parameters
        ):
            raise ValueError(f"http.path 里的路径参数写法不合法：{self.path!r}")
        if self.response_model is None:
            raise ValueError("http.response_model 必须显式给出（不允许从 action 名推导）")
        if not isinstance(self.status_code, int) or not 200 <= self.status_code <= 299:
            raise ValueError(f"http.status_code 必须是 2xx：{self.status_code!r}")
        if self.method == "GET" and self.status_code != 200:
            raise ValueError("GET 路由的 status_code 必须是 200")
        if len(self.tags) != len(set(self.tags)):
            raise ValueError(f"http.tags 重复：{self.tags!r}")

    @property
    def path_parameters(self) -> tuple[str, ...]:
        return tuple(_PATH_PARAM_RE.findall(self.path))


@dataclass(frozen=True, slots=True)
class ActionOutcome:
    """一次动作执行结果：工具侧取 summary/text/link/changed，路由侧取 data。

    ``data`` 必须符合 ``http.response_model``（路由返回体），工具侧不消费它。
    """

    summary: str = ""
    text: str = ""
    link: str = ""
    changed: bool = False
    data: Any = None


@dataclass(frozen=True, slots=True)
class ActionSpec:
    """一个动作的完整定义（HTTP 与工具两侧的单一真源）。

    ``run`` 必须是同步函数（``(Session, input_model) -> ActionOutcome``）；异步动作
    （联网检索类）暂不纳入契约层，避免适配层出现"同步/异步两套路径"。
    """

    name: str
    description: str
    input_model: type[BaseModel]
    permission: Permission
    run: RunFunc
    # T28：**工具侧替代实现**，仅在路由与工具的既有写语义确实不同时使用（例如
    # PUT /api/profile 是整份替换，而 update_profile 工具是 read-modify-write；
    # 同一条 run 无法同时保持两种历史写语义）。两侧仍共用同一个 input_model 与权限/
    # 预览声明，且都必须复用既有 service/helper——不允许借这个字段复制业务逻辑。
    # 路由永远走 run；工具走 run_tool（未提供时等价于 run）。
    run_tool: RunFunc | None = None
    # T28：**工具侧字段投影**。为 None 时工具接受 input_model 的全部字段；给定元组时
    # 工具 schema 与工具入参校验都只保留这些字段（模型侧看不到、也传不进路由专属字段，
    # 例如 claims 的 verification_status、materials 的 files、profile 的嵌套条目标）。
    # 路由侧仍然用完整 input_model（OpenAPI/运行时都不受影响）。
    tool_fields: tuple[str, ...] | None = None
    # T28：工具参数别名（旧工具参数名 -> input_model 字段名 的元组序列）。
    # 例：get_web_form_fill 的旧工具参数是 fill_id，而路由路径参数叫 record_id；
    # 工具 schema 与校验用别名，路由侧不受影响。
    tool_argument_aliases: tuple[tuple[str, str], ...] = ()
    preview: PreviewFunc | None = None
    http: HttpRoute | None = None
    requires_web_search: bool = False
    requires_relaxed: bool = False
    # T23-b：迁移后的工具仍要声明"这段能力落到哪个 services 符号"（as_tool 原样传给
    # Tool）。未注册的 ActionSpec（单测构造）可以不填；已注册工具有 T23-b 守卫兜底。
    service_entry: str | None = None
    service_reason: str = ""
    # T28：**工具侧专属**的入参默认值（''键, 值'' 元组，保持 dataclass 可哈希）。
    # 路由侧不应用它们——例如 create_job 工具历史上会把 recognition_source 默认成
    # "AI 助手录入"，而同一路由必须保留"未提供就是空串"的原有语义。只在 tool_adapter
    # 里 setdefault，绝不写进 input_model 的字段默认（否则两侧行为会再次分叉）。
    tool_defaults: tuple[tuple[str, Any], ...] = ()
    # T28：迁移既有路由时的**历史兼容开关**。旧路由用 Pydantic 默认 extra=ignore
    # （例如 POST /api/jobs 会原样收下 parse-text 草稿里的额外字段）；契约层的
    # input_model 仍是 extra=forbid 的唯一真源，但校验前可以按此开关丢弃未知字段，
    # 保持"旧客户端行为不变"。新写的动作不要开它（默认 False = 严格拒绝未知字段）。
    ignore_unknown_arguments: bool = False

    def __post_init__(self) -> None:
        if not _ACTION_NAME_RE.fullmatch(self.name):
            raise ValueError(f"action name 必须是小写 snake_case（= 工具名）：{self.name!r}")
        if not self.description.strip():
            raise ValueError(f"action {self.name} 缺少 description（它同时是 OpenAPI summary）")
        if not (isinstance(self.input_model, type) and issubclass(self.input_model, BaseModel)):
            raise ValueError(f"action {self.name} 的 input_model 必须是 Pydantic BaseModel 子类")
        if self.input_model.model_config.get("extra") != "forbid":
            raise ValueError(
                f"action {self.name} 的 input_model 必须设置 extra='forbid'（唯一真源，拒绝未知字段）"
            )
        if not isinstance(self.permission, permission_enum()):
            raise ValueError(f"action {self.name} 的 permission 必须是 Permission 成员")
        for alias, field in self.tool_argument_aliases:
            if field not in self.input_model.model_fields:
                raise ValueError(
                    f"action {self.name} 的 tool_argument_aliases 指向不存在的字段：{field!r}"
                )
            if alias in self.input_model.model_fields and alias != field:
                raise ValueError(f"action {self.name} 的别名 {alias!r} 与模型字段重名，无法区分")
        if self.tool_fields is not None:
            unknown = [
                name for name in self.tool_fields if name not in self.input_model.model_fields
            ]
            if unknown:
                raise ValueError(
                    f"action {self.name} 的 tool_fields 含有模型里不存在的字段：{unknown}"
                )
        for entry in self.tool_defaults:
            if not (isinstance(entry, tuple) and len(entry) == 2 and isinstance(entry[0], str)):
                raise ValueError(
                    f"action {self.name} 的 tool_defaults 必须是 (str, value) 元组序列：{entry!r}"
                )
        if not callable(self.run):
            raise ValueError(f"action {self.name} 的 run 必须可调用")
        if inspect.iscoroutinefunction(self.run):
            raise ValueError(f"action {self.name} 的 run 必须是同步函数（异步动作暂不纳入契约层）")
        self._validate_preview()
        self._validate_http()
        for flag_name in ("requires_web_search", "requires_relaxed"):
            if not isinstance(getattr(self, flag_name), bool):
                raise ValueError(f"action {self.name} 的 {flag_name} 必须是 bool")

    def _validate_preview(self) -> None:
        if self.permission.is_write:
            if self.preview is None:
                raise ValueError(f"写操作 {self.name} 必须提供 preview（写前结构化预览）")
            if not callable(self.preview):
                raise ValueError(f"action {self.name} 的 preview 必须可调用")
        elif self.preview is not None:
            raise ValueError(f"只读操作 {self.name} 不应提供 preview（它没有写入需要预览）")

    def _validate_http(self) -> None:
        if self.http is None:
            # 工具专属动作（无 HTTP 等价入口）允许没有路由。
            return
        if not isinstance(self.http, HttpRoute):
            raise ValueError(f"action {self.name} 的 http 必须是 HttpRoute")
        for param in self.http.path_parameters:
            field = self.input_model.model_fields.get(param)
            if field is None:
                raise ValueError(f"http.path 参数 {{{param}}} 未在 input_model 里声明")
            if not field.is_required():
                raise ValueError(f"http.path 参数 {param} 不能有默认值（必须由 URL 提供）")


__all__ = [
    "ERROR_CODES",
    "ERROR_SEMANTICS",
    "ActionError",
    "ActionOutcome",
    "ActionSpec",
    "ErrorCode",
    "ErrorSemantics",
    "HttpRoute",
    "Permission",
    "error_semantics",
    "permission_enum",
    "validate_input",
]
