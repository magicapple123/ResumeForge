# SPDX-License-Identifier: Apache-2.0
"""T28 收尾批：report spec 剩余 11 对（旧实现委托范式）的契约测试。

迁移原则：run 委托既有路由 handler、run_tool 委托既有工具 handler、preview 委托既有
preview 实现（零业务逻辑复制）。本文件逐对验证：
- action 注册且 tool.permission / http.method / http.path / status / response_model 一致；
- spec.run(db, input_model(**参数)) 的数据与 client 调原路由的 JSON 响应一致；
- run_tool 的 text/summary 与 execute_tool 一致；
- tool_fields 投影：模型看不到/传不进路由专属字段；
- 缺失对象：路由 404，spec.run 因委托路由 handler 抛同状态 HTTPException（零漂移）；
- 非法输入：execute_tool 走契约层 → ActionError invalid_input；
- 只读动作不写库；update_resume_layout 的 preview 与旧 preview 一致。

未迁移（按规则跳过）：update_resume。工具只改 favorite/note，对应路由是两个独立端点
（PATCH /api/resumes/{id}/favorite 与 /note），而 PATCH /api/resumes/{resume_id} 实际是
改名（title 必填），无法用同一 input_model + 单个 http 安全表达。
"""

from __future__ import annotations

import json

import pytest
from app.models.drill import DrillSession
from app.models.interview import InterviewSession
from app.models.resume import ResumeRecord
from app.services.actions import ActionError
from app.services.actions.domains.analytics import analytics_actions
from app.services.actions.domains.apply import apply_actions
from app.services.actions.domains.drill import drill_actions
from app.services.actions.domains.interview import interview_actions
from app.services.actions.domains.question_banks import question_bank_actions
from app.services.actions.domains.resumes_write import resumes_write_actions
from app.services.actions.domains.reviews import review_actions
from app.services.actions.domains.share_packages import share_package_actions
from app.services.assistant_tools import execute_tool, get_tool
from app.services.assistant_tools import previews as legacy_previews
from fastapi import HTTPException
from pydantic import TypeAdapter

EXPECTED = {
    "list_apply_queue": ("GET", "/api/apply/queue", 200, "read_only"),
    "list_apply_records": ("GET", "/api/apply/records/grouped", 200, "read_only"),
    "get_analytics_overview": ("GET", "/api/analytics/dashboard", 200, "read_only"),
    "list_drill_sessions": ("GET", "/api/drill", 200, "read_only"),
    "get_drill_report": ("GET", "/api/drill/{session_id}", 200, "read_only"),
    "list_interview_sessions": ("GET", "/api/interview", 200, "read_only"),
    "get_interview_report": ("GET", "/api/interview/{session_id}", 200, "read_only"),
    "list_question_banks": ("GET", "/api/interview/question-banks", 200, "read_only"),
    "list_reviews": ("GET", "/api/interview/reviews", 200, "read_only"),
    "list_share_packages": ("GET", "/api/share-packages", 200, "read_only"),
    "update_resume_layout": ("PATCH", "/api/resumes/{resume_id}/layout", 200, "reversible_write"),
}


def _report_actions() -> dict:
    actions: dict = {}
    for builder in (
        apply_actions,
        analytics_actions,
        drill_actions,
        interview_actions,
        question_bank_actions,
        review_actions,
        share_package_actions,
        resumes_write_actions,
    ):
        actions.update(builder())
    return actions


def _serialize(spec, outcome) -> dict:
    """把 run 返回的 ActionOutcome.data 按 http.response_model 序列化成路由 JSON 结构。"""
    adapter = TypeAdapter(spec.http.response_model)
    return json.loads(adapter.dump_json(adapter.validate_python(outcome.data)))


def _make_resume(db_session, title: str = "T28 收尾测试简历") -> ResumeRecord:
    record = ResumeRecord(title=title)
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _tool_error_code(name: str, arguments: dict, db_session) -> str:
    with pytest.raises(ActionError) as info:
        execute_tool(db_session, name, arguments)
    return info.value.tool_error


# ----------------------------- 注册与 schema -----------------------------


def test_report_rest_actions_registered_with_expected_route():
    actions = _report_actions()
    assert set(actions) == set(EXPECTED)
    for name, (method, path, status_code, permission) in EXPECTED.items():
        spec = actions[name]
        assert spec.http is not None
        assert (spec.http.method, spec.http.path) == (method, path), name
        assert spec.http.status_code == status_code, name
        assert spec.permission.value == permission, name
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.permission is spec.permission
        assert tool.description == spec.description
        assert tool.service_entry == spec.service_entry


def test_report_rest_actions_are_registered():
    from app.services.actions import action_names

    names = set(action_names())
    for name in EXPECTED:
        assert name in names, name


def test_skipped_update_resume_is_still_a_static_tool():
    """update_resume 无法与单个路由用同一 input_model 表达 → 保留静态声明并登记。"""
    from app.services.actions import action_names

    assert "update_resume" not in set(action_names())
    assert get_tool("update_resume") is not None


def test_tool_fields_hide_route_only_parameters():
    actions = _report_actions()
    for name, spec in actions.items():
        tool = get_tool(name)
        if spec.tool_fields is None:
            continue
        assert set(tool.parameters["properties"]) == set(spec.tool_fields), name
        assert set(tool.parameters["required"]) <= set(spec.tool_fields), name
    # 逐个确认最容易被泄露的路由专属字段不在工具 schema 里
    hidden = {
        "get_analytics_overview": ("trend_months",),
        "list_apply_records": ("page", "page_size", "failure_category", "include_items"),
        "update_resume_layout": (
            "format_name",
            "document_mode",
            "language",
            "format_config",
            "expected_revision",
        ),
    }
    for name, fields in hidden.items():
        properties = get_tool(name).parameters["properties"]
        for field in fields:
            assert field not in properties, f"{name}.{field} 不该暴露给模型"


# ----------------------------- run：路由侧数据一致 -----------------------------


def test_analytics_route_and_action_data_agree(client, db_session):
    spec = analytics_actions()["get_analytics_overview"]
    route = client.get("/api/analytics/dashboard")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model())
    assert _serialize(spec, data) == route.json()


def test_apply_queue_route_and_action_data_agree(client, db_session):
    spec = apply_actions()["list_apply_queue"]
    route = client.get("/api/apply/queue")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model())
    assert _serialize(spec, data) == route.json()


def test_apply_records_route_and_action_data_agree(client, db_session):
    spec = apply_actions()["list_apply_records"]
    route = client.get("/api/apply/records/grouped")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model())
    assert _serialize(spec, data) == route.json()


def test_drill_sessions_route_and_action_data_agree(client, db_session):
    session = DrillSession(title="T28 深挖")
    db_session.add(session)
    db_session.commit()
    spec = drill_actions()["list_drill_sessions"]
    route = client.get("/api/drill")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model())
    assert _serialize(spec, data) == route.json()
    assert len(route.json()) == 1


def test_drill_report_route_and_action_data_agree(client, db_session):
    session = DrillSession(title="T28 深挖报告")
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    spec = drill_actions()["get_drill_report"]
    route = client.get(f"/api/drill/{session.id}")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model(session_id=session.id))
    assert _serialize(spec, data) == route.json()


def test_interview_sessions_route_and_action_data_agree(client, db_session):
    session = InterviewSession(title="T28 模拟面试")
    db_session.add(session)
    db_session.commit()
    spec = interview_actions()["list_interview_sessions"]
    route = client.get("/api/interview")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model())
    assert _serialize(spec, data) == route.json()
    assert len(route.json()) == 1


def test_interview_report_route_and_action_data_agree(client, db_session):
    session = InterviewSession(title="T28 面试报告")
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    spec = interview_actions()["get_interview_report"]
    route = client.get(f"/api/interview/{session.id}")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model(session_id=session.id))
    assert _serialize(spec, data) == route.json()


def test_question_banks_route_and_action_data_agree(client, db_session):
    spec = question_bank_actions()["list_question_banks"]
    route = client.get("/api/interview/question-banks")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model())
    assert _serialize(spec, data) == route.json()


def test_reviews_route_and_action_data_agree(client, db_session):
    spec = review_actions()["list_reviews"]
    route = client.get("/api/interview/reviews")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model())
    assert _serialize(spec, data) == route.json()


def test_share_packages_route_and_action_data_agree(client, db_session):
    spec = share_package_actions()["list_share_packages"]
    route = client.get("/api/share-packages")
    assert route.status_code == 200
    data = spec.run(db_session, spec.input_model())
    assert _serialize(spec, data) == route.json()


# ----------------------------- 写操作：update_resume_layout -----------------------------


def test_update_resume_layout_route_and_action_write_same_fields(client, db_session):
    route_resume = _make_resume(db_session, "路由改版式")
    tool_resume = _make_resume(db_session, "工具改版式")
    spec = resumes_write_actions()["update_resume_layout"]
    route = client.patch(
        f"/api/resumes/{route_resume.id}/layout",
        json={"font_scale": "large", "page_limit": 2},
    )
    assert route.status_code == 200, route.text
    outcome = spec.run(
        db_session, spec.input_model(resume_id=tool_resume.id, font_scale="large", page_limit=2)
    )
    run_json = _serialize(spec, outcome)
    # 两条记录各自独立：比较与版式相关的字段（id/标题/时间本来就不同）。
    for field in ("font_scale", "page_limit", "template"):
        assert run_json[field] == route.json()[field]
    db_session.expire_all()
    for resume_id in (route_resume.id, tool_resume.id):
        record = db_session.get(ResumeRecord, resume_id)
        assert (record.font_scale, record.page_limit) == ("large", 2)


def test_update_resume_layout_tool_path_keeps_tool_semantics(client, db_session):
    resume = _make_resume(db_session, "工具改版式路径")
    spec = resumes_write_actions()["update_resume_layout"]
    outcome = spec.run_tool(db_session, spec.input_model(resume_id=resume.id, template="modern"))
    assert outcome.changed is True
    assert "版式" in outcome.summary
    result = execute_tool(
        db_session, "update_resume_layout", {"resume_id": resume.id, "template": "modern"}
    )
    assert (result.text, result.summary, result.changed) == (
        outcome.text,
        outcome.summary,
        outcome.changed,
    )
    db_session.expire_all()
    db_session.refresh(resume)
    assert resume.template == "modern"
    # 缺少任何版式字段时旧工具会报错（run_tool 保持）
    with pytest.raises(ValueError):
        execute_tool(db_session, "update_resume_layout", {"resume_id": resume.id})


def test_update_resume_layout_preview_matches_legacy(client, db_session):
    resume = _make_resume(db_session, "预览版式")
    tool = get_tool("update_resume_layout")
    arguments = {"resume_id": resume.id, "font_scale": "large"}
    actual = tool.preview(db_session, dict(arguments))
    expected = legacy_previews.preview_update_resume_layout(db_session, dict(arguments))
    assert actual.model_dump() == expected.model_dump()


# ----------------------------- run_tool：文案/摘要一致 -----------------------------

TOOL_PARITY_CASES = (
    (
        "list_apply_queue",
        apply_actions,
        {},
    ),
    (
        "list_apply_records",
        apply_actions,
        {"keyword": "", "result": ""},
    ),
    (
        "get_analytics_overview",
        analytics_actions,
        {},
    ),
    (
        "list_drill_sessions",
        drill_actions,
        {"status": "", "limit": 20},
    ),
    (
        "list_interview_sessions",
        interview_actions,
        {"limit": 20, "status": ""},
    ),
    (
        "list_question_banks",
        question_bank_actions,
        {"limit": 20},
    ),
    (
        "list_reviews",
        review_actions,
        {"limit": 20},
    ),
    (
        "list_share_packages",
        share_package_actions,
        {"keyword": "", "limit": 20},
    ),
)


@pytest.mark.parametrize(("name", "builder", "arguments"), TOOL_PARITY_CASES)
def test_run_tool_matches_execute_tool(name, builder, arguments, client, db_session):
    spec = builder()[name]
    outcome = spec.run_tool(db_session, spec.input_model(**arguments))
    result = execute_tool(db_session, name, dict(arguments))
    assert (outcome.text, outcome.summary, outcome.changed) == (
        result.text,
        result.summary,
        result.changed,
    )


# ----------------------------- 错误路径 -----------------------------


def test_missing_rows_are_404_on_route_and_same_http_error_from_run(client, db_session):
    spec = drill_actions()["get_drill_report"]
    assert client.get("/api/drill/999999").status_code == 404
    with pytest.raises(HTTPException) as info:
        spec.run(db_session, spec.input_model(session_id=999999))
    assert info.value.status_code == 404

    spec = interview_actions()["get_interview_report"]
    assert client.get("/api/interview/999999").status_code == 404
    with pytest.raises(HTTPException) as info:
        spec.run(db_session, spec.input_model(session_id=999999))
    assert info.value.status_code == 404


def test_invalid_tool_input_is_contract_error(client, db_session):
    # 枚举非法：路由 422；工具侧契约层 invalid_input
    assert client.get("/api/drill", params={"status": "bogus"}).status_code == 422
    assert (
        _tool_error_code("list_drill_sessions", {"status": "bogus"}, db_session) == "invalid_input"
    )
    # 路由侧 status 是工具字段（旧 GET 忽略未知查询参数）；工具侧由 input_model 拒绝
    assert (
        _tool_error_code("list_interview_sessions", {"status": "bogus"}, db_session)
        == "invalid_input"
    )
    # 类型非法：工具侧走同一条 input_model 校验 → invalid_input
    assert (
        _tool_error_code("update_resume_layout", {"resume_id": "not-a-number"}, db_session)
        == "invalid_input"
    )
    assert _tool_error_code("get_drill_report", {"session_id": "x"}, db_session) == "invalid_input"


def test_read_only_actions_do_not_write(db_session):
    before = db_session.query(DrillSession).count(), db_session.query(InterviewSession).count()
    for name in (
        "list_apply_queue",
        "list_apply_records",
        "get_analytics_overview",
        "list_drill_sessions",
        "list_interview_sessions",
        "list_question_banks",
        "list_reviews",
        "list_share_packages",
    ):
        execute_tool(db_session, name, {})
    db_session.expire_all()
    after = db_session.query(DrillSession).count(), db_session.query(InterviewSession).count()
    assert before == after
