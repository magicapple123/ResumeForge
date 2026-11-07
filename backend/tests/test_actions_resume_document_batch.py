# SPDX-License-Identifier: Apache-2.0
"""T28 收尾批：简历 document 域 8 对里安全迁移的 3 对，与其余 5 对的跳过证据。

迁移对：list_versions ↔ GET /api/resumes/{resume_id}/versions；
list_variants ↔ GET /api/resumes/{resume_id}/variants；
get_resume_status ↔ POST /api/resumes/{resume_id}/pagination/report。

断言口径（与其它 batch 一致）：action 注册与 http 元数据、工具 name/description/permission/
service_entry 逐项保持、schema 的 required 与 tool_fields 投影、run 与旧路由 JSON 一致、
run_tool 与旧工具 handler text/summary 一致、缺失对象与非法输入两侧同表错误码、
只读不写库。跳过 5 对的理由在 domains/resume_document.py 模块 docstring，这里用
"未注册 action + 旧静态声明仍在"钉住。
"""

from __future__ import annotations

import json

import pytest
from app.database import SessionLocal, get_db
from app.models.resume import ResumeRecord
from app.models.versions import ResumeVariant, ResumeVersion
from app.schemas.versions import VariantListOut, VersionListOut
from app.services.actions import ActionError, as_route, get_action
from app.services.actions.domains.resume_document import resume_document_actions
from app.services.assistant_tools import execute_tool, get_tool, tool_names
from app.services.assistant_tools._tools_specs_document import DOCUMENT_TOOLS
from app.services.assistant_tools._types import ToolPermission
from app.services.assistant_tools.document_tools import (
    _tool_get_resume_status,
    _tool_list_variants,
    _tool_list_versions,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

CONTENT = {
    "name": "张示例",
    "job_intent": "后端工程师",
    "education": [
        {
            "school": "示例大学",
            "major": "计算机科学与技术",
            "degree": "本科",
            "start_date": "2018.09",
            "end_date": "2022.06",
            "gpa": "3.8/4.0",
        }
    ],
    "experience": [
        {
            "company": "示例科技",
            "role": "后端工程师",
            "start_date": "2022.07",
            "end_date": "至今",
            "description": ["负责投递平台任务调度子系统。"],
        }
    ],
    "projects": [{"name": "简历工作台", "role": "独立开发", "description": ["文档模型 v2。"]}],
    "skills": [{"name": "Python", "level": "熟练"}],
}

MIGRATED = {
    "list_versions": ("GET", "/api/resumes/{resume_id}/versions", VersionListOut),
    "list_variants": ("GET", "/api/resumes/{resume_id}/variants", VariantListOut),
    "get_resume_status": ("POST", "/api/resumes/{resume_id}/pagination/report", dict),
}

SKIPPED = {
    "get_entry": ToolPermission.READ_ONLY,
    "update_resume_field": ToolPermission.REVERSIBLE_WRITE,
    "add_resume_entry": ToolPermission.REVERSIBLE_WRITE,
    "reorder_sections": ToolPermission.REVERSIBLE_WRITE,
    "set_entry_layout": ToolPermission.REVERSIBLE_WRITE,
}

EXPECTED_DOCUMENT_TOOL_ORDER = (
    "get_resume_status",
    "list_versions",
    "list_variants",
    "get_entry",
    "update_resume_field",
    "add_resume_entry",
    "reorder_sections",
    "set_entry_layout",
)


def _jsonable(data):
    if isinstance(data, BaseModel):
        return data.model_dump(mode="json")
    return data


def _create_resume(client, *, page_limit: int = 1) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "T28 文档批次", "content": CONTENT, "job_id": None},
    )
    assert response.status_code == 201, response.text
    resume_id = response.json()["id"]
    patched = client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={"page_limit": page_limit, "template": "classic"},
    )
    assert patched.status_code == 200, patched.text
    return resume_id


def _contract_client(spec) -> TestClient:
    """只挂这一条 action 生成的路由（Lead 后续按同一实现切换注册）。

    用独立的 SessionLocal 覆盖 get_db：TestClient 的同步端点跑在线程池里，
    复用测试 fixture 的 Session 会跨线程。数据是已提交的，独立会话看得到。
    """
    application = FastAPI()
    application.include_router(as_route(spec))

    def _override():
        with SessionLocal() as session:
            yield session

    application.dependency_overrides[get_db] = _override
    return TestClient(application)


def _route_error_code(response) -> str:
    detail = response.json().get("detail")
    assert isinstance(detail, dict), detail
    return str(detail.get("code"))


# ----------------------------- 注册 / 元数据 -----------------------------


def test_three_pairs_are_registered_with_http_route_and_tool():
    actions = resume_document_actions()
    for name, (method, path, response_model) in MIGRATED.items():
        spec = actions[name]
        assert (spec.http.method, spec.http.path) == (method, path), name
        assert spec.http.response_model is response_model, name
        assert spec.permission is ToolPermission.READ_ONLY, name
        assert spec.preview is None, name
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.permission is spec.permission, name
        assert tool.description == spec.description, name
        assert get_action(name) is spec, name


def test_legacy_metadata_is_preserved():
    actions = resume_document_actions()
    expected_service_entry = {
        "list_versions": "resume.document_versions.list_versions",
        "list_variants": "resume.document_variants.list_variants",
        "get_resume_status": "resume.document_pagination.build_pagination_report",
    }
    for name, service_entry in expected_service_entry.items():
        spec = actions[name]
        tool = get_tool(name)
        assert spec.service_entry == service_entry, name
        assert tool.service_entry == service_entry, name
    # 三条旧描述（迁移前逐字）都在 tool 上，且与 spec 同源。
    assert get_tool("list_versions").description.startswith("列出某份简历保存过的命名版本")
    assert get_tool("list_variants").description.startswith("列出某份简历派生过的岗位变体")
    assert get_tool("get_resume_status").description.startswith("读取一份简历的**版面状态**")


def test_document_tools_stay_in_the_pinned_order():
    assert tuple(tool.name for tool in DOCUMENT_TOOLS) == EXPECTED_DOCUMENT_TOOL_ORDER
    # 迁移的三条来自 action 契约层，其余五条仍是静态声明。
    migrated = set(MIGRATED)
    assert migrated <= set(tool_names())


# ----------------------------- schema 对齐 -----------------------------


def test_tool_schema_required_and_hidden_route_only_fields():
    actions = resume_document_actions()
    versions_schema = get_tool("list_versions").parameters
    assert versions_schema["required"] == ["resume_id"]
    assert versions_schema["required"] == [
        name
        for name, field in actions["list_versions"].input_model.model_fields.items()
        if field.is_required()
    ]
    assert set(versions_schema["properties"]) == {"resume_id", "limit"}
    assert versions_schema["properties"]["limit"]["type"] == "integer"

    variants_schema = get_tool("list_variants").parameters
    assert set(variants_schema["properties"]) == {"resume_id", "limit"}

    # get_resume_status 的路由 body 是精确预览请求；工具侧只允许 resume_id。
    status_schema = get_tool("get_resume_status").parameters
    assert status_schema["required"] == ["resume_id"]
    assert list(status_schema["properties"]) == ["resume_id"]
    for route_only in ("content", "watermark", "variant_id", "page_limit", "template"):
        assert route_only not in status_schema["properties"], route_only
        assert route_only in actions["get_resume_status"].input_model.model_fields, route_only


# ----------------------------- run / run_tool 行为保持 -----------------------------


def _seed_versions_and_variants(client) -> int:
    resume_id = _create_resume(client)
    version = client.post(
        f"/api/resumes/{resume_id}/versions", json={"name": "投递版", "change_summary": "首版"}
    )
    assert version.status_code == 201, version.text
    variant = client.post(f"/api/resumes/{resume_id}/variants", json={"name": "字节变体"})
    assert variant.status_code == 201, variant.text
    return resume_id


def test_list_versions_route_and_action_run_agree(client, db_session):
    resume_id = _seed_versions_and_variants(client)
    spec = resume_document_actions()["list_versions"]
    outcome = spec.run(db_session, spec.input_model(resume_id=resume_id))

    route_body = client.get(f"/api/resumes/{resume_id}/versions")
    assert route_body.status_code == 200
    assert _jsonable(outcome.data) == route_body.json()
    assert [item.name for item in outcome.data.items] == ["投递版"]
    # 只读动作的路由侧 outcome 不产生工具 text/summary。
    assert (outcome.text, outcome.summary, outcome.changed) == ("", "", False)


def test_list_variants_route_and_action_run_agree(client, db_session):
    resume_id = _seed_versions_and_variants(client)
    spec = resume_document_actions()["list_variants"]
    outcome = spec.run(db_session, spec.input_model(resume_id=resume_id))

    route_body = client.get(f"/api/resumes/{resume_id}/variants")
    assert route_body.status_code == 200
    assert _jsonable(outcome.data) == route_body.json()
    assert [item.name for item in outcome.data.items] == ["字节变体"]


def test_get_resume_status_route_and_action_run_agree(client, db_session):
    resume_id = _create_resume(client, page_limit=1)
    spec = resume_document_actions()["get_resume_status"]
    outcome = spec.run(db_session, spec.input_model(resume_id=resume_id))

    route_body = client.post(f"/api/resumes/{resume_id}/pagination/report", json={})
    assert route_body.status_code == 200, route_body.text
    assert isinstance(outcome.data, dict)
    assert outcome.data == route_body.json()
    for key in ("pages", "pages_needed", "overflow", "page_limit", "truncated_at"):
        assert key in outcome.data, key


@pytest.mark.parametrize(
    ("name", "handler"),
    [
        ("list_versions", _tool_list_versions),
        ("list_variants", _tool_list_variants),
        ("get_resume_status", _tool_get_resume_status),
    ],
)
def test_tool_results_match_legacy_handlers(name, handler, client, db_session):
    resume_id = _seed_versions_and_variants(client)
    arguments = {"resume_id": resume_id}
    if name in {"list_versions", "list_variants"}:
        arguments["limit"] = 1

    legacy = handler(db_session, dict(arguments))
    result = execute_tool(db_session, name, dict(arguments))
    assert (result.text, result.summary, result.link, result.changed) == (
        legacy.text,
        legacy.summary,
        legacy.link,
        legacy.changed,
    )
    # 只读工具不落库：执行前后版本/变体行数不变。
    assert db_session.query(ResumeVersion).count() == 1
    assert db_session.query(ResumeVariant).count() == 1


def test_tool_limit_truncates_tool_text_but_route_sees_all(client, db_session):
    resume_id = _create_resume(client)
    for index in range(2):
        created = client.post(f"/api/resumes/{resume_id}/versions", json={"name": f"版本{index}"})
        assert created.status_code == 201, created.text

    limited = json.loads(
        execute_tool(db_session, "list_versions", {"resume_id": resume_id, "limit": 1}).text
    )
    assert len(limited["versions"]) == 1
    # 路由侧 limit 是工具专属字段（旧路由不认识），仍返回全部。
    spec = resume_document_actions()["list_versions"]
    outcome = spec.run(db_session, spec.input_model(resume_id=resume_id, limit=1))
    assert len(outcome.data.items) == 2


# ----------------------------- 错误码同表 -----------------------------


@pytest.mark.parametrize("name", list(MIGRATED))
def test_missing_resume_is_not_found_on_route_and_action(name, client, db_session):
    method, path, _ = MIGRATED[name]
    spec = resume_document_actions()[name]
    url = path.replace("{resume_id}", "999999")

    # 旧路由（尚未切换注册）：仍是 404。
    old_response = client.get(url) if method == "GET" else client.post(url, json={})
    assert old_response.status_code == 404, name
    # action 生成的契约路由：404 + {code, message}。
    contract = _contract_client(spec)
    contract_response = contract.get(url) if method == "GET" else contract.post(url, json={})
    assert contract_response.status_code == 404, name
    assert _route_error_code(contract_response) == "not_found", name
    # run 直接调用时抛 ActionError not_found（不再是旧 HTTPException）。
    with pytest.raises(ActionError) as info:
        spec.run(db_session, spec.input_model(resume_id=999999))
    assert info.value.code == "not_found", name
    assert info.value.tool_error == "not_found", name


def test_invalid_input_uses_the_same_code_on_both_sides(db_session):
    spec = resume_document_actions()["list_versions"]
    contract = _contract_client(spec)
    response = contract.get("/api/resumes/notanint/versions")
    assert response.status_code == 422
    assert _route_error_code(response) == "invalid_input"

    with pytest.raises(ActionError) as info:
        get_tool("list_versions").handler(db_session, {"resume_id": "notanint"})
    assert info.value.code == "invalid_input"


def test_unknown_query_is_ignored_like_the_old_get_routes(client, db_session):
    resume_id = _seed_versions_and_variants(client)
    for name in ("list_versions", "list_variants"):
        spec = resume_document_actions()[name]
        method, path, _ = MIGRATED[name]
        url = path.replace("{resume_id}", str(resume_id))
        contract = _contract_client(spec)
        assert contract.get(url + "?bogus=1").status_code == 200, name
    # 旧路由同样忽略未知 query（行为不变的对照）。
    assert client.get(f"/api/resumes/{resume_id}/versions?bogus=1").status_code == 200


def test_pagination_report_still_rejects_unknown_body_fields(client, db_session):
    resume_id = _create_resume(client)
    spec = resume_document_actions()["get_resume_status"]
    contract = _contract_client(spec)
    url = f"/api/resumes/{resume_id}/pagination/report"
    response = contract.post(url, json={"bogus": 1})
    assert response.status_code == 422
    assert _route_error_code(response) == "invalid_input"
    # 旧路由同样 422（extra=forbid 的历史契约）。
    assert client.post(url, json={"bogus": 1}).status_code == 422


# ----------------------------- 跳过 5 对的证据 -----------------------------


def test_skipped_pairs_stay_legacy_without_action():
    for name, permission in SKIPPED.items():
        assert get_action(name) is None, f"{name} 没有真正等价路由，不应迁到 action 层"
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.permission is permission, name
        if permission.is_write:
            assert tool.preview is not None, f"写工具 {name} 必须保留旧 preview"
    # 旧静态声明仍在（guard 的存量计数会随迁移减少；本批只迁 3 条）。
    legacy_names = {tool.name for tool in DOCUMENT_TOOLS} - set(MIGRATED)
    assert legacy_names == set(SKIPPED)


def test_skipped_read_and_write_tools_keep_legacy_behavior(client, db_session):
    """跳过的工具仍走旧 handler：get_entry 能读，reorder_sections 的校验文案不变。"""
    resume_id = _create_resume(client)
    db_session.expire_all()
    record = db_session.get(ResumeRecord, resume_id)
    assert record is not None
    content = record.content or {}
    sections = [section["key"] for section in content.get("sections") or []]

    # 写工具：顺序没变化时旧 handler 明确报错（不静默写一份空改动）。
    with pytest.raises(ValueError, match="没有变化"):
        execute_tool(db_session, "reorder_sections", {"resume_id": resume_id, "order": sections})

    # 读工具：get_entry 仍能按 path 读到单条。
    education = next(section for section in content["sections"] if section["key"] == "education")
    entry = education["entries"][0]
    result = execute_tool(
        db_session,
        "get_entry",
        {"resume_id": resume_id, "path": f"education.{entry['id']}"},
    )
    payload = json.loads(result.text)
    assert payload["entry"]["object_id"] == entry["id"]
    assert payload["revision"] >= 0
