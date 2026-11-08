# SPDX-License-Identifier: Apache-2.0
"""T27 阶段二：3 个试点的双侧奇偶校验（路由 ↔ 工具，契约层 ActionSpec 是唯一真源）。

试点（2026-11-07 Lead 裁决，手册原稿的批量改状态 / 整份正文覆盖在仓库里没有成对实现，
按 D16「真实存在动作优先」换成下面三对；偏差理由见 deliverables T27 证据）：

1. list_claims ↔ GET /api/claims（只读）
2. create_reminder ↔ POST /api/reminders（可逆写，有 preview）
3. update_skill ↔ PUT /api/assistant/skills/{skill_id}（不可逆写，有 preview）

验收对照（T27 手册）：
a. 同一份非法输入：路由 4xx 的 detail.code 与工具 ActionError.tool_error 同表同值；
b. 同一份合法输入：路由与工具各执行一次，目标数据库行字段级 diff 相同；
c. tool.parameters 的 required/enum 与 input_model 完全一致（逐项）；
d. writes/permission/preview 与迁移前一致（T17 定级不变）；
e. 3 条路由响应体形状与既有断言一致（键集合 + 既有 routes 测试在回归中跑）。
"""

from __future__ import annotations

import json
from typing import Literal, get_args, get_origin

import pytest
from app.models.assistant import AssistantSkill
from app.models.reminder import Reminder
from app.services.actions import ERROR_SEMANTICS, ActionError, to_tool_schema
from app.services.actions.pilots import pilot_actions
from app.services.assistant_tools import execute_tool, get_tool
from app.services.assistant_tools import previews as legacy_previews
from app.services.assistant_tools._shared import (
    DEFAULT_LIST_LIMIT,
    MAX_ASSISTANT_SKILL_FILE_CHARS,
    MAX_ASSISTANT_SKILL_FILES,
    MAX_ASSISTANT_SKILL_TOTAL_CHARS,
)
from app.services.assistant_tools._types import ToolPermission

PILOT_NAMES = ("list_claims", "create_reminder", "update_skill")

# 迁移前的声明（T17/T23-b 与工具描述；迁移后必须逐项不变）。
EXPECTED_PERMISSIONS = {
    "list_claims": (ToolPermission.READ_ONLY, False, False),
    "create_reminder": (ToolPermission.REVERSIBLE_WRITE, True, True),
    "update_skill": (ToolPermission.IRREVERSIBLE_WRITE, True, True),
}
EXPECTED_SERVICE_ENTRIES = {
    "list_claims": "claims.list_claims",
    "create_reminder": "reminder_service.create_reminder",
    "update_skill": "assistant.assistant_skills.update_skill",
}
EXPECTED_DESCRIPTION_FRAGMENTS = {
    "list_claims": "列出事实台账里的条目",
    "create_reminder": "新增一条日历提醒",
    "update_skill": "修改一个技能的提示词",
}


def _pilots() -> dict:
    return pilot_actions()


def _literal_values(annotation) -> list | None:
    """字段注解是 Literal 时返回它的取值（含 "" 这类过滤哨兵），否则 None。"""
    if get_origin(annotation) is Literal:
        return [str(value) for value in get_args(annotation)]
    return None


def _schema_enum(schema: dict) -> list | None:
    """工具 schema 里一个属性的 enum 取值（Pydantic 可选 Literal 会包在 anyOf 里）。"""
    if "enum" in schema:
        return [str(value) for value in schema["enum"]]
    for branch in schema.get("anyOf") or ():
        if "enum" in branch:
            return [str(value) for value in branch["enum"]]
    return None


# ----------------------------- c. schema 对齐 -----------------------------


def test_every_pilot_has_tool_and_explicit_http_route():
    actions = _pilots()
    # T28 起 registry 还会登记 jobs 域首批动作；T27 的 3 个试点必须都在。
    assert set(PILOT_NAMES) <= set(actions)
    for name, action in actions.items():
        assert action.http is not None, name
        assert action.http.method and action.http.path.startswith("/api/"), name
        assert action.http.response_model is not None, name
        assert get_tool(name) is not None, f"{name} 没有注册同名工具"


@pytest.mark.parametrize("name", PILOT_NAMES)
def test_tool_parameters_are_generated_from_input_model(name):
    action = _pilots()[name]
    tool = get_tool(name)
    # as_tool() 用 compact schema（去掉 default/maxLength 等模型侧装饰以控制 prompt 体积），
    # 单一真源仍是同一份 input_model；这里对齐 compact=True。
    assert tool.parameters == to_tool_schema(action.input_model, compact=True), name
    # 属性名恰好叫 "title" 时不能被"去 title 注解"误删（create_reminder 踩过）。
    for required_field in tool.parameters["required"]:
        assert required_field in tool.parameters["properties"], f"{name}.{required_field} 缺 schema"
    expected_required = [
        field_name
        for field_name, field in action.input_model.model_fields.items()
        if field.is_required()
    ]
    assert tool.parameters["required"] == expected_required, name


EXPECTED_ENUM_FIELDS = {"list_claims": 1, "create_reminder": 2, "update_skill": 0}


@pytest.mark.parametrize("name", PILOT_NAMES)
def test_tool_enum_matches_input_model_literals(name):
    """逐字段：input_model 里的 Literal 取值必须原样出现在工具 schema 的 enum 里。"""
    action = _pilots()[name]
    tool = get_tool(name)
    checked = 0
    for field_name, field in action.input_model.model_fields.items():
        literal = _literal_values(field.annotation)
        if literal is None:
            continue
        property_schema = tool.parameters["properties"][field_name]
        assert _schema_enum(property_schema) == literal, f"{name}.{field_name}"
        checked += 1
    # 计数也钉住：字段突然失去 Literal（enum 从工具 schema 里消失）不能被这条守卫放过。
    assert checked == EXPECTED_ENUM_FIELDS[name], f"{name} 的 Literal 字段数变了"


# ----------------------------- d. 权限/预览/描述不变 -----------------------------


@pytest.mark.parametrize("name", PILOT_NAMES)
def test_permission_writes_preview_unchanged(name):
    permission, writes, has_preview = EXPECTED_PERMISSIONS[name]
    action = _pilots()[name]
    tool = get_tool(name)
    assert tool.permission is permission
    assert tool.writes is writes
    assert (tool.preview is not None) is has_preview
    # ActionSpec 与 Tool 同源：permission 只声明在一处。
    assert action.permission is permission
    assert tool.service_entry == EXPECTED_SERVICE_ENTRIES[name]
    assert EXPECTED_DESCRIPTION_FRAGMENTS[name] in tool.description
    assert tool.description == action.description


def test_hardcoded_limits_match_shared_constants():
    """pilots.py 里为了躲 import 环硬编码的上限值必须与 _shared 一致（防漂移）。"""
    list_action = _pilots()["list_claims"]
    assert list_action.input_model.model_fields["limit"].default == DEFAULT_LIST_LIMIT
    description = _pilots()["update_skill"].description
    assert f"最多 {MAX_ASSISTANT_SKILL_FILES} 个文件" in description
    assert f"单文件不超过 {MAX_ASSISTANT_SKILL_FILE_CHARS} 字符" in description
    assert f"合计不超过 {MAX_ASSISTANT_SKILL_TOTAL_CHARS} 字符" in description
    # T14：提示词也有上限，且必须与 schemas/skill.py 一致（test_skill_limits_guard 复核）。
    assert "提示词不超过 4000 字符" in description


# ----------------------------- a. 非法输入：两侧同表 -----------------------------


def _tool_error(name: str, arguments: dict, db_session) -> ActionError:
    with pytest.raises(ActionError) as info:
        execute_tool(db_session, name, arguments)
    return info.value


def test_claims_invalid_input_parity(client, db_session):
    response = client.get("/api/claims", params={"category": "不存在的分类"})
    assert response.status_code == ERROR_SEMANTICS["invalid_input"].http_status
    error = _tool_error("list_claims", {"category": "不存在的分类"}, db_session)
    assert response.json()["detail"]["code"] == error.tool_error
    assert error.tool_error == ERROR_SEMANTICS["invalid_input"].tool_error
    assert str(error).startswith(f"{error.tool_error}: ")


def test_claims_unknown_query_is_dropped_on_route_but_forbidden_for_tool(client, db_session):
    """R06：路由侧宽容、工具侧仍 forbid。

    迁移前的 FastAPI handler 只从 ``request.query_params`` 里挑自己声明的键，多传的键
    静默忽略；T27 把参数真源换成 ``extra="forbid"`` 的 input_model 后，一次"多传一个
    query 键"在两侧的结论**必须不同**：HTTP 调用方看到的是剥离（200），模型侧仍是
    ``invalid_input``。这条用例把两侧各自的语义都钉住，不许任一侧偷偷变成另一侧。
    """
    response = client.get("/api/claims", params={"page": 1, "page_size": 20})
    assert response.status_code == 200, response.text
    assert "items" in response.json()
    # 工具侧不许跟着放宽：未知参数仍按 input_model 的 extra="forbid" 拒绝。
    error = _tool_error("list_claims", {"page": 1, "page_size": 20}, db_session)
    assert error.tool_error == ERROR_SEMANTICS["invalid_input"].tool_error == "invalid_input"


def test_create_reminder_invalid_input_parity(client, db_session):
    response = client.post("/api/reminders", json={})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == ERROR_SEMANTICS["invalid_input"].tool_error
    error = _tool_error("create_reminder", {}, db_session)
    assert error.code == "invalid_input"
    assert str(error).startswith("invalid_input: ")
    # R05：迁移路由的 422 文案与全局 handler 共用 runtime.validation_copy，必须是中文、
    # 不再出现 Pydantic 英文原句；路由侧与工具侧还得是**同一句**（否则界面与助手会各说各话）。
    route_message = str(response.json()["detail"]["message"])
    assert "Field required" not in route_message, route_message
    assert "必填" in route_message or "参数" in route_message, route_message
    assert route_message == error.message


def test_update_skill_invalid_input_parity(client, db_session):
    created = client.post(
        "/api/assistant/skills",
        json={"name": "T27 空改动技能", "prompt": "提示词"},
    )
    skill_id = created.json()["id"]
    response = client.put(f"/api/assistant/skills/{skill_id}", json={})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_input"
    error = _tool_error("update_skill", {"skill_id": skill_id}, db_session)
    assert error.code == "invalid_input"
    assert response.json()["detail"]["code"] == error.tool_error


# ----------------------------- b. 合法输入：数据库行 diff 相同 -----------------------------

REMINEDER_FIELDS = (
    "title",
    "remind_at",
    "kind",
    "status",
    "track_id",
    "job_id",
    "resume_id",
    "note",
)


def test_create_reminder_route_and_tool_persist_same_row(client, db_session):
    payload = {
        "title": "T27 奇偶校验提醒",
        "remind_at": "2026-12-01T10:00:00",
        "kind": "interview",
        "note": "路由与工具各建一条，字段必须一致",
    }
    route_response = client.post("/api/reminders", json=payload)
    assert route_response.status_code == 201
    route_row = db_session.get(Reminder, route_response.json()["id"])

    tool_result = execute_tool(db_session, "create_reminder", dict(payload))
    tool_row = db_session.get(Reminder, json.loads(tool_result.text)["id"])

    assert route_row is not None and tool_row is not None
    assert {field: getattr(route_row, field) for field in REMINEDER_FIELDS} == {
        field: getattr(tool_row, field) for field in REMINEDER_FIELDS
    }


def test_update_skill_route_and_tool_persist_same_row(client, db_session):
    def _create(name: str) -> int:
        response = client.post(
            "/api/assistant/skills",
            json={"name": name, "description": "旧说明", "prompt": "旧提示词"},
        )
        assert response.status_code == 201
        return response.json()["id"]

    route_id = _create("T27 路由改技能")
    tool_id = _create("T27 工具改技能")
    route_payload = {
        "description": "新说明",
        "prompt": "新提示词",
        "enabled": False,
        "files": [{"path": "题库.md", "content": "压舱石级别的独特句子"}],
    }
    route_response = client.put(f"/api/assistant/skills/{route_id}", json=route_payload)
    assert route_response.status_code == 200
    tool_arguments = {"skill_id": tool_id, **route_payload}
    execute_tool(db_session, "update_skill", tool_arguments)

    db_session.expire_all()
    route_skill = db_session.get(AssistantSkill, route_id)
    tool_skill = db_session.get(AssistantSkill, tool_id)
    assert route_skill is not None and tool_skill is not None
    # name 不参与比对：两条记录必须各自唯一，payload 里本来就不改 name。
    scalar_fields = ("description", "prompt", "enabled")
    assert {field: getattr(route_skill, field) for field in scalar_fields} == {
        field: getattr(tool_skill, field) for field in scalar_fields
    }
    files_of = lambda skill: sorted(  # noqa: E731 - 就地取值，逻辑一行
        (item.path, item.content, item.size_bytes) for item in skill.files
    )
    assert (
        files_of(route_skill)
        == files_of(tool_skill)
        == [("题库.md", "压舱石级别的独特句子", len("压舱石级别的独特句子"))]
    )


# ----------------------------- d'. 预览行为不变 -----------------------------


def test_create_reminder_preview_matches_legacy(client, db_session):
    raw = {"title": "预览提醒", "remind_at": "2026-12-01T10:00:00", "kind": "interview"}
    adapted = get_tool("create_reminder").preview(db_session, dict(raw))
    legacy = legacy_previews.preview_create_reminder(db_session, dict(raw))
    assert adapted == legacy


def test_update_skill_preview_matches_legacy(client, db_session):
    created = client.post(
        "/api/assistant/skills", json={"name": "T27 预览技能", "prompt": "提示词"}
    )
    raw = {"skill_id": created.json()["id"], "description": "新说明"}
    adapted = get_tool("update_skill").preview(db_session, dict(raw))
    legacy = legacy_previews.preview_update_skill(db_session, dict(raw))
    assert adapted == legacy


# ----------------------------- e. 路由响应体形状不变 -----------------------------


def test_three_route_response_shapes_unchanged(client):
    claims = client.get("/api/claims")
    assert claims.status_code == 200
    assert set(claims.json()) == {
        "items",
        "total",
        "confirmed_count",
        "pending_count",
        "category_counts",
    }

    reminder = client.post(
        "/api/reminders",
        json={"title": "T27 形状提醒", "remind_at": "2026-12-01T10:00:00"},
    )
    assert reminder.status_code == 201
    assert set(reminder.json()) == {
        "id",
        "title",
        "remind_at",
        "kind",
        "status",
        "track_id",
        "job_id",
        "resume_id",
        "note",
        "created_at",
        "updated_at",
    }

    created = client.post(
        "/api/assistant/skills", json={"name": "T27 形状技能", "prompt": "提示词"}
    )
    updated = client.put(f"/api/assistant/skills/{created.json()['id']}", json={"enabled": False})
    assert updated.status_code == 200
    assert set(updated.json()) == {
        "id",
        "name",
        "description",
        "enabled",
        "source_name",
        "prompt_chars",
        "files",
        "updated_at",
        "prompt",
        "file_details",
        "files_truncated",
    }


def test_claims_route_still_returns_all_rows_while_tool_text_respects_limit(client, db_session):
    """limit 是工具侧"给模型看多少条"的参数，不能把路由响应截断（行为不变）。"""
    for index in range(3):
        client.post(
            "/api/claims",
            json={"title": f"T27 台账 {index}", "category": "其他", "source_fact": "事实"},
        )
    route_items = client.get("/api/claims").json()["items"]
    assert len(route_items) >= 3
    tool_payload = json.loads(execute_tool(db_session, "list_claims", {"limit": 1}).text)
    assert tool_payload["返回"] == 1
    assert tool_payload["总数"] >= 3
