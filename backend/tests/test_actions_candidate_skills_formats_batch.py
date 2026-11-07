# SPDX-License-Identifier: Apache-2.0
"""T28 收尾批：备选岗位 / 助手技能 / 版式 10 对「路由 + 工具」奇偶校验。

覆盖（迁移对 ↔ 旧实现）：

- candidate_jobs：list / get / create / update / import（import 路由与工具语义不同：
  路由只标记已导入、工具会自建岗位，用 run_tool 分流）
- skills：list / get / create（update_skill 是 T27 试点，另有守卫）
- format_templates：list / create（update 因「路由必填 template_id vs 工具允许按名定位」
  无法用同一 input_model 表达，本批跳过、保留静态声明）

每个 pair 至少核对：注册与权限/http 元数据、spec.run 与旧路由 JSON/DB 行一致、
run_tool 与旧 handler 文案一致、缺对象 404 同码、非法输入 422 同码、tool_fields 投影、
preview 与旧 previews 一致。
"""

from __future__ import annotations

import json

import pytest
from app import database
from app.models.assistant import AssistantSkill
from app.models.material import CandidateJob
from app.models.resume_template import ResumeTemplate
from app.services.actions import ActionError, action_names, get_action, validate_input
from app.services.assistant_tools import execute_tool, get_tool, previews
from app.services.assistant_tools.data_tools import candidate_jobs as candidate_handlers
from app.services.assistant_tools.data_tools import format_templates as format_handlers
from app.services.assistant_tools.data_tools import skills as skill_handlers
from pydantic import BaseModel

# ===== 注册与 http 元数据（逐对钉住）=====


def _has_chinese(text: str) -> bool:
    """文案里有没有中文（Pydantic 内置英文原句没有，中文化后的文案一定有）。"""
    return any("\u4e00" <= char <= "\u9fff" for char in str(text or ""))


EXPECTED_PAIRS = {
    "list_candidate_jobs": ("GET", "/api/candidate-jobs", 200, "READ_ONLY"),
    "get_candidate_job": ("GET", "/api/candidate-jobs/{candidate_id}", 200, "READ_ONLY"),
    "create_candidate_job": ("POST", "/api/candidate-jobs", 201, "REVERSIBLE_WRITE"),
    "update_candidate_job": ("PUT", "/api/candidate-jobs/{candidate_id}", 200, "REVERSIBLE_WRITE"),
    "import_candidate_job": (
        "POST",
        "/api/candidate-jobs/{candidate_id}/imported",
        200,
        "REVERSIBLE_WRITE",
    ),
    "list_skills": ("GET", "/api/assistant/skills", 200, "READ_ONLY"),
    "get_skill": ("GET", "/api/assistant/skills/{skill_id}", 200, "READ_ONLY"),
    "create_skill": ("POST", "/api/assistant/skills", 201, "REVERSIBLE_WRITE"),
    "list_format_templates": ("GET", "/api/resume-templates", 200, "READ_ONLY"),
    "create_format_template": ("POST", "/api/resume-templates", 201, "REVERSIBLE_WRITE"),
}

# tool_fields 投影：这些路由专属字段不得出现在工具 schema 里（模型看不到/传不进）。
ROUTE_ONLY_FIELDS = {
    "list_candidate_jobs": {"collect_task_id", "collect_task_ids"},
    "create_candidate_job": {"location", "salary", "images", "source", "source_url"},
    "import_candidate_job": {"job_id"},
    "list_skills": set(),
    "list_format_templates": {"kind"},
    "create_format_template": {"kind", "html", "config", "source_name"},
}


def _spec(name: str):
    action = get_action(name)
    assert action is not None, f"action {name} 没有注册"
    return action


def _jsonable(value):
    """把 ActionOutcome.data（pydantic 模型 / 列表）转成与 client JSON 可比较的结构。"""
    if isinstance(value, BaseModel):
        return json.loads(value.model_dump_json())
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    return value


def _route_error_code(response) -> str:
    """旧路由 detail 是字符串；迁移后的契约路由 detail 是 {code,message}——两种都认。"""
    detail = response.json().get("detail")
    if isinstance(detail, dict):
        return str(detail.get("code") or "")
    return ""


def _run_action(name: str, payload: dict):
    action = _spec(name)
    model = action.input_model.model_validate(payload)
    with database.SessionLocal() as session:
        return action.run(session, model)


def _candidate_json(row: CandidateJob) -> dict:
    return {
        "title": row.title,
        "company": row.company,
        "raw_text": row.raw_text,
        "note": row.note,
        "source": row.source,
        "status": row.status,
        "imported_job_id": row.imported_job_id,
    }


def test_pairs_are_registered_with_expected_http_and_tool_metadata():
    names = set(action_names())
    for name, (method, path, status, permission) in EXPECTED_PAIRS.items():
        assert name in names
        action = _spec(name)
        assert (action.http.method, action.http.path, action.http.status_code) == (
            method,
            path,
            status,
        )
        tool = get_tool(name)
        assert tool is not None
        assert tool.handler.__module__.endswith(".actions.tool_adapter"), f"{name} 未走 as_tool"
        assert tool.permission is action.permission
        assert tool.permission.name == permission
    # 跳过的 update_format_template：仍是静态 Tool 声明，不是 action。
    assert "update_format_template" not in names
    skipped = get_tool("update_format_template")
    assert skipped is not None and skipped.handler is format_handlers._tool_update_format_template


@pytest.mark.parametrize("name", sorted(ROUTE_ONLY_FIELDS))
def test_route_only_fields_are_projected_out_of_tool_schema(name: str):
    tool = get_tool(name)
    assert tool is not None
    properties = set(tool.parameters["properties"])
    for field in ROUTE_ONLY_FIELDS[name]:
        assert field not in properties, f"{name} 的工具 schema 泄漏了路由专属字段 {field}"
    # 投影后的 required 必须与 input_model 中保留下来的必填字段一致。
    action = _spec(name)
    kept = set(properties)
    expected_required = [
        field_name
        for field_name, model_field in action.input_model.model_fields.items()
        if field_name in kept and model_field.is_required()
    ]
    assert tool.parameters["required"] == expected_required


# ===== 数据准备 =====


def _create_candidate(client, **overrides) -> int:
    payload = {"title": "后端开发工程师", "company": "示例科技", "raw_text": "负责服务端开发。"}
    payload.update(overrides)
    response = client.post("/api/candidate-jobs", json=payload)
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


@pytest.fixture()
def candidate_id(client) -> int:
    return _create_candidate(client)


@pytest.fixture()
def job_id(client) -> int:
    response = client.post("/api/jobs", json={"title": "后端开发工程师", "company": "示例科技"})
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


# ===== candidate jobs：list / get =====


def test_candidate_list_and_get_match_old_routes(client, candidate_id):
    _create_candidate(client, title="备选二", company="示例二号")
    list_action = _run_action("list_candidate_jobs", {})
    list_route = client.get("/api/candidate-jobs")
    assert list_route.status_code == 200
    assert _jsonable(list_action.data) == list_route.json()
    get_action_data = _run_action("get_candidate_job", {"candidate_id": candidate_id})
    get_route = client.get(f"/api/candidate-jobs/{candidate_id}")
    assert get_route.status_code == 200
    assert _jsonable(get_action_data.data) == get_route.json()


# ===== candidate jobs：create / update =====


def test_candidate_create_action_and_route_write_the_same_row(client):
    payload = {
        "title": "数据分析师",
        "company": "示例数据",
        "raw_text": "负责业务数据分析。",
        "note": "内推",
    }
    action_outcome = _run_action("create_candidate_job", payload)
    route = client.post("/api/candidate-jobs", json=payload)
    assert route.status_code == 201
    with database.SessionLocal() as session:
        action_row = session.get(CandidateJob, int(action_outcome.data.id))
        route_row = session.get(CandidateJob, int(route.json()["id"]))
        assert action_row is not None and route_row is not None
        assert _candidate_json(action_row) == _candidate_json(route_row)


def test_candidate_update_action_and_route_write_the_same_row(client):
    first = _create_candidate(client)
    second = _create_candidate(client)
    payload = {"title": "更新后的岗位", "note": "已修改"}
    _run_action("update_candidate_job", {"candidate_id": first, **payload})
    route = client.put(f"/api/candidate-jobs/{second}", json=payload)
    assert route.status_code == 200
    with database.SessionLocal() as session:
        first_row = session.get(CandidateJob, first)
        second_row = session.get(CandidateJob, second)
        assert first_row is not None and second_row is not None
        assert _candidate_json(first_row) == _candidate_json(second_row)
        assert first_row.title == "更新后的岗位"


# ===== candidate jobs：import（路由与工具语义不同）=====


def test_candidate_import_route_marks_imported_and_tool_creates_job(client, db_session, job_id):
    route_candidate = _create_candidate(client, title="路由导入候选")
    route = client.post(f"/api/candidate-jobs/{route_candidate}/imported", json={"job_id": job_id})
    assert route.status_code == 200, route.text
    assert route.json()["status"] == "imported"
    assert route.json()["imported_job_id"] == job_id
    action_candidate = _create_candidate(client, title="action 导入候选")
    action_data = _run_action(
        "import_candidate_job", {"candidate_id": action_candidate, "job_id": job_id}
    )
    assert _jsonable(action_data.data)["status"] == "imported"
    # 工具侧旧语义：自己建正式岗位并回填，不需要 job_id。
    tool_candidate = _create_candidate(client, title="工具导入候选")
    result = execute_tool(
        db_session,
        "import_candidate_job",
        {"candidate_id": tool_candidate, "company": "工具侧公司"},
    )
    assert "把备选岗位导入成正式岗位" in result.summary
    assert json.loads(result.text)["job_id"] > 0


# ===== 缺对象 / 非法输入：两侧同码 =====


def test_missing_objects_have_parity(client):
    cases = [
        ("get_candidate_job", {"candidate_id": 999_999}, "/api/candidate-jobs/999999"),
        ("update_candidate_job", {"candidate_id": 999_999, "title": "x"}, None),
        ("get_skill", {"skill_id": 999_999}, "/api/assistant/skills/999999"),
    ]
    for name, payload, route in cases:
        with pytest.raises(ActionError) as info:
            _run_action(name, payload)
        assert info.value.code == "not_found"
        assert info.value.http_status == 404
        if route is not None:
            response = client.get(route)
            assert response.status_code == 404
            assert _route_error_code(response) in ("", "not_found")


def test_invalid_input_has_parity(client):
    # schema 级非法输入：路由 422，action 侧 validate_input 抛 invalid_input（也是 422 码）。
    cases = [
        ("create_candidate_job", {}, "/api/candidate-jobs", "post"),
        ("create_skill", {}, "/api/assistant/skills", "post"),
        ("create_format_template", {}, "/api/resume-templates", "post"),
    ]
    for name, payload, route, method in cases:
        action = _spec(name)
        with pytest.raises(ActionError) as info:
            validate_input(action, payload)
        assert info.value.code == "invalid_input"
        assert info.value.http_status == 422
        # R05：文案中文（与全局 422 handler 同一张表），不再是 Pydantic 英文原句。
        # 自定义校验器写的中文原句也算中文，所以这里只钉"有中文 + 无英文原句"。
        assert _has_chinese(info.value.message), info.value.message
        assert "Field required" not in info.value.message, info.value.message
        response = getattr(client, method)(route, json=payload)
        assert response.status_code == 422
        route_message = str(response.json()["detail"]["message"])
        assert _has_chinese(route_message), route_message
        assert "Field required" not in route_message, route_message
        assert route_message == info.value.message
    # 路由专属字段被显式传入时，action 侧也拒绝（旧路由原是 extra=forbid 的 422）。
    with pytest.raises(ActionError) as info:
        _run_action("import_candidate_job", {"candidate_id": 1, "title": "只属于工具"})
    assert info.value.code == "invalid_input"
    with pytest.raises(ActionError) as info:
        _run_action("import_candidate_job", {"candidate_id": 1})
    assert info.value.code == "invalid_input"


# ===== skills：list / get / create =====


def _create_skill(client, name: str = "示例技能") -> int:
    response = client.post(
        "/api/assistant/skills",
        json={"name": name, "prompt": "回答时先给结论，再给依据。"},
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def test_skill_list_and_get_match_old_routes(client):
    skill_id = _create_skill(client)
    list_action = _run_action("list_skills", {})
    list_route = client.get("/api/assistant/skills")
    assert list_route.status_code == 200
    assert _jsonable(list_action.data) == list_route.json()
    get_action_data = _run_action("get_skill", {"skill_id": skill_id})
    get_route = client.get(f"/api/assistant/skills/{skill_id}")
    assert get_route.status_code == 200
    assert _jsonable(get_action_data.data) == get_route.json()


def test_skill_create_action_and_route_write_the_same_row(client):
    action_payload = {
        "name": "面试复盘技能-action",
        "description": "复盘用",
        "prompt": "按 STARR 组织回答。",
    }
    route_payload = {
        "name": "面试复盘技能-route",
        "description": "复盘用",
        "prompt": "按 STARR 组织回答。",
    }
    action_outcome = _run_action("create_skill", action_payload)
    route = client.post("/api/assistant/skills", json=route_payload)
    assert route.status_code == 201
    with database.SessionLocal() as session:
        action_row = session.get(AssistantSkill, int(action_outcome.data.id))
        route_row = session.get(AssistantSkill, int(route.json()["id"]))
        assert action_row is not None and route_row is not None
        for field in ("description", "prompt", "enabled"):
            assert getattr(action_row, field) == getattr(route_row, field)


# ===== 版式：list / create =====


def _create_format(client, name: str = "示例版式") -> int:
    response = client.post(
        "/api/resume-templates",
        json={"name": name, "kind": "format", "config": {"line_height": 1.5}},
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def test_format_list_matches_old_route(client):
    _create_format(client)
    action_data = _run_action("list_format_templates", {})
    route = client.get("/api/resume-templates")
    assert route.status_code == 200
    assert _jsonable(action_data.data) == route.json()


def test_format_create_action_and_route_write_the_same_row(client):
    action_payload = {
        "name": "紧凑版式-action",
        "kind": "format",
        "description": "一页装下",
        "config": {"line_height": 1.3},
    }
    route_payload = {
        "name": "紧凑版式-route",
        "kind": "format",
        "description": "一页装下",
        "config": {"line_height": 1.3},
    }
    action_outcome = _run_action("create_format_template", action_payload)
    route = client.post("/api/resume-templates", json=route_payload)
    assert route.status_code == 201
    with database.SessionLocal() as session:
        action_row = session.get(ResumeTemplate, int(action_outcome.data.id))
        route_row = session.get(ResumeTemplate, int(route.json()["id"]))
        assert action_row is not None and route_row is not None
        for field in ("kind", "description", "config"):
            assert getattr(action_row, field) == getattr(route_row, field)
    # kind=style 已下线：两侧都是 400 / invalid_request。
    with pytest.raises(ActionError) as info:
        _run_action("create_format_template", {"name": "旧模板", "kind": "style"})
    assert (info.value.code, info.value.http_status) == ("invalid_request", 400)
    response = client.post(
        "/api/resume-templates", json={"name": "旧模板二", "kind": "style", "html": "<html></html>"}
    )
    assert response.status_code == 400


# ===== run_tool 与旧 handler 文案一致 =====


def test_read_tools_text_and_summary_match_legacy_handlers(client, candidate_id, db_session):
    skill_id = _create_skill(client)
    _create_format(client)
    cases = [
        ("list_candidate_jobs", {}, candidate_handlers._tool_list_candidate_jobs),
        (
            "get_candidate_job",
            {"candidate_id": candidate_id},
            candidate_handlers._tool_get_candidate_job,
        ),
        ("list_skills", {}, skill_handlers._tool_list_skills),
        ("get_skill", {"skill_id": skill_id}, skill_handlers._tool_get_skill),
        (
            "list_format_templates",
            {},
            format_handlers._tool_list_format_templates,
        ),
    ]
    for name, arguments, legacy in cases:
        adapted = execute_tool(db_session, name, dict(arguments))
        direct = legacy(db_session, dict(arguments))
        assert (adapted.text, adapted.summary, adapted.link) == (
            direct.text,
            direct.summary,
            direct.link,
        )
        assert adapted.changed is direct.changed


def test_write_tool_summaries_match_legacy_handlers(db_session):
    candidate_arguments = {"title": "工具侧候选", "company": "示例公司"}
    adapted = execute_tool(db_session, "create_candidate_job", dict(candidate_arguments))
    direct = candidate_handlers._tool_create_candidate_job(db_session, dict(candidate_arguments))
    assert (adapted.summary, adapted.changed) == (direct.summary, direct.changed)
    adapted = execute_tool(
        db_session, "create_skill", {"name": "工具侧技能-a", "prompt": "按要点回答。"}
    )
    direct = skill_handlers._tool_create_skill(
        db_session, {"name": "工具侧技能-b", "prompt": "按要点回答。"}
    )
    assert adapted.summary.replace("技能-a", "技能") == direct.summary.replace("技能-b", "技能")
    assert adapted.changed is direct.changed
    adapted = execute_tool(
        db_session, "create_format_template", {"name": "工具侧版式-a", "line_height": 1.4}
    )
    direct = format_handlers._tool_create_format_template(
        db_session, {"name": "工具侧版式-b", "line_height": 1.4}
    )
    assert adapted.summary.replace("版式-a", "版式") == direct.summary.replace("版式-b", "版式")
    assert adapted.changed is direct.changed


# ===== preview 与旧 previews 一致 =====


def test_previews_match_legacy_previews(db_session):
    candidate_preview = execute_tool(db_session, "create_candidate_job", {"title": "预览候选"})
    assert candidate_preview.changed is True
    tool = get_tool("create_candidate_job")
    assert tool is not None and tool.preview is not None
    arguments = {"title": "预览候选", "company": "示例公司", "raw_text": "原文"}
    assert (
        tool.preview(db_session, dict(arguments)).model_dump()
        == previews.preview_create_candidate_job(db_session, dict(arguments)).model_dump()
    )
    skill_tool = get_tool("create_skill")
    assert skill_tool is not None and skill_tool.preview is not None
    skill_arguments = {"name": "预览技能", "prompt": "按要点回答。"}
    assert skill_tool.preview(db_session, dict(skill_arguments)).model_dump() == (
        previews.preview_create_skill(db_session, dict(skill_arguments)).model_dump()
    )
    format_tool = get_tool("create_format_template")
    assert format_tool is not None and format_tool.preview is not None
    format_arguments = {"name": "预览版式", "line_height": 1.5}
    assert format_tool.preview(db_session, dict(format_arguments)).model_dump() == (
        previews.preview_create_format_template(db_session, dict(format_arguments)).model_dump()
    )


# ===== 工具描述里的上限数字与 _shared 常量一致 =====


def test_skill_tool_description_limits_match_shared_constants():
    from app.services.assistant_tools._shared import (
        MAX_ASSISTANT_SKILL_FILE_CHARS,
        MAX_ASSISTANT_SKILL_FILES,
        MAX_ASSISTANT_SKILL_TOTAL_CHARS,
    )

    tool = get_tool("create_skill")
    assert tool is not None
    assert f"最多 {MAX_ASSISTANT_SKILL_FILES} 个文件" in tool.description
    assert f"单文件不超过 {MAX_ASSISTANT_SKILL_FILE_CHARS} 字符" in tool.description
    assert f"合计不超过 {MAX_ASSISTANT_SKILL_TOTAL_CHARS} 字符" in tool.description
