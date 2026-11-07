# SPDX-License-Identifier: Apache-2.0
"""T27 契约层内核单测：ActionSpec 校验 / registry 去重 / schema 适配 / 错误映射 / 结果形状。

第一阶段只测内核，不迁移任何既有动作（T28 才按域迁移）。三条关键性质：

1. to_tool_schema() 的输出必须是模型侧能吃的扁平 JSON schema：无 $defs / $ref / title，
   enum / required / description 保留，且 required 与 input_model 逐项一致（T27 验收 #2 内核版）。
2. 错误语义只有一份映射表：ActionError / 路由 4xx / 工具错误串都从 ERROR_SEMANTICS 取 token。
3. ActionOutcome 的字段形状是两侧共用的契约，字段名/顺序/默认值改动必须显式评审。

进程隔离：reset_registry() 在每个用例前后清空内存表，避免"import 悄悄注册了动作"被漏检。
"""

from __future__ import annotations

import re
from dataclasses import FrozenInstanceError, fields

import pytest
from app.database import get_db
from app.services.actions import (
    ERROR_CODES,
    ERROR_SEMANTICS,
    ActionError,
    ActionOutcome,
    ActionSpec,
    HttpRoute,
    Permission,
    action_names,
    as_route,
    as_tool,
    define_action,
    error_semantics,
    get_action,
    list_actions,
    reset_registry,
    route_actions,
    to_tool_schema,
)
from app.services.assistant_tools._types import ToolResult
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.actions_contract_support import (
    DemoInput,
    EchoOut,
    ItemInput,
    ItemOut,
    LooseInput,
    Mini,
    Node,
    OptionalIdInput,
    Outer,
    _async_run,
    _has_key,
    _has_title_annotation,
    _raise_not_found,
    _record,
    _spec,
    _write_spec,
)


@pytest.fixture(autouse=True)
def _clean_registry():
    reset_registry()
    yield
    reset_registry()
    # 进程级共享表：teardown 要把 import 期注册的全部 actions 还回去，否则串行全量里后面的守卫看到空表。
    from app.services.actions.catalog import all_actions

    all_actions()


@pytest.fixture()
def client_for():
    def build(spec: ActionSpec):
        application = FastAPI()
        application.include_router(as_route(spec))
        application.dependency_overrides[get_db] = lambda: object()
        return application, TestClient(application)

    return build


# ----------------------------- ActionSpec 校验 -----------------------------


def test_action_spec_accepts_minimal_read_only():
    spec = _spec()
    assert (spec.preview, spec.http, spec.requires_web_search) == (None, None, False)


@pytest.mark.parametrize(
    ("overrides", "match"),
    [
        ({"name": "BadName"}, "snake_case"),
        ({"name": ""}, "snake_case"),
        ({"description": "  "}, "description"),
        ({"input_model": dict}, "BaseModel"),
        ({"input_model": LooseInput}, "forbid"),
        ({"permission": "read_only"}, "permission"),
        ({"preview": lambda session, payload: "预览"}, "preview"),
        ({"http": {"method": "GET"}}, "HttpRoute"),
        ({"run": None}, "run"),
        ({"run": _async_run}, "同步"),
        ({"requires_relaxed": 1}, "bool"),
    ],
)
def test_action_spec_rejects_invalid_fields(overrides, match):
    with pytest.raises(ValueError, match=match):
        _spec(**overrides)


@pytest.mark.parametrize(
    "permission",
    [Permission.REVERSIBLE_WRITE, Permission.IRREVERSIBLE_WRITE, Permission.EXTERNAL_SIDE_EFFECT],
)
def test_write_requires_preview(permission):
    with pytest.raises(ValueError, match="preview"):
        _spec(permission=permission)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"method": "get", "path": "/api/x", "response_model": EchoOut},
        {"method": "FETCH", "path": "/api/x", "response_model": EchoOut},
        {"method": "GET", "path": "api/x", "response_model": EchoOut},
        {"method": "GET", "path": "/api/x?debug=1", "response_model": EchoOut},
        {"method": "GET", "path": "/api/x", "response_model": None},
        {"method": "GET", "path": "/api/x", "response_model": EchoOut, "status_code": 302},
        {"method": "GET", "path": "/api/x", "response_model": EchoOut, "status_code": 201},
        {"method": "GET", "path": "/api/x/{bad-id}", "response_model": EchoOut},
    ],
)
def test_http_route_rejects_incomplete_or_invalid(kwargs):
    with pytest.raises(ValueError):
        HttpRoute(**kwargs)


def test_http_path_parameters_must_be_required_input_fields():
    with pytest.raises(ValueError, match="resume_id"):
        _spec(http=HttpRoute("GET", "/api/resumes/{resume_id}", EchoOut))
    with pytest.raises(ValueError, match="默认值"):
        _spec(input_model=OptionalIdInput, http=HttpRoute("GET", "/x/{resume_id}", EchoOut))


# ----------------------------- registry -----------------------------


def test_registry_import_registers_nothing():
    assert list_actions() == () and action_names() == () and route_actions() == ()


def test_define_action_registers_and_enumerates():
    first = define_action(_spec(name="first_action"))
    second = define_action(_write_spec(name="second_action"))
    assert list_actions() == (first, second)
    assert action_names() == ("first_action", "second_action")
    assert get_action("first_action") is first
    assert get_action("nope") is None
    assert route_actions() == (second,)


def test_duplicate_action_name_rejected():
    define_action(_spec(name="dup_action"))
    with pytest.raises(ValueError, match="dup_action"):
        define_action(_spec(name="dup_action"))


def test_duplicate_http_route_rejected():
    define_action(_write_spec(name="route_one"))
    with pytest.raises(ValueError, match="/api/test/items/\\{item_id\\}"):
        define_action(_write_spec(name="route_two"))


def test_same_path_with_other_method_allowed():
    define_action(_spec(name="route_get", http=HttpRoute("GET", "/api/test/same", EchoOut)))
    define_action(_write_spec(name="route_post", http=HttpRoute("POST", "/api/test/same", ItemOut)))


# ----------------------------- tool schema 适配 -----------------------------


def test_tool_schema_is_flat():
    schema = to_tool_schema(Outer)
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    for forbidden in ("$defs", "$ref"):
        assert not _has_key(schema, forbidden), forbidden
    # title 只允许作为属性名出现；JSON schema 的 title 注解必须被去掉。
    assert not _has_title_annotation(schema)


def test_tool_schema_preserves_enum_required_description():
    schema = to_tool_schema(Outer)
    assert schema["required"] == ["title", "inner"]
    inner = schema["properties"]["inner"]
    assert inner["type"] == "object" and inner["additionalProperties"] is False
    assert inner["required"] == ["color", "score"]
    assert inner["properties"]["color"] == {
        "type": "string",
        "enum": ["red", "blue"],
        "description": "颜色",
    }
    assert inner["properties"]["score"]["description"] == "分数"
    assert schema["properties"]["inners"]["items"]["properties"]["color"]["enum"] == [
        "red",
        "blue",
    ]
    assert schema["properties"]["note"]["description"] == "备注"


def test_tool_schema_required_matches_input_model_fields():
    for model in (Outer, ItemInput, DemoInput):
        expected = [name for name, field in model.model_fields.items() if field.is_required()]
        assert to_tool_schema(model)["required"] == expected


def test_tool_schema_snapshot_for_minimal_model():
    # 快照：模型侧 schema 的稳定形状。改它等于改所有工具的参数契约，必须评审。
    assert to_tool_schema(Mini) == {
        "type": "object",
        "properties": {"name": {"type": "string"}},
        "required": ["name"],
        "additionalProperties": False,
    }


def test_tool_schema_rejects_recursive_model():
    with pytest.raises(ValueError, match="递归"):
        to_tool_schema(Node)


# ----------------------------- as_tool -----------------------------


def test_as_tool_maps_spec_and_permission():
    tool = as_tool(_write_spec(requires_web_search=True))
    assert (tool.name, tool.description) == ("demo_write", "演示动作")
    # as_tool 用 compact schema（去掉 additionalProperties/default 等模型侧装饰控制 prompt 体积）。
    assert tool.parameters == to_tool_schema(ItemInput, compact=True)
    assert (tool.permission, tool.writes, tool.preview is not None) == (
        Permission.REVERSIBLE_WRITE,
        True,
        True,
    )
    assert (tool.requires_web_search, tool.requires_relaxed) == (True, False)
    read_only = as_tool(_spec())
    assert (read_only.writes, read_only.preview) == (False, None)


def test_as_tool_handler_maps_outcome_to_tool_result():
    result = as_tool(_spec()).handler(object(), {"keyword": "k", "limit": 3})
    expected = ("摘要", "正文", "/demo", True)
    assert isinstance(result, ToolResult)
    assert (result.summary, result.text, result.link, result.changed) == expected
    assert result.sources == []


def test_as_tool_invalid_arguments_use_shared_error_code():
    with pytest.raises(ActionError) as info:
        as_tool(_write_spec()).handler(object(), {"bogus": 1})
    expected = ERROR_SEMANTICS["invalid_input"].tool_error
    assert info.value.code == "invalid_input"
    assert str(info.value).startswith(f"{expected}: ")


def test_as_tool_preview_adapts_and_validates_arguments():
    seen = []
    spec = _spec(
        permission=Permission.REVERSIBLE_WRITE,
        preview=lambda session, payload: seen.append(payload) or "预览",
    )
    tool = as_tool(spec)
    assert tool.preview(object(), {"limit": "5"}) == "预览"
    assert seen[0].limit == 5


# ----------------------------- ActionOutcome 形状 -----------------------------


def test_action_outcome_field_shape():
    assert [field.name for field in fields(ActionOutcome)] == [
        "summary",
        "text",
        "link",
        "changed",
        "data",
    ]


def test_action_outcome_defaults_and_frozen():
    outcome = ActionOutcome()
    assert (outcome.summary, outcome.text, outcome.link) == ("", "", "")
    assert (outcome.changed, outcome.data) == (False, None)
    with pytest.raises(FrozenInstanceError):
        outcome.text = "changed"


# ----------------------------- 错误映射 -----------------------------


def test_error_semantics_single_table_covers_all_codes():
    assert tuple(ERROR_SEMANTICS) == ERROR_CODES
    for code in ERROR_CODES:
        semantics = error_semantics(code)
        assert 400 <= semantics.http_status <= 599
        assert re.fullmatch(r"[a-z][a-z0-9_]*", semantics.tool_error)
    with pytest.raises(ValueError, match="未知"):
        ActionError("bogus", "出错了")


@pytest.mark.parametrize("code", ERROR_CODES)
def test_action_error_reads_both_sides_from_same_table(code):
    semantics = ERROR_SEMANTICS[code]
    error = ActionError(code, "出错了")
    assert (error.http_status, error.tool_error) == (
        semantics.http_status,
        semantics.tool_error,
    )
    assert (error.code, error.message) == (code, "出错了")
    assert str(error) == f"{semantics.tool_error}: 出错了"


# ----------------------------- as_route -----------------------------


def test_as_route_requires_http_and_builds_single_route():
    with pytest.raises(ValueError, match="http"):
        as_route(_spec())
    router = as_route(_write_spec())
    assert len(router.routes) == 1
    assert router.routes[0].path == "/api/test/items/{item_id}"


def test_as_route_get_parses_query_parameters(client_for):
    seen = []
    spec = _spec(http=HttpRoute("GET", "/api/test/echo", EchoOut), run=_record(seen))
    application, client = client_for(spec)
    response = client.get("/api/test/echo", params={"keyword": "abc", "limit": "3"})
    assert response.status_code == 200
    assert response.json() == {"keyword": "abc", "limit": 3}
    assert seen[0].limit == 3
    operation = application.openapi()["paths"]["/api/test/echo"]["get"]
    assert [param["name"] for param in operation["parameters"]] == ["keyword", "limit"]


def test_as_route_post_merges_path_parameters_and_body(client_for):
    seen = []
    _, client = client_for(_write_spec(run=_record(seen)))
    response = client.post("/api/test/items/7", json={"name": "新名字"})
    assert response.status_code == 200
    assert response.json() == {"item_id": 7, "name": "新名字"}
    assert seen[0].item_id == 7


def test_as_route_invalid_input_uses_shared_mapping(client_for):
    _, client = client_for(_write_spec())
    for body in ({"bogus": 1}, {}):
        response = client.post("/api/test/items/7", json=body)
        assert response.status_code == ERROR_SEMANTICS["invalid_input"].http_status
        assert response.json()["detail"]["code"] == "invalid_input"


def test_as_route_action_error_uses_shared_mapping(client_for):
    spec = _spec(http=HttpRoute("GET", "/api/test/missing", EchoOut), run=_raise_not_found)
    _, client = client_for(spec)
    response = client.get("/api/test/missing")
    assert response.status_code == ERROR_SEMANTICS["not_found"].http_status
    assert response.json()["detail"] == {"code": "not_found", "message": "对象不存在"}


def test_route_and_tool_agree_on_illegal_input(client_for):
    spec = _write_spec(name="parity_action")
    _, client = client_for(spec)
    response = client.post("/api/test/items/7", json={"name": "x", "bogus": 1})
    with pytest.raises(ActionError) as info:
        as_tool(spec).handler(object(), {"item_id": 7, "name": "x", "bogus": 1})
    expected = ERROR_SEMANTICS["invalid_input"].tool_error
    assert response.json()["detail"]["code"] == info.value.tool_error == expected


def test_as_route_openapi_documents_path_parameter_and_body(client_for):
    _, client = client_for(_write_spec())
    operation = client.app.openapi()["paths"]["/api/test/items/{item_id}"]["post"]
    assert operation["summary"] == "演示动作"
    path_param = next(param for param in operation["parameters"] if param["in"] == "path")
    assert (path_param["name"], path_param["required"]) == ("item_id", True)
    body_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    assert body_schema["required"] == ["name"]
    assert body_schema["properties"]["name"]["description"] == "名称"
    assert "item_id" not in body_schema["properties"]
