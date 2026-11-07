# SPDX-License-Identifier: Apache-2.0
"""ActionSpec → FastAPI 路由（**只生成，不注册**）。

注册位置仍由 ``application_routers.ROUTERS`` 显式决定：本模块不 import application、
不往任何全局 router 挂东西。路由顺序是行为契约（``job_match`` 先于 ``jobs``、
``interview_history`` 先于 ``interview`` 等，见该文件行内注释），自动注册会让这条契约失效。

错误语义与工具侧同源：输入校验失败 / ``ActionError`` 都走 ``ERROR_SEMANTICS``，路由返回
``{"detail": {"code": <tool_error>, "message": ...}}``；工具侧的 ``record["error"]`` 以同一个
token 开头（见 ``ActionError.__str__``）——T28 的奇偶校验据此比对。

**未知参数两侧不同**（有意为之）：GET/DELETE 在 HTTP 边界剥离 ``input_model`` 未声明的
query/path 键（迁移前的 FastAPI handler 就是忽略，不能让一次重构收紧对外契约），
而工具侧仍按 ``extra="forbid"`` 拒绝未知参数。实现见 ``_drop_undeclared``。
"""

from __future__ import annotations

import json
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from .spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, validate_input
from .tool_adapter import to_tool_schema

_QUERY_METHODS = frozenset({"GET", "DELETE"})


def _http_error(exc: ActionError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.tool_error, "message": exc.message},
    )


def _query_payload(request: Request) -> dict[str, Any]:
    """query 参数按出现次数归并：重复键变成 list（``?ids=1&ids=2``）。"""
    payload: dict[str, Any] = {}
    for key, value in request.query_params.multi_items():
        if key not in payload:
            payload[key] = value
        elif isinstance(payload[key], list):
            payload[key].append(value)
        else:
            payload[key] = [payload[key], value]
    return payload


async def _request_payload(route: HttpRoute, request: Request) -> dict[str, Any]:
    payload: dict[str, Any] = dict(request.path_params)
    if route.method in _QUERY_METHODS:
        payload.update(_query_payload(request))
        return payload
    body = await request.body()
    if not body:
        return payload
    try:
        decoded = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ActionError("invalid_input", "请求体不是合法 JSON") from exc
    if not isinstance(decoded, dict):
        raise ActionError("invalid_input", "请求体必须是 JSON 对象")
    payload.update(decoded)
    return payload


def _drop_undeclared(payload: dict[str, Any], spec: ActionSpec) -> dict[str, Any]:
    """route 侧丢弃 ``input_model`` 未声明的键（**仅** GET/DELETE 的 query/path 参数）。

    **路由侧宽容、工具侧仍 forbid**——这是迁移前后行为对齐的分界线：

    - 迁移前的 FastAPI handler 只从 ``request.query_params`` 里挑自己声明的键，多传的
      query 参数一律**静默忽略**（``GET /api/claims?page=1&page_size=20`` 就是 200）。
    - 迁移后参数真源是 ``extra="forbid"`` 的 ``input_model``（工具侧必须严格拒绝未知
      字段，否则模型能塞任意键进来），同一个 URL 就变成 422 "Extra inputs are not
      permitted"——等于**无意收紧了对外 HTTP 契约**，前端多带一个分页参数就挂。
    - 所以这里在 HTTP 边界按"多传字段 = 剥离而非报错"处理，恢复迁移前的忽略语义；
      **不要**改用 ``ActionSpec.ignore_unknown_arguments`` 开关：那是给**工具侧**用它
      自己的语义（历史工具 handler 忽略非工具字段），改成全局开关会让工具侧也失去
      对未知字段的拒绝能力。

    剥离只发生在 GET/DELETE：body 类方法（POST/PUT/PATCH）仍按 ``input_model`` 严格
    校验，请求体里的未知字段照旧 422。已声明字段**一项都不放过**：剥离之后照样走
    ``validate_input``，required/范围/枚举与迁移前同一份 schema。
    """
    allowed = set(spec.input_model.model_fields)
    return {key: value for key, value in payload.items() if key in allowed}


def _openapi_parameters(route: HttpRoute, schema: dict[str, Any]) -> list[dict[str, Any]]:
    properties: dict[str, Any] = schema.get("properties") or {}
    required = set(schema.get("required") or ())
    parameters: list[dict[str, Any]] = []
    for name in route.path_parameters:
        parameters.append(
            {
                "name": name,
                "in": "path",
                "required": True,
                "schema": properties.get(name) or {"type": "string"},
            }
        )
    if route.method in _QUERY_METHODS:
        for name, prop in properties.items():
            if name in route.path_parameters:
                continue
            parameters.append(
                {"name": name, "in": "query", "required": name in required, "schema": prop}
            )
    return parameters


def _body_schema(route: HttpRoute, schema: dict[str, Any]) -> dict[str, Any]:
    """body schema 去掉路径参数：它们由 URL 提供，不应再要求在请求体里出现。"""
    path_parameters = set(route.path_parameters)
    properties = {
        name: prop
        for name, prop in (schema.get("properties") or {}).items()
        if name not in path_parameters
    }
    body_schema = {**schema, "properties": properties}
    required = [name for name in schema.get("required") or () if name not in path_parameters]
    if required:
        body_schema["required"] = required
    else:
        body_schema.pop("required", None)
    return body_schema


def _openapi_extra(route: HttpRoute, schema: dict[str, Any]) -> dict[str, Any]:
    """请求侧 schema：GET/DELETE 用 query 参数，其余用 JSON body（与解析规则同源）。"""
    extra: dict[str, Any] = {}
    parameters = _openapi_parameters(route, schema)
    if parameters:
        extra["parameters"] = parameters
    if route.method not in _QUERY_METHODS:
        body_schema = _body_schema(route, schema)
        extra["requestBody"] = {
            "required": bool(body_schema.get("properties")),
            "content": {"application/json": {"schema": body_schema}},
        }
    return extra


def as_route(spec: ActionSpec) -> APIRouter:
    """生成承载该动作的路由（单条 route）。挂在哪、排第几由调用方显式决定。"""
    if not isinstance(spec, ActionSpec):
        raise TypeError(f"as_route 只接受 ActionSpec：{type(spec)!r}")
    route = spec.http
    if route is None:
        raise ValueError(f"action {spec.name} 没有 http 元数据，无法生成路由")
    # 局部导入：spec/tool 适配层可以离线单测，不必在 import 期就依赖数据库引擎。
    from ...database import get_db

    schema = to_tool_schema(spec.input_model)

    async def endpoint(request: Request, db: Session = Depends(get_db)) -> Any:
        try:
            raw = await _request_payload(route, request)
            if route.method in _QUERY_METHODS:
                # 路由侧宽容、工具侧仍 forbid（见 _drop_undeclared）。
                raw = _drop_undeclared(raw, spec)
            payload = validate_input(spec, raw)
            outcome = spec.run(db, payload)
        except ActionError as exc:
            raise _http_error(exc) from exc
        if not isinstance(outcome, ActionOutcome):
            raise _http_error(
                ActionError("internal", f"action {spec.name} 的 run 未返回 ActionOutcome")
            )
        return outcome.data

    router = APIRouter()
    router.add_api_route(
        route.path,
        endpoint,
        methods=[route.method],
        response_model=route.response_model,
        status_code=route.status_code,
        summary=spec.description,
        name=spec.name,
        tags=list(route.tags) or None,
        openapi_extra=_openapi_extra(route, schema),
    )
    return router


def add_action_route(router: APIRouter, spec: ActionSpec, *, route_path: str | None = None) -> None:
    """把 action 生成的路由**原样**追加到既有 APIRouter（增量迁移用，不改变注册顺序）。

    as_route() 产出的是**绝对路径**路由（含 /api 前缀）；挂到带 prefix 的既有 router 时
    不能再走 include_router（父级 prefix 会被再拼一次）。这里直接并入路由表：父级 router
    只有 prefix/tags（见各 api 模块），行为等价；追加位置 = 调用处在模块里的位置，注册
    顺序仍是显式契约（``application_routers.ROUTERS`` 决定模块顺序）。

    route_path：给嵌套子路由包用（如 app/api/resumes/versions_routes.py）。子模块
    router 会被父级以 prefix="/api/resumes" include，此时要传相对路径，否则绝对路径
    会被父 prefix 再拼一次。
    """
    if not isinstance(spec, ActionSpec):
        raise TypeError(f"add_action_route 只接受 ActionSpec：{type(spec)!r}")
    generated = as_route(spec).routes
    if route_path is not None:
        # 与 FastAPI 的 APIRouter.add_api_route 保持一致：本 router 若有 prefix，
        # 注册时就要把 prefix 拼到 path 上（否则 include 时会报 prefix/path 双空）。
        # 嵌套子路由包（子模块 router 无 prefix、由父级 include 时加 prefix）保持相对路径。
        prefix = (router.prefix or "").rstrip("/")
        for route in generated:
            # as_route() 产出的必定是 FastAPI 的 APIRoute（BaseRoute 是它的类型上界，
            # 本身没有 path 属性，所以这里按实际类型收窄再改写）。
            cast("APIRoute", route).path = prefix + route_path
    router.routes.extend(generated)


__all__ = ["add_action_route", "as_route"]
