# SPDX-License-Identifier: Apache-2.0
"""T28 收尾批：core spec 剩余 4 对（旧实现委托范式）的契约测试。

迁移对：
- list_resumes              ↔ GET /api/resumes
- get_resume                ↔ GET /api/resumes/{resume_id}
- update_profile            ↔ PUT /api/profile（run/run_tool 分流：路由整份替换 / 工具读改写）
- update_application_track  ↔ PUT /api/tracker/{track_id}（同上）

逐对验证：action 已注册且 tool 的权限/路由与方法一致；spec.run 的 data 与真实路由 JSON
同构；run_tool 与 execute_tool 的 text/summary 一致；tool_fields 投影后模型看不到路由
专属字段；写对两侧既有语义各自保留（run_tool 真实被使用）；缺失 404 / 非法输入两侧
状态一致；只读动作不写库；preview 与旧实现一致。
"""

from __future__ import annotations

import json

import pytest
from app.database import get_db
from app.models.profile_entry import ProfileEntry
from app.models.resume import ResumeRecord
from app.models.tracker import ApplicationTrack
from app.services.actions import ActionError, get_action
from app.services.actions.catalog import all_actions
from app.services.actions.domains.profile import profile_actions
from app.services.actions.domains.resumes_read import resume_read_actions
from app.services.actions.domains.tracker import tracker_actions
from app.services.actions.route_adapter import as_route
from app.services.assistant_tools import execute_tool, get_tool
from app.services.assistant_tools import previews as legacy_previews
from app.services.assistant_tools.job_tools import (
    _tool_get_resume,
    _tool_list_resumes,
    _tool_update_profile,
)
from app.services.assistant_tools.tracker_tools import _tool_update_application_track
from app.services.profile.profile_service import project_legacy_profile
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

EXPECTED = {
    "list_resumes": ("GET", "/api/resumes", 200, "read_only"),
    "get_resume": ("GET", "/api/resumes/{resume_id}", 200, "read_only"),
    "update_profile": ("PUT", "/api/profile", 200, "reversible_write"),
    "update_application_track": ("PUT", "/api/tracker/{track_id}", 200, "reversible_write"),
}

PROFILE_PAYLOAD = {
    "name": "张三",
    "phone": "13800000000",
    "email": "zhangsan@example.com",
    "city": "北京",
    "summary": "三年后端开发经验",
    "educations": [{"school": "示例大学", "major": "软件工程"}],
}

TRACK_PUT_PAYLOAD = {
    "company": "路由公司",
    "title": "路由岗位",
    "status": "offer",
    "stage_note": "终面",
    "applied_at": "2026-09-18",
    "status_date": "2026-10-08",
    "next_action": "等 offer 邮件",
    "next_action_date": "2026-10-20",
    "note": "整份替换语义",
    "evidence": "邮件原文",
}


def _actions() -> dict:
    return {**resume_read_actions(), **profile_actions(), **tracker_actions()}


def _serialize(spec, outcome) -> dict:
    """把 run 返回的 ActionOutcome.data 按 http.response_model 序列化成路由 JSON 结构。"""
    adapter = TypeAdapter(spec.http.response_model)
    return json.loads(adapter.dump_json(adapter.validate_python(outcome.data)))


def _make_resume(db_session, title: str = "T28 收尾简历", **fields) -> ResumeRecord:
    record = ResumeRecord(title=title, **fields)
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _seed_profile(client, **overrides) -> dict:
    response = client.put("/api/profile", json={**PROFILE_PAYLOAD, **overrides})
    assert response.status_code == 200, response.text
    return response.json()


def _create_track(client, **overrides) -> dict:
    payload = {"company": "示例科技", "title": "后端开发", "status": "interview"}
    payload.update(overrides)
    response = client.post("/api/tracker", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _tool_error_code(name: str, arguments: dict, db_session) -> str:
    with pytest.raises(ActionError) as info:
        execute_tool(db_session, name, arguments)
    return info.value.tool_error


# ----------------------------- 注册与 schema -----------------------------


def test_core_actions_registered_with_expected_route():
    actions = _actions()
    for name, (method, path, status_code, permission) in EXPECTED.items():
        spec = actions[name]
        assert spec.http is not None, name
        assert (spec.http.method, spec.http.path) == (method, path), name
        assert spec.http.status_code == status_code, name
        assert spec.permission.value == permission, name
        assert get_action(name) is spec, name
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.permission is spec.permission, name
        assert tool.description == spec.description, name
        assert tool.service_entry == spec.service_entry, name
    catalog = all_actions()
    assert set(EXPECTED) <= set(catalog)


def test_domain_builders_are_idempotent_and_reentrant():
    """构建器幂等/可重入：assistant_tools 初始化期反向调用不会重复 define_action。"""
    for builder in (resume_read_actions, profile_actions, tracker_actions):
        assert builder() is builder()
    assert all(get_action(name) is not None for name in EXPECTED)


def test_tool_fields_hide_route_only_parameters():
    actions = _actions()
    nested = {
        "educations",
        "experiences",
        "campus_experiences",
        "projects",
        "skills",
        "awards",
    }
    profile_props = set(get_tool("update_profile").parameters["properties"])
    assert len(profile_props) == 11
    assert nested.isdisjoint(profile_props)
    assert {"name", "city", "summary"} <= profile_props
    assert set(actions["update_profile"].tool_fields or ()) == profile_props
    assert nested.isdisjoint(set(actions["update_profile"].tool_fields or ()))

    track_props = set(get_tool("update_application_track").parameters["properties"])
    assert len(track_props) == 13 and "channel" not in track_props
    assert {"track_id", "status", "stage_note"} <= track_props

    assert set(get_tool("list_resumes").parameters["properties"]) == {"limit"}
    assert set(get_tool("get_resume").parameters["properties"]) == {"resume_id"}


# ----------------------------- list_resumes / get_resume -----------------------------


def test_list_resumes_route_and_action_data_agree(client, db_session):
    _make_resume(db_session, "后端简历", company="示例科技", job_title="后端开发")
    _make_resume(db_session, "运营简历", favorite=True)
    spec = _actions()["list_resumes"]
    route = client.get("/api/resumes")
    assert route.status_code == 200
    outcome = spec.run(db_session, spec.input_model())
    assert _serialize(spec, outcome) == route.json()


def test_list_resumes_tool_keeps_its_own_limit_and_text(client, db_session):
    for index in range(3):
        _make_resume(db_session, f"简历-{index}")
    legacy = _tool_list_resumes(db_session, {})
    result = execute_tool(db_session, "list_resumes", {})
    assert (result.text, result.summary, result.link) == (
        legacy.text,
        legacy.summary,
        legacy.link,
    )
    limited = json.loads(execute_tool(db_session, "list_resumes", {"limit": 1}).text)
    assert len(limited["简历"]) == 1
    # 路由主读路径不受工具 limit 影响。
    assert len(client.get("/api/resumes").json()["items"]) == 3


def test_get_resume_route_and_action_data_agree(client, db_session):
    record = _make_resume(db_session, "详情简历", company="示例科技", job_title="后端")
    spec = _actions()["get_resume"]
    route = client.get(f"/api/resumes/{record.id}")
    assert route.status_code == 200
    outcome = spec.run(db_session, spec.input_model(resume_id=record.id))
    assert _serialize(spec, outcome) == route.json()


def test_get_resume_tool_text_matches_legacy_handler(db_session):
    record = _make_resume(
        db_session,
        "工具读简历",
        content={"photo": "data:image/png;base64,xx", "education": []},
        warnings=["一处待核对"],
    )
    legacy = _tool_get_resume(db_session, {"resume_id": record.id})
    result = execute_tool(db_session, "get_resume", {"resume_id": record.id})
    assert (result.text, result.summary, result.link) == (
        legacy.text,
        legacy.summary,
        legacy.link,
    )
    assert "base64" not in result.text and "一处待核对" in result.text


def test_missing_resume_is_404_on_route_and_same_http_error_from_run(client, db_session):
    spec = _actions()["get_resume"]
    assert client.get("/api/resumes/999999").status_code == 404
    with pytest.raises(HTTPException) as info:
        spec.run(db_session, spec.input_model(resume_id=999999))
    assert info.value.status_code == 404
    with pytest.raises(ValueError, match="不存在"):
        execute_tool(db_session, "get_resume", {"resume_id": 999999})


# ----------------------------- update_profile -----------------------------


def test_update_profile_route_and_action_data_agree(client, db_session):
    _seed_profile(client)
    spec = _actions()["update_profile"]
    outcome = spec.run(db_session, spec.input_model(city="上海"))
    route = client.put("/api/profile", json={"city": "上海"})
    assert route.status_code == 200
    assert _serialize(spec, outcome) == route.json()
    db_session.expire_all()
    assert project_legacy_profile(db_session).city == "上海"
    assert project_legacy_profile(db_session).name == ""  # 路由整份替换：未传字段回默认


def test_update_profile_route_replaces_while_tool_merges(client, db_session):
    _seed_profile(client)
    spec = _actions()["update_profile"]
    # 工具侧走 run_tool（旧 read-modify-write）：未传字段必须保留。
    outcome = spec.run_tool(db_session, spec.input_model(city="天津"))
    result = execute_tool(db_session, "update_profile", {"city": "天津"})
    assert (outcome.text, outcome.summary, outcome.changed) == (
        result.text,
        result.summary,
        result.changed,
    )
    legacy = _tool_update_profile(db_session, {"city": "天津"})
    assert (result.text, result.summary) == (legacy.text, legacy.summary)
    db_session.expire_all()
    snapshot = project_legacy_profile(db_session)
    assert snapshot.city == "天津"
    assert snapshot.name == "张三" and snapshot.phone == "13800000000"
    assert [item.school for item in snapshot.educations] == ["示例大学"]


def test_update_profile_tool_ignores_nested_entries_like_legacy(client, db_session):
    _seed_profile(client)
    execute_tool(db_session, "update_profile", {"educations": [], "city": "上海"})
    db_session.expire_all()
    snapshot = project_legacy_profile(db_session)
    assert snapshot.city == "上海"
    assert [item.school for item in snapshot.educations] == ["示例大学"]


def test_update_profile_preview_matches_legacy(client, db_session):
    _seed_profile(client)
    tool = get_tool("update_profile")
    arguments = {"city": "预览城市", "summary": "预览总结"}
    actual = tool.preview(db_session, dict(arguments))
    expected = legacy_previews.preview_update_profile(db_session, dict(arguments))
    assert actual is not None and expected is not None
    assert actual.model_dump() == expected.model_dump()


# ----------------------------- update_application_track -----------------------------


def test_update_track_route_and_action_write_same_fields(client, db_session):
    created = _create_track(client, company="路由起点", title="后端")
    spec = _actions()["update_application_track"]
    route_payload = dict(TRACK_PUT_PAYLOAD)
    route = client.put(f"/api/tracker/{created['id']}", json=route_payload)
    assert route.status_code == 200, route.text
    # 同一行、同一份入参再走一次 action.run：路由与契约层委托的是同一个 handler。
    outcome = spec.run(db_session, spec.input_model(track_id=created["id"], **route_payload))
    serialized = _serialize(spec, outcome)
    assert set(serialized) == set(route.json())
    fields = (
        "company",
        "title",
        "status",
        "stage_note",
        "applied_at",
        "status_date",
        "next_action",
        "next_action_date",
        "note",
        "evidence",
        "channel",
    )
    assert {key: serialized[key] for key in fields} == {key: route.json()[key] for key in fields}
    db_session.expire_all()
    row = db_session.get(ApplicationTrack, created["id"])
    assert (row.company, row.title, row.status, row.stage_note) == (
        "路由公司",
        "路由岗位",
        "offer",
        "终面",
    )


def test_update_track_route_replaces_while_tool_merges(client, db_session):
    created = _create_track(
        client, company="保留公司", title="保留岗位", status="interview", note="旧备注"
    )
    spec = _actions()["update_application_track"]
    # 工具侧 run_tool（旧 read-modify-write）：只改传入字段，其余保留。
    outcome = spec.run_tool(db_session, spec.input_model(track_id=created["id"], stage_note="三面"))
    result = execute_tool(
        db_session, "update_application_track", {"track_id": created["id"], "stage_note": "三面"}
    )
    assert (outcome.text, outcome.summary, outcome.changed) == (
        result.text,
        result.summary,
        result.changed,
    )
    legacy = _tool_update_application_track(
        db_session, {"track_id": created["id"], "stage_note": "三面"}
    )
    assert (result.text, result.summary) == (legacy.text, legacy.summary)
    db_session.expire_all()
    row = db_session.get(ApplicationTrack, created["id"])
    assert (row.company, row.title, row.status, row.stage_note) == (
        "保留公司",
        "保留岗位",
        "interview",
        "三面",
    )
    # 路由侧仍是整份替换：只传 company/title/status 时其余字段回默认值。
    replaced = client.put(
        f"/api/tracker/{created['id']}",
        json={"company": "保留公司", "title": "保留岗位", "status": "applied"},
    )
    assert replaced.status_code == 200
    assert replaced.json()["stage_note"] == "" and replaced.json()["note"] == ""


def test_update_track_preview_matches_legacy(client, db_session):
    created = _create_track(client, company="预览公司", title="预览岗位")
    tool = get_tool("update_application_track")
    arguments = {"track_id": created["id"], "stage_note": "预览三面"}
    actual = tool.preview(db_session, dict(arguments))
    expected = legacy_previews.preview_update_application_track(db_session, dict(arguments))
    assert actual is not None and expected is not None
    assert actual.model_dump() == expected.model_dump()


def test_missing_track_is_404_on_route_and_same_http_error_from_run(client, db_session):
    spec = _actions()["update_application_track"]
    payload = {"company": "不存在", "title": "岗位"}
    assert client.put("/api/tracker/999999", json=payload).status_code == 404
    with pytest.raises(HTTPException) as info:
        spec.run(db_session, spec.input_model(track_id=999999, **payload))
    assert info.value.status_code == 404
    with pytest.raises(ValueError, match="不存在"):
        execute_tool(db_session, "update_application_track", {"track_id": 999999, **payload})


# ----------------------------- 非法输入与字段投影 -----------------------------


def test_tool_fields_strip_route_only_arguments_like_legacy(client, db_session):
    """tool_fields 投影外的入参按旧工具语义剥离（不是报错）。"""
    _make_resume(db_session, "剥离校验简历")
    assert (
        execute_tool(db_session, "list_resumes", {"keyword": "x"}).text
        == _tool_list_resumes(db_session, {}).text
    )
    record = db_session.query(ResumeRecord).first()
    legacy = _tool_get_resume(db_session, {"resume_id": record.id})
    stripped = execute_tool(db_session, "get_resume", {"resume_id": record.id, "bogus": 1})
    assert stripped.text == legacy.text
    # 工具只接收基础资料字段：只给路由专属字段时与旧工具一样报"没有可修改字段"。
    with pytest.raises(ValueError, match="没有给出可修改的资料字段"):
        execute_tool(db_session, "update_profile", {"wechat": "wx-id"})
    created = _create_track(client, company="渠道公司", title="渠道岗位")
    execute_tool(
        db_session,
        "update_application_track",
        {"track_id": created["id"], "channel": "referral", "stage_note": "渠道忽略"},
    )
    db_session.expire_all()
    row = db_session.get(ApplicationTrack, created["id"])
    assert row is not None
    assert (row.channel, row.stage_note) == ("unknown", "渠道忽略")


def test_invalid_input_is_contract_error(client, db_session):
    # schema 级非法输入：路由 422 与工具契约层 invalid_input 同状态。
    assert _tool_error_code("get_resume", {}, db_session) == "invalid_input"
    assert _tool_error_code("update_profile", {"name": 123}, db_session) == "invalid_input"
    assert _tool_error_code("get_resume", {"resume_id": "abc"}, db_session) == "invalid_input"
    assert client.get("/api/resumes/abc").status_code == 422
    bad_profile = client.put("/api/profile", json={"photo": "not-a-data-url"})
    assert bad_profile.status_code == 422
    # 路由整份替换缺公司/岗位：422；同输入走 run 也映射成 invalid_input（旧行为 422）。
    created = _create_track(client, company="缺字段公司", title="缺字段岗位")
    assert client.put(f"/api/tracker/{created['id']}", json={"stage_note": "x"}).status_code == 422
    spec = _actions()["update_application_track"]
    with pytest.raises(ActionError) as info:
        spec.run(db_session, spec.input_model(track_id=created["id"], stage_note="x"))
    assert info.value.tool_error == "invalid_input"


def test_read_only_actions_do_not_write(client, db_session):
    record = _make_resume(db_session, "只读简历")
    _seed_profile(client)
    before = db_session.query(ResumeRecord).count(), db_session.query(ProfileEntry).count()
    spec = _actions()["list_resumes"]
    spec.run(db_session, spec.input_model())
    spec.run(db_session, spec.input_model(limit=1))
    get_spec = _actions()["get_resume"]
    get_spec.run(db_session, get_spec.input_model(resume_id=record.id))
    execute_tool(db_session, "list_resumes", {})
    execute_tool(db_session, "get_resume", {"resume_id": record.id})
    db_session.expire_all()
    after = db_session.query(ResumeRecord).count(), db_session.query(ProfileEntry).count()
    assert before == after


# ----------------------------- 切换就绪：生成路由与既有路由同构 -----------------------------


def _generated_client(spec, db_session) -> TestClient:
    """用契约层 as_route 生成一条路由（等价于 Lead 切换脚本的产物）。"""
    application = FastAPI()
    application.include_router(as_route(spec))
    application.dependency_overrides[get_db] = lambda: db_session
    return TestClient(application)


def test_generated_routes_are_switch_ready(client, db_session):
    """切换脚本把装饰器换成 add_action_route 后，生成路由必须与旧路由同构。"""
    _make_resume(db_session, "切换简历", company="示例科技")
    actions = _actions()
    # GET 列表 / 详情：query、路径参数与响应体逐字段一致。
    generated = _generated_client(actions["list_resumes"], db_session)
    assert generated.get("/api/resumes").json() == client.get("/api/resumes").json()
    record = db_session.query(ResumeRecord).first()
    generated = _generated_client(actions["get_resume"], db_session)
    assert generated.get(f"/api/resumes/{record.id}").json() == (
        client.get(f"/api/resumes/{record.id}").json()
    )
    # GET 详情缺失：404 由既有 handler 抛 HTTPException，状态保持。
    assert generated.get("/api/resumes/999999").status_code == 404
    # PUT /api/profile 生成路由：整份替换语义与既有路由的响应一致。
    _seed_profile(client)
    generated = _generated_client(actions["update_profile"], db_session)
    switched = generated.put("/api/profile", json={"city": "杭州"})
    assert switched.status_code == 200, switched.text
    assert switched.json() == client.put("/api/profile", json={"city": "杭州"}).json()
    # PUT /api/tracker/{id} 生成路由：整份替换，字段落库与旧路由一致。
    created = _create_track(client, company="切换公司", title="切换岗位")
    generated = _generated_client(actions["update_application_track"], db_session)
    switched = generated.put(f"/api/tracker/{created['id']}", json=dict(TRACK_PUT_PAYLOAD))
    assert switched.status_code == 200, switched.text
    body = switched.json()
    assert (body["company"], body["title"], body["status"]) == ("路由公司", "路由岗位", "offer")
    # 缺公司/岗位的整份替换：生成路由 422（旧路由同为 422）。
    assert generated.put(f"/api/tracker/{created['id']}", json={"note": "x"}).status_code == 422
