# SPDX-License-Identifier: Apache-2.0
"""P5-1：手工来源登记扩展 kind / external_ref / payload 的契约。

红线（本文件逐条钉住）：

1. **只传 title 的旧请求行为逐字节不变**：kind=manual、external_ref=None、payload 仍是
   {"title": title}（指纹与历史一致，历史关联不会集体变 stale），且仍是每次新建。
2. 新字段落库并在来源列表/详情可见；带 external_ref 时按 (kind, external_ref) 复用，
   只有内容指纹变化才追加修订。
3. 非法 payload（类型/超长）与非法 external_ref 是 400；kind 走 pydantic Literal（422），
   与冻结的 POST /api/provenance/links 契约一致。
"""

from __future__ import annotations

from app.models.provenance import ResumeSource, ResumeSourceRevision
from app.services.resume.document_provenance import canonical_fingerprint


def _create_source(client, payload: dict):
    return client.post("/api/provenance/sources", json=payload)


def test_title_only_request_keeps_legacy_behaviour(client, db_session):
    """旧调用方只传 title：语义/指纹/每次新建三件事都不变。"""
    first = _create_source(client, {"title": "  旧调用方资料  "})
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["kind"] == "manual"
    assert body["external_ref"] is None
    assert body["title"] == "旧调用方资料"
    assert body["revision"]["revision_no"] == 1

    row = db_session.query(ResumeSource).filter(ResumeSource.id == body["id"]).one()
    # 旧默认 payload = {"title": 去掉首尾空白后的标题}：指纹必须与扩展前一致。
    assert row.current_fingerprint == canonical_fingerprint({"title": "旧调用方资料"})
    assert row.external_ref is None
    assert row.kind == "manual"

    second = _create_source(client, {"title": "旧调用方资料"})
    assert second.status_code == 201, second.text
    # 手工来源没有稳定业务行：旧行为是每次新建（NULL external_ref 互不相等）。
    assert second.json()["id"] != body["id"]
    assert db_session.query(ResumeSource).count() == 2


def test_new_fields_are_persisted_and_use_payload_fingerprint(client, db_session):
    response = _create_source(
        client,
        {
            "title": "资料箱里的项目原始描述",
            "kind": "material",
            "external_ref": "material:doc-001",
            "payload": "  原始项目描述（只进指纹，不落全文）  ",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kind"] == "material"
    assert body["external_ref"] == "material:doc-001"
    assert body["revision"]["summary"] == "资料箱里的项目原始描述"

    row = db_session.query(ResumeSource).filter(ResumeSource.id == body["id"]).one()
    assert (row.kind, row.external_ref) == ("material", "material:doc-001")
    # canonical_fingerprint 对字符串先 strip：指纹就是 payload 原文的指纹。
    assert row.current_fingerprint == canonical_fingerprint("原始项目描述（只进指纹，不落全文）")
    # 来源表只存摘要/指纹，不落 payload 全文，也不把 payload 塞进 metadata。
    assert row.metadata_json == {}

    listed = client.get("/api/provenance/sources").json()
    item = next(entry for entry in listed["items"] if entry["id"] == body["id"])
    assert item["kind"] == "material"
    assert item["external_ref"] == "material:doc-001"

    detail = client.get(f"/api/provenance/sources/{body['id']}").json()
    assert detail["latest_revision_no"] == 1
    assert len(detail["revisions"]) == 1


def test_external_ref_reuses_source_and_only_appends_on_fingerprint_change(client, db_session):
    payload = {
        "title": "岗位资料",
        "kind": "job",
        "external_ref": "job:42",
        "payload": "岗位原始 JD 摘要",
    }
    first = _create_source(client, payload)
    second = _create_source(client, payload)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["revision"]["revision_no"] == 1
    assert db_session.query(ResumeSourceRevision).count() == 1

    changed = _create_source(client, {**payload, "payload": "岗位原始 JD 摘要（更新）"})
    assert changed.status_code == 201, changed.text
    assert changed.json()["id"] == first.json()["id"]
    assert changed.json()["revision"]["revision_no"] == 2
    revisions = client.get(f"/api/provenance/sources/{first.json()['id']}/revisions").json()
    assert [item["revision_no"] for item in revisions["revisions"]] == [1, 2]


def test_invalid_payload_and_external_ref_are_client_errors(client):
    bad_type = _create_source(client, {"title": "x", "payload": 123})
    assert bad_type.status_code == 400
    assert "文本" in bad_type.json()["detail"]

    too_long = _create_source(client, {"title": "x", "payload": "a" * 2001})
    assert too_long.status_code == 400
    assert "2000" in too_long.json()["detail"]

    nested = _create_source(client, {"title": "x", "payload": {"a": 1}})
    assert nested.status_code == 400

    # external_ref 上限沿用既有 SourceInput 的 pydantic 契约（422），不是新错误码。
    long_ref = _create_source(client, {"title": "x", "external_ref": "r" * 65})
    assert long_ref.status_code == 422

    blank_ref = _create_source(client, {"title": "x", "external_ref": "   "})
    assert blank_ref.status_code == 400

    blank_title = _create_source(client, {"title": "   "})
    assert blank_title.status_code == 400


def test_kind_is_validated_like_the_frozen_link_contract(client):
    invalid = _create_source(client, {"title": "x", "kind": "unknown"})
    assert invalid.status_code == 422
    phrase = _create_source(client, {"title": "收藏表达", "kind": "phrase"})
    assert phrase.status_code == 201, phrase.text
    assert phrase.json()["kind"] == "phrase"


def test_new_source_can_be_linked_immediately(client):
    """P5-1 仍走「先建来源 → 再 /links」，不新增第二套写入链路。"""
    created = _create_source(
        client,
        {
            "title": "可关联的新来源",
            "kind": "profile",
            "external_ref": "profile:summary",
            "payload": "个人资料摘要",
        },
    ).json()
    resume = client.post(
        "/api/resumes/manual",
        json={
            "title": "P5-1 来源关联",
            "content": {
                "name": "合成样本",
                "experience": [{"id": "expobj0001", "company": "示例公司"}],
            },
        },
    )
    assert resume.status_code in (200, 201), resume.text
    linked = client.post(
        "/api/provenance/links",
        json={
            "resume_id": resume.json()["id"],
            "source_id": created["id"],
            "object_id": "expobj0001",
        },
    )
    assert linked.status_code == 201, linked.text
    assert linked.json()["source_id"] == created["id"]
