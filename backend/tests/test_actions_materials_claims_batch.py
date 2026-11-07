# SPDX-License-Identifier: Apache-2.0
"""T28 回归：materials / claims 在「run/run_tool 分流 + tool_fields 投影」后的行为。

覆盖三件事：
1. 路由侧保持旧语义（claims 可确认核实状态、materials 可带附件并落盘副本）；
2. 工具侧保持旧语义（create_claim 忽略核实状态、update_claim 合并且改不了核实状态；
   create_material 忽略附件、update_material 合并且不落副本）；
3. tool_fields 让路由专属字段不出现在工具 schema，同时路由 OpenAPI 仍保留这些字段。
"""

from __future__ import annotations

import json

import pytest
from app.models.claim import ClaimRecord
from app.models.material import Material
from app.services.assistant_tools import execute_tool, get_tool

CLAIM_PAYLOAD = {
    "title": "检索接口",
    "category": "项目经历",
    "subject": "示例项目",
    "source_fact": "参与检索接口开发",
    "candidate_wording": "实现检索接口并联调上线",
    "responsibility_level": "负责模块",
    "boundary": "接口由本人实现",
}


def _make_claim(db_session, title: str = "台账条目", **fields) -> ClaimRecord:
    base = {"source_fact": "事实", "candidate_wording": "表述"}
    base.update(fields)
    claim = ClaimRecord(title=title, **base)
    db_session.add(claim)
    db_session.commit()
    db_session.refresh(claim)
    return claim


def _make_material(db_session, title: str = "资料", **fields) -> Material:
    material = Material(title=title, **fields)
    db_session.add(material)
    db_session.commit()
    db_session.refresh(material)
    return material


def _route_error_code(response) -> str:
    detail = response.json().get("detail")
    assert isinstance(detail, dict), detail
    return str(detail.get("code"))


def test_claims_materials_are_registered_as_pairs():
    expected = {
        "list_materials": ("GET", "/api/materials"),
        "get_material": ("GET", "/api/materials/{material_id}"),
        "create_material": ("POST", "/api/materials"),
        "update_material": ("PUT", "/api/materials/{material_id}"),
        "get_claim": ("GET", "/api/claims/{claim_id}"),
        "create_claim": ("POST", "/api/claims"),
        "update_claim": ("PUT", "/api/claims/{claim_id}"),
    }
    for name, (method, path) in expected.items():
        tool = get_tool(name)
        assert tool is not None, name
        from app.services.actions import get_action

        spec = get_action(name)
        assert spec is not None, name
        assert (spec.http.method, spec.http.path) == (method, path), name
        assert tool.permission is spec.permission


def test_tool_fields_hide_route_only_fields_from_tool_schema():
    create_claim = get_tool("create_claim").parameters
    claim_props = set(create_claim.get("properties") or {})
    assert "verification_status" not in claim_props
    assert "sources" not in claim_props
    assert "assistant_tool_call" not in json.dumps(create_claim)
    assert claim_props == {
        "title",
        "category",
        "subject",
        "source_fact",
        "candidate_wording",
        "responsibility_level",
        "boundary",
        "risk_notes",
    }
    create_material = get_tool("create_material").parameters
    material_props = set(create_material.get("properties") or {})
    assert "files" not in material_props
    assert material_props == {"title", "category", "content", "url", "note"}


def test_route_openapi_keeps_route_only_fields(client):
    schema = client.get("/openapi.json").json()
    claim_body = schema["paths"]["/api/claims"]["post"]["requestBody"]["content"][
        "application/json"
    ]["schema"]
    claim_props = claim_body.get("properties") or {}
    assert "verification_status" in claim_props
    material_body = schema["paths"]["/api/materials"]["post"]["requestBody"]["content"][
        "application/json"
    ]["schema"]
    assert "files" in (material_body.get("properties") or {})


def test_claim_route_can_confirm_but_tool_cannot(client, db_session):
    created = client.post(
        "/api/claims",
        json={
            **CLAIM_PAYLOAD,
            "verification_status": "已确认",
            "sources": [{"type": "link", "location": "https://example.com", "public": True}],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["verification_status"] == "已确认"
    smuggled = execute_tool(
        db_session, "create_claim", {**CLAIM_PAYLOAD, "verification_status": "已确认"}
    )
    claim_id = json.loads(smuggled.text)["id"]
    assert json.loads(smuggled.text)["核实状态"] == "待确认"
    db_session.expire_all()
    assert db_session.get(ClaimRecord, claim_id).verification_status == "待确认"


def test_update_claim_route_replaces_but_tool_merges(client, db_session):
    route_record = _make_claim(
        db_session, "路由条目", candidate_wording="旧表述", boundary="旧边界"
    )
    tool_record = _make_claim(db_session, "工具条目", candidate_wording="旧表述", boundary="旧边界")
    response = client.put(
        f"/api/claims/{route_record.id}",
        json={
            **CLAIM_PAYLOAD,
            "title": "路由条目",
            "boundary": "",
            "verification_status": "已确认",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["verification_status"] == "已确认"
    execute_tool(
        db_session, "update_claim", {"claim_id": tool_record.id, "candidate_wording": "改后表述"}
    )
    db_session.expire_all()
    route_row = db_session.get(ClaimRecord, route_record.id)
    tool_row = db_session.get(ClaimRecord, tool_record.id)
    assert route_row.candidate_wording == CLAIM_PAYLOAD["candidate_wording"]
    assert tool_row.candidate_wording == "改后表述"
    assert tool_row.boundary == "旧边界"
    assert tool_row.verification_status == "待确认"
    assert route_row.boundary == ""


def test_update_claim_tool_cannot_change_status(client, db_session):
    record = _make_claim(db_session, "改状态")
    # 工具侧字段投影会剥掉 verification_status；旧 handler 因此报「没有给出要修改的字段」。
    with pytest.raises(ValueError, match="没有给出要修改的字段"):
        execute_tool(
            db_session, "update_claim", {"claim_id": record.id, "verification_status": "已确认"}
        )
    assert client.get(f"/api/claims/{record.id}").json()["verification_status"] == "待确认"


def test_create_material_route_and_tool_split_files(client, db_session):
    data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    response = client.post(
        "/api/materials",
        json={
            "title": "带附件资料",
            "category": "作品",
            "files": [{"name": "a.png", "data_url": data_url}],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["files"]
    execute_tool(
        db_session,
        "create_material",
        {"title": "工具资料", "files": [{"name": "b.png", "data_url": data_url}]},
    )
    tool_material = db_session.query(Material).filter(Material.title == "工具资料").one()
    assert list(tool_material.files or []) == []


def test_update_material_route_replaces_but_tool_merges(client, db_session):
    route_material = _make_material(db_session, "路由资料", content="旧正文", note="旧备注")
    tool_material = _make_material(db_session, "工具资料", content="旧正文", note="旧备注")
    response = client.put(
        f"/api/materials/{route_material.id}", json={"title": "路由资料", "note": "路由备注"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["content"] == ""
    execute_tool(
        db_session, "update_material", {"material_id": tool_material.id, "note": "工具备注"}
    )
    db_session.expire_all()
    assert db_session.get(Material, route_material.id).note == "路由备注"
    tool_row = db_session.get(Material, tool_material.id)
    assert tool_row.note == "工具备注"
    assert tool_row.content == "旧正文"


def test_missing_records_keep_route_codes_and_tool_messages(client, db_session):
    response = client.get("/api/claims/999999")
    assert response.status_code == 404 and _route_error_code(response) == "not_found"
    with pytest.raises(ValueError, match="不存在"):
        execute_tool(db_session, "get_claim", {"claim_id": 999999})
    response = client.put("/api/materials/999999", json={"title": "x"})
    assert response.status_code == 404 and _route_error_code(response) == "not_found"
    with pytest.raises(ValueError, match="不存在"):
        execute_tool(db_session, "update_material", {"material_id": 999999, "note": "x"})


def test_invalid_input_parity(client, db_session):
    bad_limit = client.get("/api/materials", params={"limit": "nope"})
    assert bad_limit.status_code == 422
    assert _route_error_code(bad_limit) == "invalid_input"
    assert client.post("/api/materials", json={}).status_code == 422
    assert client.post("/api/claims", json={"title": "只有标题"}).status_code == 422
    record = _make_claim(db_session, "非法承担程度")
    bad = client.put(
        f"/api/claims/{record.id}",
        json={**CLAIM_PAYLOAD, "responsibility_level": "首席架构师"},
    )
    assert bad.status_code == 422 and _route_error_code(bad) == "invalid_input"
    with pytest.raises(ValueError):
        execute_tool(
            db_session,
            "update_claim",
            {"claim_id": record.id, "responsibility_level": "首席架构师"},
        )


def test_previews_are_the_same_as_legacy_preview_functions(db_session):
    from app.services.assistant_tools import previews

    material_preview = get_tool("create_material").preview
    assert material_preview is not None
    args = {"title": "预览资料"}
    assert material_preview(db_session, dict(args)).model_dump() == (
        previews.preview_create_material(db_session, dict(args)).model_dump()
    )
    material = _make_material(db_session, "预览目标", content="正文")
    update_args = {"material_id": material.id, "title": "新标题"}
    assert get_tool("update_material").preview(db_session, dict(update_args)).model_dump() == (
        previews.preview_update_material(db_session, dict(update_args)).model_dump()
    )
    claim_args = {"title": "预览条目", "source_fact": "事实"}
    assert get_tool("create_claim").preview(db_session, dict(claim_args)).model_dump() == (
        previews.preview_create_claim(db_session, dict(claim_args)).model_dump()
    )
    record = _make_claim(db_session, "预览条目")
    claim_update_args = {"claim_id": record.id, "boundary": "新边界"}
    assert get_tool("update_claim").preview(db_session, dict(claim_update_args)).model_dump() == (
        previews.preview_update_claim(db_session, dict(claim_update_args)).model_dump()
    )


def test_read_only_actions_do_not_write(client, db_session):
    material = _make_material(db_session, "只读资料")
    record = _make_claim(db_session, "只读条目")
    before = (db_session.query(Material).count(), db_session.query(ClaimRecord).count())
    execute_tool(db_session, "list_materials", {})
    execute_tool(db_session, "get_material", {"material_id": material.id})
    execute_tool(db_session, "get_claim", {"claim_id": record.id})
    client.get("/api/materials")
    client.get(f"/api/materials/{material.id}")
    client.get(f"/api/claims/{record.id}")
    db_session.expire_all()
    after = (db_session.query(Material).count(), db_session.query(ClaimRecord).count())
    assert before == after
