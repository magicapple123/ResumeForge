# SPDX-License-Identifier: Apache-2.0
"""T28 Batch B：profile 域 1 对 + tracker 域 3 对的奇偶校验与行为保持。

迁移对：get_profile ↔ GET /api/profile；list_application_tracks ↔ GET /api/tracker；
get_application_track ↔ GET /api/tracker/{track_id}；create_application_track ↔ POST /api/tracker。
刻意不迁 update 两对（路由整份替换 / 工具 read-modify-write，理由见 domains 模块文档）。
断言：两侧同表错误 token、schema required/enum 对齐、写操作落库字段一致、只读不写库、
preview 与旧 previews.preview_* 一致。
"""

from __future__ import annotations

import json
from typing import Literal, get_args, get_origin

import pytest
from app.models.profile_entry import ProfileEntry
from app.models.tracker import STATUSES, ApplicationTrack, ApplicationTrackEvent
from app.services.actions import ActionError, get_action
from app.services.actions.domains import tracker as tracker_domain
from app.services.actions.domains.profile import profile_actions
from app.services.actions.domains.tracker import tracker_actions
from app.services.assistant_tools import execute_tool, get_tool
from app.services.assistant_tools import previews as legacy_previews
from app.services.assistant_tools._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from app.services.assistant_tools._types import ToolPermission
from app.services.assistant_tools.job_tools import _tool_get_profile
from app.services.profile.profile_service import project_legacy_profile
from app.services.settings_service import save_assistant_relaxed_mode

# 迁移前 Tool(...) 里的 name/description/permission/service_entry（迁移后必须逐项不变）。
EXPECTED_TOOL_DECLARATIONS = {
    "get_profile": (
        "读取个人资料（已脱敏：不含姓名、电话、邮箱和照片）。想确认某个字段是否已填写时用它。",
        ToolPermission.READ_ONLY,
        "settings_service.get_assistant_relaxed_mode",
    ),
    "list_application_tracks": (
        "列出求职进度记录，可按状态或公司/岗位/备注关键词筛选。用户问投递到哪一步、"
        "哪些岗位还在推进或哪些记录没有下一步时先调用。",
        ToolPermission.READ_ONLY,
        "tracker.list_tracks",
    ),
    "get_application_track": (
        "按 id 读取一条求职进度的完整内容。",
        ToolPermission.READ_ONLY,
        None,
    ),
    "create_application_track": (
        "新增一条求职进度。只在用户明确要求记录投递/筛选/面试/Offer 等进展时调用；"
        "公司、岗位和状态必填。",
        ToolPermission.REVERSIBLE_WRITE,
        "tracker.create_track",
    ),
}

PAIRS = {
    "get_profile": ("GET", "/api/profile"),
    "list_application_tracks": ("GET", "/api/tracker"),
    "get_application_track": ("GET", "/api/tracker/{track_id}"),
    "create_application_track": ("POST", "/api/tracker"),
}

PROFILE_PAYLOAD = {
    "name": "张三",
    "phone": "13800000000",
    "email": "zhangsan@example.com",
    "city": "北京",
    "summary": "三年后端开发经验",
    "educations": [{"school": "示例大学", "major": "软件工程", "degree": "本科"}],
}

TRACK_CREATE_PAYLOAD = {
    "company": "示例科技",
    "title": "后端开发工程师",
    "status": "interview",
    "stage_note": "二面",
    "applied_at": "2026-09-18",
    "status_date": "2026-10-08",
    "next_action": "等 HR 通知",
    "next_action_date": "2026-10-20",
    "note": "路由与工具各建一条，字段必须一致",
    "evidence": "邮件原文摘录",
}


def _all_actions() -> dict:
    return {**profile_actions(), **tracker_actions()}


def _route_error_code(response) -> str:
    detail = response.json().get("detail")
    assert isinstance(detail, dict), detail
    return str(detail.get("code"))


def _tool_error(name: str, arguments: dict, db_session) -> ActionError:
    with pytest.raises(ActionError) as info:
        execute_tool(db_session, name, arguments)
    return info.value


def _literal_values(annotation) -> list | None:
    if get_origin(annotation) is Literal:
        return [str(value) for value in get_args(annotation)]
    return None


def _required_fields(model: type) -> list[str]:
    return [name for name, field in model.model_fields.items() if field.is_required()]


def _seed_profile(client) -> dict:
    response = client.put("/api/profile", json=PROFILE_PAYLOAD)
    assert response.status_code == 200, response.text
    return response.json()


def _create_track(client, **overrides) -> dict:
    payload = {"company": "示例科技", "title": "后端开发工程师", "status": "applied"}
    payload.update(overrides)
    response = client.post("/api/tracker", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_migrated_pairs_are_registered_with_route_and_tool():
    actions = _all_actions()
    for name, (method, path) in PAIRS.items():
        spec = actions[name]
        assert (spec.http.method, spec.http.path) == (method, path), name
        assert spec.http.response_model is not None, name
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.permission is spec.permission, name
        assert tool.description == spec.description, name
        assert tool.parameters["type"] == "object", name


def test_migrated_tool_declarations_keep_legacy_name_description_permission():
    for name, (description, permission, service_entry) in EXPECTED_TOOL_DECLARATIONS.items():
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.description == description, name
        assert tool.permission is permission, name
        assert tool.service_entry == service_entry, name
        spec = _all_actions()[name]
        assert spec.description == description
        assert spec.permission is permission
        assert spec.service_entry == service_entry
    # service_entry=None 必须带理由（T23-b 口径），迁移时原样保留。
    get_track = _all_actions()["get_application_track"]
    assert get_track.service_reason.strip()
    assert get_tool("get_application_track").service_reason == get_track.service_reason


def test_update_pairs_use_run_tool_for_the_divergent_write_semantics():
    """update 两对：路由整份替换 vs 工具 read-modify-write → run_tool 分开委托旧实现。"""
    for name in ("update_profile", "update_application_track"):
        spec = get_action(name)
        assert spec is not None, f"{name} 应已迁到 action 契约层"
        assert spec.run_tool is not None, f"{name} 需要 run_tool 分流"
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.permission is ToolPermission.REVERSIBLE_WRITE, name
        assert tool.preview is not None, name


# ----------------------------- schema 对齐 -----------------------------


def test_schema_required_matches_input_model():
    actions = _all_actions()
    expected_required = {
        "get_profile": [],
        "list_application_tracks": [],
        "get_application_track": ["track_id"],
        "create_application_track": ["company", "title"],
        # T28 收尾批新增的两对：update_profile 全字段可选；tracker 的 id 来自路径。
        "update_profile": [],
        "update_application_track": ["track_id"],
    }
    for name, spec in actions.items():
        schema = get_tool(name).parameters
        assert "$ref" not in json.dumps(schema), name
        assert schema["required"] == expected_required[name], name
        assert schema["required"] == _required_fields(spec.input_model), name


def test_schema_enum_matches_input_model_literals():
    actions = _all_actions()
    list_status = _literal_values(
        actions["list_application_tracks"].input_model.model_fields["status"].annotation
    )
    assert list_status == [*STATUSES, ""]
    list_schema = get_tool("list_application_tracks").parameters["properties"]["status"]
    assert list_schema["enum"] == list_status

    create_status = _literal_values(
        actions["create_application_track"].input_model.model_fields["status"].annotation
    )
    assert create_status == list(STATUSES)
    create_schema = get_tool("create_application_track").parameters["properties"]["status"]
    assert create_schema["enum"] == create_status


def test_create_schema_keeps_legacy_descriptions_and_required():
    properties = get_tool("create_application_track").parameters["properties"]
    assert properties["company"]["description"] == "公司名称，必填"
    assert properties["title"]["description"] == "岗位名称，必填"
    assert properties["stage_note"]["description"] == "阶段补充，如二面/HR 面"
    assert properties["applied_at"]["description"] == "投递日期 YYYY-MM-DD"
    assert properties["evidence"]["description"] == "依据原文摘录"
    # 迁移前工具 schema 没有 channel；共用路由的 TrackCreate 后新增该字段（已记录差异）。
    assert "channel" in properties


def test_list_tool_default_and_limits_match_shared_constants():
    assert tracker_domain._DEFAULT_LIST_LIMIT == DEFAULT_LIST_LIMIT
    assert tracker_domain._MAX_LIST_LIMIT == MAX_LIST_LIMIT
    spec = _all_actions()["list_application_tracks"]
    assert spec.tool_defaults == (("limit", DEFAULT_LIST_LIMIT),)


def test_get_profile_schema_is_empty_object():
    schema = get_tool("get_profile").parameters
    assert schema["properties"] == {} and schema["required"] == []


def test_get_profile_route_returns_full_profile_and_tool_stays_masked(client, db_session):
    _seed_profile(client)

    response = client.get("/api/profile")
    assert response.status_code == 200
    body = response.json()
    # 路由仍是编辑视图全量（响应模型 ProfileOut 不变），且与既有投影逐字段一致。
    assert body == project_legacy_profile(db_session).model_dump(mode="json")
    assert body["name"] == "张三" and body["phone"] == "13800000000"
    assert body["educations"][0]["school"] == "示例大学"

    legacy = _tool_get_profile(db_session, {})
    result = execute_tool(db_session, "get_profile", {})
    assert (result.text, result.summary, result.link) == (
        legacy.text,
        legacy.summary,
        legacy.link,
    )
    # 默认脱敏：姓名/电话/邮箱不进模型上下文，照片二进制任何模式都不发送。
    for secret in ("张三", "13800000000", "zhangsan@example.com", "base64"):
        assert secret not in result.text
    assert result.changed is False


def test_get_profile_tool_follows_relaxed_mode(client, db_session):
    _seed_profile(client)
    assert "139" not in execute_tool(db_session, "get_profile", {}).text

    save_assistant_relaxed_mode(db_session, True)
    text = execute_tool(db_session, "get_profile", {}).text
    assert "张三" in text and "13800000000" in text and "zhangsan@example.com" in text
    # 放宽模式只影响工具（发给模型的上下文），路由响应不变。
    route = client.get("/api/profile").json()
    assert route["name"] == "张三" and route["phone"] == "13800000000"


def test_get_profile_route_ignores_unknown_query(client):
    _seed_profile(client)
    assert client.get("/api/profile", params={"bogus": 1}).status_code == 200


def test_list_tracks_route_and_tool_agree_on_same_rows_and_filters(client, db_session):
    _create_track(client, company="甲公司", title="后端", status="interview")
    _create_track(client, company="乙公司", title="算法", status="offer")
    _create_track(client, company="丙公司", title="运营", status="applied")

    route = client.get("/api/tracker")
    assert route.status_code == 200
    body = route.json()
    tool_payload = json.loads(execute_tool(db_session, "list_application_tracks", {}).text)
    assert body["total"] == tool_payload["总数"] == 3
    assert [item["id"] for item in body["items"]] == [
        item["id"] for item in tool_payload["求职进度"]
    ]
    assert body["offer_count"] == 1 and body["active_count"] == 2

    filtered_route = client.get("/api/tracker", params={"status": "interview"}).json()
    filtered_tool = json.loads(
        execute_tool(db_session, "list_application_tracks", {"status": "interview"}).text
    )
    assert filtered_route["total"] == filtered_tool["总数"] == 1
    assert filtered_route["items"][0]["company"] == "甲公司"
    assert filtered_tool["求职进度"][0]["company"] == "甲公司"

    keyword_route = client.get("/api/tracker", params={"keyword": "丙"}).json()
    keyword_tool = json.loads(
        execute_tool(db_session, "list_application_tracks", {"keyword": "丙"}).text
    )
    assert keyword_route["total"] == keyword_tool["总数"] == 1
    assert keyword_tool["求职进度"][0]["title"] == "运营"


def test_list_tool_limit_only_truncates_tool_text(client, db_session):
    for index, company in enumerate(("甲", "乙", "丙"), start=1):
        _create_track(client, company=f"{company}公司", title=f"岗位{index}")

    limited = json.loads(execute_tool(db_session, "list_application_tracks", {"limit": 1}).text)
    assert limited["总数"] == 3 and limited["返回"] == 1
    # 路由的主读路径不能被工具侧 limit 截断（limit 只影响给模型看多少条）。
    route = client.get("/api/tracker", params={"limit": 1})
    assert route.status_code == 200
    assert len(route.json()["items"]) == 3


def test_list_route_still_ignores_job_id_filter(client):
    """旧列表端点不认识 job_id（岗位深链只对 /page 与 /stats 生效）——行为不变。"""
    _create_track(client, company="甲公司", title="后端")
    response = client.get("/api/tracker", params={"job_id": 999999})
    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_get_track_route_and_tool_return_the_same_record(client, db_session):
    long_note = "很长的备注" * 100
    created = _create_track(client, company="详情公司", title="详情岗位", note=long_note)

    route = client.get(f"/api/tracker/{created['id']}")
    assert route.status_code == 200
    tool_payload = json.loads(
        execute_tool(db_session, "get_application_track", {"track_id": created["id"]}).text
    )
    body = route.json()
    assert body["id"] == tool_payload["id"] == created["id"]
    assert body["company"] == tool_payload["company"] == "详情公司"
    # 详情两端都返回全文（列表才截断）。
    assert body["note"] == tool_payload["note"] == long_note


def test_missing_track_uses_the_same_not_found_code(client, db_session):
    response = client.get("/api/tracker/999999")
    assert response.status_code == 404
    assert _route_error_code(response) == "not_found"
    error = _tool_error("get_application_track", {"track_id": 999999}, db_session)
    assert error.tool_error == "not_found"
    assert error.code == "not_found"


def test_create_track_route_and_tool_write_the_same_fields(client, db_session):
    route_payload = {**TRACK_CREATE_PAYLOAD, "company": "路由公司", "title": "路由岗位"}
    tool_payload = {**TRACK_CREATE_PAYLOAD, "company": "工具公司", "title": "工具岗位"}

    created = client.post("/api/tracker", json=route_payload)
    assert created.status_code == 201, created.text
    result = execute_tool(db_session, "create_application_track", dict(tool_payload))
    assert result.changed is True

    db_session.expire_all()
    route_row = db_session.get(ApplicationTrack, created.json()["id"])
    tool_row = db_session.get(ApplicationTrack, json.loads(result.text)["id"])
    assert route_row is not None and tool_row is not None
    columns = (
        "status",
        "stage_note",
        "applied_at",
        "status_date",
        "next_action",
        "next_action_date",
        "note",
        "evidence",
        "job_id",
        "resume_id",
        "channel",
        "source",
    )
    assert {column: getattr(route_row, column) for column in columns} == {
        column: getattr(tool_row, column) for column in columns
    }
    assert (route_row.company, route_row.title) == ("路由公司", "路由岗位")
    assert (tool_row.company, tool_row.title) == ("工具公司", "工具岗位")
    # 两条创建都写首个状态事件（单事务副作用：记录 + 事件 + 投递快照）。
    assert db_session.query(ApplicationTrackEvent).count() == 2


def test_create_track_missing_status_defaults_to_applied_on_both_sides(client, db_session):
    """已记录差异：旧工具缺 status 会报"未知的进度状态"；迁移后与路由一致取 applied。"""
    route = client.post("/api/tracker", json={"company": "默认路由", "title": "岗位"})
    assert route.status_code == 201
    assert route.json()["status"] == "applied"

    result = execute_tool(
        db_session, "create_application_track", {"company": "默认工具", "title": "岗位"}
    )
    assert result.changed is True
    db_session.expire_all()
    tool_row = db_session.get(ApplicationTrack, json.loads(result.text)["id"])
    assert tool_row is not None and tool_row.status == "applied"


def test_create_track_preview_matches_legacy(client, db_session):
    raw = {
        "company": "预览公司",
        "title": "预览岗位",
        "status": "offer",
        "note": "预览备注",
    }
    adapted = get_tool("create_application_track").preview(db_session, dict(raw))
    legacy = legacy_previews.preview_create_application_track(db_session, dict(raw))
    assert adapted is not None and legacy is not None
    assert adapted.model_dump() == legacy.model_dump()
    # 预览不写库。
    assert db_session.query(ApplicationTrack).count() == 0


# ----------------------------- 非法输入两侧同表 -----------------------------


def test_invalid_status_parity_across_route_and_tool(client, db_session):
    response = client.get("/api/tracker", params={"status": "不存在的状态"})
    assert response.status_code == 422
    assert _route_error_code(response) == "invalid_input"
    error = _tool_error("list_application_tracks", {"status": "不存在的状态"}, db_session)
    assert error.code == "invalid_input"


def test_create_invalid_input_parity_across_route_and_tool(client, db_session):
    empty_route = client.post("/api/tracker", json={})
    assert empty_route.status_code == 422
    assert _route_error_code(empty_route) == "invalid_input"
    assert _tool_error("create_application_track", {}, db_session).code == "invalid_input"

    partial_route = client.post("/api/tracker", json={"title": "只有岗位"})
    assert partial_route.status_code == 422
    assert _route_error_code(partial_route) == "invalid_input"
    assert (
        _tool_error("create_application_track", {"title": "只有岗位"}, db_session).code
        == "invalid_input"
    )


def test_migrated_route_error_shape_is_the_contract_shape(client):
    response = client.get("/api/tracker/999999")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert set(detail) == {"code", "message"}
    assert detail["code"] == "not_found"


def test_read_only_actions_do_not_write(client, db_session):
    _seed_profile(client)
    _create_track(client, company="只读公司", title="只读岗位")
    entries_before = db_session.query(ProfileEntry).count()
    tracks_before = db_session.query(ApplicationTrack).count()
    events_before = db_session.query(ApplicationTrackEvent).count()

    assert client.get("/api/profile").status_code == 200
    assert client.get("/api/tracker").status_code == 200
    track_id = db_session.query(ApplicationTrack.id).first()[0]
    assert client.get(f"/api/tracker/{track_id}").status_code == 200
    execute_tool(db_session, "get_profile", {})
    execute_tool(db_session, "list_application_tracks", {})
    execute_tool(db_session, "get_application_track", {"track_id": track_id})

    db_session.expire_all()
    assert db_session.query(ProfileEntry).count() == entries_before
    assert db_session.query(ApplicationTrack).count() == tracks_before
    assert db_session.query(ApplicationTrackEvent).count() == events_before


def test_legacy_update_tools_keep_read_modify_write_behavior(client, db_session):
    """跳过 update 两对的证据：它们仍按旧语义运行（只改传入字段，其余保留）。"""
    _seed_profile(client)
    execute_tool(db_session, "update_profile", {"city": "天津"})
    db_session.expire_all()
    snapshot = project_legacy_profile(db_session)
    assert snapshot.city == "天津"
    assert snapshot.name == "张三" and snapshot.phone == "13800000000"

    created = _create_track(client, company="保留公司", title="保留岗位", status="interview")
    execute_tool(
        db_session, "update_application_track", {"track_id": created["id"], "stage_note": "三面"}
    )
    db_session.expire_all()
    row = db_session.get(ApplicationTrack, created["id"])
    assert row is not None
    assert row.stage_note == "三面"
    assert row.company == "保留公司" and row.status == "interview"
