# SPDX-License-Identifier: Apache-2.0
"""T28 Batch B：report 类四域（referrals/reminders/knowledge/interview_experiences）
路由 ↔ 工具奇偶校验与行为保持。

迁移对 10 个：本文件覆盖 8 个；收尾补迁的 create_referral / create_interview_experience
（工具声明在 p3_tools.py）由 tests/test_actions_extra_pairs.py 覆盖。

每个用例对着真实路由 + 真实工具跑同一份输入，断言：
- 合法输入两侧一致（只读列表的过滤集合 / 写操作的落库字段）；
- 非法输入两侧错误来自同一张映射表（路由 detail.code == 工具 error token）；
- input_model required 与 as_tool schema 逐项一致；
- 工具默认值（limit/source）与路由默认值各自保持；
- 只读动作不写库；preview 与旧 previews.preview_* 输出逐字段一致。
"""

from __future__ import annotations

import json

import pytest
from app.models.knowledge_entry import KnowledgeEntry
from app.models.reminder import Reminder
from app.services.actions.catalog import all_actions
from app.services.actions.domains.interview_experiences import interview_experience_actions
from app.services.actions.domains.knowledge import knowledge_actions
from app.services.actions.domains.referrals import referral_actions
from app.services.actions.domains.reminders import reminder_actions
from app.services.assistant_tools import execute_tool, get_tool

DIRECT_PATHS = {
    "list_referrals": ("GET", "/api/referrals"),
    "list_reminders": ("GET", "/api/reminders"),
    "update_reminder": ("PATCH", "/api/reminders/{reminder_id}"),
    "list_knowledge": ("GET", "/api/knowledge"),
    "get_knowledge": ("GET", "/api/knowledge/{knowledge_id}"),
    "create_knowledge": ("POST", "/api/knowledge"),
    "update_knowledge": ("PUT", "/api/knowledge/{knowledge_id}"),
    "list_interview_experiences": ("GET", "/api/interview-experiences"),
    "create_referral": ("POST", "/api/referrals"),
    "create_interview_experience": ("POST", "/api/interview-experiences"),
}
EXPECTED_PERMISSIONS = {
    "list_referrals": "read_only",
    "list_reminders": "read_only",
    "update_reminder": "reversible_write",
    "list_knowledge": "read_only",
    "get_knowledge": "read_only",
    "create_knowledge": "reversible_write",
    "update_knowledge": "reversible_write",
    "list_interview_experiences": "read_only",
    "create_referral": "reversible_write",
    "create_interview_experience": "reversible_write",
}


def _report_actions() -> dict:
    actions: dict = {}
    for builder in (
        referral_actions,
        reminder_actions,
        knowledge_actions,
        interview_experience_actions,
    ):
        actions.update(builder())
    return actions


def _route_error_code(response) -> str:
    detail = response.json().get("detail")
    assert isinstance(detail, dict), detail
    return str(detail.get("code"))


def _tool_error_code(tool: str, arguments: dict, db_session) -> str:
    with pytest.raises(ValueError) as info:
        execute_tool(db_session, tool, arguments)
    code = getattr(info.value, "tool_error", None)
    assert code, info.value
    return str(code)


def _tool_payload(tool: str, arguments: dict, db_session) -> dict:
    return json.loads(execute_tool(db_session, tool, arguments).text)


def _create_referral(client, **overrides) -> dict:
    payload = {"company": "示例科技", "position": "后端开发", "referrer_name": "张三"}
    payload.update(overrides)
    response = client.post("/api/referrals", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _create_reminder(client, title: str = "提醒 A", **overrides) -> dict:
    payload = {"title": title, "remind_at": "2026-12-01T10:00:00"}
    payload.update(overrides)
    response = client.post("/api/reminders", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _create_knowledge(client, title: str = "知识 A", **overrides) -> dict:
    payload = {"title": title, "category": "面经"}
    payload.update(overrides)
    response = client.post("/api/knowledge", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _create_experience(client, title: str = "面经 A", **overrides) -> dict:
    payload = {"title": title, "company": "示例科技"}
    payload.update(overrides)
    response = client.post("/api/interview-experiences", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# ----------------------------- 注册与 schema -----------------------------


def test_report_actions_are_registered_as_route_tool_pairs():
    actions = _report_actions()
    assert set(actions) == set(DIRECT_PATHS)
    for name, (method, path) in DIRECT_PATHS.items():
        spec = actions[name]
        assert spec.http is not None
        assert (spec.http.method, spec.http.path) == (method, path), name
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.permission is spec.permission
        assert tool.permission.value == EXPECTED_PERMISSIONS[name]
        assert tool.service_entry == spec.service_entry
        assert tool.description == spec.description


def test_report_actions_are_in_the_global_catalog():
    catalog = all_actions()
    for name in DIRECT_PATHS:
        assert name in catalog, name


def test_schema_required_matches_input_model():
    actions = _report_actions()
    for name in DIRECT_PATHS:
        model_schema = actions[name].input_model.model_json_schema()
        expected_required = [
            field_name
            for field_name, field in actions[name].input_model.model_fields.items()
            if field.is_required()
        ]
        assert model_schema.get("required", []) == expected_required, name
        tool_schema = get_tool(name).parameters
        assert "$ref" not in json.dumps(tool_schema), name
        assert tool_schema["required"] == expected_required, name


def test_previously_skipped_create_tools_are_now_migrated():
    """收尾时把声明在 p3_tools.py 的两对补迁了（见 test_actions_extra_pairs.py）。"""
    catalog = all_actions()
    for name in ("create_referral", "create_interview_experience"):
        assert name in catalog, name
        assert get_tool(name) is not None, name


# ----------------------------- 合法输入：只读列表 -----------------------------


def test_list_referrals_route_and_tool_agree(client, db_session):
    _create_referral(client, company="甲科技", position="后端")
    _create_referral(client, company="乙文化", position="运营")
    route = client.get("/api/referrals", params={"keyword": "甲"})
    assert route.status_code == 200
    body = route.json()
    payload = _tool_payload("list_referrals", {"keyword": "甲"}, db_session)
    assert [item["company"] for item in body] == ["甲科技"]
    assert [item["company"] for item in payload["内推"]] == ["甲科技"]
    assert len(body) == payload["返回"] == 1


def test_list_reminders_route_and_tool_agree(client, db_session):
    _create_reminder(client, "面试提醒", kind="interview")
    _create_reminder(client, "其他提醒", kind="other")
    route = client.get("/api/reminders", params={"kind": "interview"})
    assert route.status_code == 200
    payload = _tool_payload("list_reminders", {"kind": "interview"}, db_session)
    route_ids = [item["id"] for item in route.json()]
    tool_ids = [item["id"] for item in payload["提醒"]]
    assert route_ids == tool_ids and len(route_ids) == 1


def test_list_knowledge_route_and_tool_agree(client, db_session):
    _create_knowledge(client, "面经总结", category="面经")
    _create_knowledge(client, "简历技巧", category="简历技巧")
    route = client.get("/api/knowledge", params={"category": "面经"})
    assert route.status_code == 200
    payload = _tool_payload("list_knowledge", {"category": "面经"}, db_session)
    assert [item["title"] for item in route.json()] == ["面经总结"]
    assert [item["title"] for item in payload["知识库"]] == ["面经总结"]


def test_list_interview_experiences_route_and_tool_agree(client, db_session):
    _create_experience(client, "甲公司面经", company="甲公司")
    _create_experience(client, "乙公司面经", company="乙公司")
    route = client.get("/api/interview-experiences", params={"company": "甲公司"})
    assert route.status_code == 200
    payload = _tool_payload("list_interview_experiences", {"company": "甲公司"}, db_session)
    assert [item["title"] for item in route.json()] == ["甲公司面经"]
    assert [item["title"] for item in payload["面经"]] == ["甲公司面经"]


def test_list_tool_text_matches_legacy_handler(client, db_session):
    """模型侧文案必须与迁移前的 handler 逐字一致（run 复用旧 handler 生成文案）。"""
    from app.services.assistant_tools import report_tools

    _create_referral(client)
    _create_reminder(client, "对比提醒")
    _create_knowledge(client, "对比知识")
    _create_experience(client, "对比面经")
    cases = {
        "list_referrals": ({"keyword": ""}, report_tools._tool_list_referrals),
        "list_reminders": ({"kind": "", "status": ""}, report_tools._tool_list_reminders),
        "list_knowledge": ({"q": "", "category": ""}, report_tools._tool_list_knowledge),
        "list_interview_experiences": (
            {"keyword": "", "company": "", "source": ""},
            report_tools._tool_list_interview_experiences,
        ),
    }
    for name, (arguments, legacy) in cases.items():
        expected = legacy(db_session, dict(arguments))
        actual = execute_tool(db_session, name, dict(arguments))
        assert actual.text == expected.text, name
        assert actual.summary == expected.summary, name


# ----------------------------- 工具默认值 -----------------------------


def test_list_tools_keep_their_default_limit(client, db_session):
    for index in range(21):
        _create_reminder(client, f"默认值提醒 {index}")
    payload = _tool_payload("list_reminders", {}, db_session)
    assert payload["返回"] == 20  # 工具历史默认 20 条
    route = client.get("/api/reminders")
    assert len(route.json()) == 21  # 路由默认 200 条，不截断
    spec = reminder_actions()["list_reminders"]
    assert dict(spec.tool_defaults)["limit"] == 20
    assert spec.input_model.model_fields["limit"].default == 200


def test_create_knowledge_tool_default_source_vs_route_default(client, db_session):
    tool_result = execute_tool(db_session, "create_knowledge", {"title": "工具默认来源"})
    assert tool_result.changed is True
    tool_row = db_session.query(KnowledgeEntry).filter(KnowledgeEntry.title == "工具默认来源").one()
    assert tool_row.source == "助手录入"

    created = _create_knowledge(client, "路由默认来源")
    route_row = db_session.get(KnowledgeEntry, created["id"])
    assert route_row.source == "手动录入"


# ----------------------------- 合法输入：写操作落库一致 -----------------------------


def test_create_knowledge_route_and_tool_write_the_same_row(client, db_session):
    payload = {
        "title": "奇偶校验知识",
        "category": "求职策略",
        "tags": ["标签A", "标签B"],
        "content": "正文内容",
        "source": "统一来源",
    }
    route = client.post("/api/knowledge", json=payload)
    assert route.status_code == 201, route.text
    tool_result = execute_tool(db_session, "create_knowledge", dict(payload))
    assert tool_result.changed is True
    db_session.expire_all()
    rows = (
        db_session.query(KnowledgeEntry)
        .filter(KnowledgeEntry.title == "奇偶校验知识")
        .order_by(KnowledgeEntry.id)
        .all()
    )
    assert len(rows) == 2
    cols = ["title", "category", "tags", "content", "source"]
    assert [getattr(rows[0], col) for col in cols] == [getattr(rows[1], col) for col in cols]


def test_update_knowledge_route_replaces_but_tool_merges(client, db_session):
    route_row = _create_knowledge(client, "路由要改", content="旧正文")
    tool_row = _create_knowledge(client, "工具要改", content="旧正文")
    changes = {"title": "改后标题", "tags": ["新标签"]}
    response = client.put(f"/api/knowledge/{route_row['id']}", json=changes)
    assert response.status_code == 200, response.text
    execute_tool(db_session, "update_knowledge", {"knowledge_id": tool_row["id"], **changes})
    db_session.expire_all()
    route_db_row = db_session.get(KnowledgeEntry, route_row["id"])
    tool_db_row = db_session.get(KnowledgeEntry, tool_row["id"])
    # 路由 PUT 是整份替换：未提交的 content/category 落回 KnowledgeUpdate 默认值。
    assert route_db_row.title == "改后标题"
    assert list(route_db_row.tags or []) == ["新标签"]
    assert route_db_row.content == ""
    # 工具侧保持旧 handler 的合并语义：只改显式给出的字段。
    assert tool_db_row.title == "改后标题"
    assert list(tool_db_row.tags or []) == ["新标签"]
    assert tool_db_row.content == "旧正文"
    assert tool_db_row.category == "面经"


def test_update_knowledge_empty_body_is_rejected_on_both_sides(client, db_session):
    """title 是必填（旧 PUT 的 KnowledgeUpdate 同样要求），空 body 两侧都 invalid_input。"""
    created = _create_knowledge(client, "空更新", content="原正文")
    response = client.put(f"/api/knowledge/{created['id']}", json={})
    assert response.status_code == 422
    assert _route_error_code(response) == "invalid_input"
    assert (
        _tool_error_code("update_knowledge", {"knowledge_id": created["id"]}, db_session)
        == "invalid_input"
    )


def test_update_reminder_route_and_tool_write_the_same_status(client, db_session):
    route_row = _create_reminder(client, "路由提醒")
    tool_row = _create_reminder(client, "工具提醒")
    response = client.patch(f"/api/reminders/{route_row['id']}", json={"status": "done"})
    assert response.status_code == 200, response.text
    execute_tool(db_session, "update_reminder", {"reminder_id": tool_row["id"], "status": "done"})
    db_session.expire_all()
    assert db_session.get(Reminder, route_row["id"]).status == "done"
    assert db_session.get(Reminder, tool_row["id"]).status == "done"


def test_update_reminder_empty_body_is_a_noop_on_both_sides(client, db_session):
    created = _create_reminder(client, "空更新提醒")
    response = client.patch(f"/api/reminders/{created['id']}", json={})
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    result = execute_tool(db_session, "update_reminder", {"reminder_id": created["id"]})
    assert result.changed is False


# ----------------------------- 错误语义 -----------------------------


def test_missing_rows_use_the_same_not_found_code(client, db_session):
    response = client.get("/api/knowledge/999999")
    assert response.status_code == 404
    assert _route_error_code(response) == "not_found"
    assert _tool_error_code("get_knowledge", {"knowledge_id": 999999}, db_session) == "not_found"

    response = client.patch("/api/reminders/999999", json={})
    assert response.status_code == 404
    assert _route_error_code(response) == "not_found"
    assert (
        _tool_error_code("update_reminder", {"reminder_id": 999999, "status": "done"}, db_session)
        == "not_found"
    )


def test_invalid_input_parity_across_route_and_tool(client, db_session):
    bad_referral_status = client.get("/api/referrals", params={"status": "nope"})
    assert bad_referral_status.status_code == 422
    assert _route_error_code(bad_referral_status) == "invalid_input"
    assert _tool_error_code("list_referrals", {"status": "nope"}, db_session) == "invalid_input"

    bad_kind = client.get("/api/reminders", params={"kind": "nope"})
    assert bad_kind.status_code == 422
    assert _route_error_code(bad_kind) == "invalid_input"
    assert _tool_error_code("list_reminders", {"kind": "nope"}, db_session) == "invalid_input"

    bad_knowledge = client.post("/api/knowledge", json={})
    assert bad_knowledge.status_code == 422
    assert _route_error_code(bad_knowledge) == "invalid_input"
    assert _tool_error_code("create_knowledge", {}, db_session) == "invalid_input"

    reminder = _create_reminder(client, "非法状态提醒")
    bad_status = client.patch(f"/api/reminders/{reminder['id']}", json={"status": "nope"})
    assert bad_status.status_code == 422
    assert _route_error_code(bad_status) == "invalid_input"
    assert (
        _tool_error_code(
            "update_reminder", {"reminder_id": reminder["id"], "status": "nope"}, db_session
        )
        == "invalid_input"
    )

    bad_source = client.get("/api/interview-experiences", params={"source": "nope"})
    assert bad_source.status_code == 422
    assert _route_error_code(bad_source) == "invalid_input"
    assert (
        _tool_error_code("list_interview_experiences", {"source": "nope"}, db_session)
        == "invalid_input"
    )


def test_migrated_route_error_shape_is_the_contract_shape(client):
    response = client.get("/api/knowledge/999999")
    detail = response.json()["detail"]
    assert set(detail) == {"code", "message"}
    assert detail["code"] == "not_found"


def test_update_knowledge_rejects_unknown_field(client):
    created = _create_knowledge(client, "未知字段")
    response = client.put(f"/api/knowledge/{created['id']}", json={"bogus": 1})
    assert response.status_code == 422
    assert _route_error_code(response) == "invalid_input"


# ----------------------------- preview 与只读 -----------------------------


def test_previews_unchanged(client, db_session):
    from app.services.assistant_tools import previews

    create_tool = get_tool("create_knowledge")
    assert create_tool.preview is not None
    raw_create = {"title": "预览知识", "category": "面经"}
    assert (
        create_tool.preview(db_session, dict(raw_create)).model_dump()
        == previews.preview_create_knowledge(db_session, dict(raw_create)).model_dump()
    )

    knowledge = _create_knowledge(client, "预览更新")
    update_tool = get_tool("update_knowledge")
    raw_update = {"knowledge_id": knowledge["id"], "title": "改后标题"}
    assert (
        update_tool.preview(db_session, dict(raw_update)).model_dump()
        == previews.preview_update_knowledge(db_session, dict(raw_update)).model_dump()
    )

    reminder = _create_reminder(client, "预览提醒")
    reminder_tool = get_tool("update_reminder")
    raw_reminder = {"reminder_id": reminder["id"], "status": "done"}
    expected = previews.preview_update_reminder(db_session, dict(raw_reminder))
    assert (
        reminder_tool.preview(db_session, dict(raw_reminder)).model_dump() == expected.model_dump()
    )


def test_read_only_actions_do_not_write(db_session):
    before = (
        db_session.query(Reminder).count(),
        db_session.query(KnowledgeEntry).count(),
    )
    execute_tool(db_session, "list_reminders", {})
    execute_tool(db_session, "list_knowledge", {})
    db_session.expire_all()
    after = (
        db_session.query(Reminder).count(),
        db_session.query(KnowledgeEntry).count(),
    )
    assert before == after
