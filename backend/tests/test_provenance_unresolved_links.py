# SPDX-License-Identifier: Apache-2.0
"""P5-2：无法定位的旧来源关联只读暴露（不迁移、不改写、不猜目标）。

旧行兼容设计见 runtime/investigation/phase4/B4-path-compatibility-design.md：
数据库列、迁移与历史行都不动；读侧这次只**增加**一个 unresolved_links 字段，
让「有一条旧关联失效了」在界面可见，用户自己删除或重新关联。
"""

from __future__ import annotations

import copy

from app.models.provenance import ResumeBlockSource
from app.models.resume import ResumeRecord
from app.services.resume.document_provenance import upsert_source
from app.services.resume.document_provenance_view import provenance_view
from tests.document_export_samples import make_document


def _record(db_session, document=None):
    record = ResumeRecord(title="P5-2 unresolved", content=document or make_document())
    db_session.add(record)
    db_session.commit()
    return record


def _source(db_session, title: str = "旧资料"):
    return upsert_source(
        db_session,
        kind="manual",
        external_ref=None,
        title=title,
        payload="old synthetic body",
    )


def _link(
    db_session,
    record,
    snapshot,
    *,
    path: str,
    object_id: str | None = None,
    field: str = "projects",
):
    link = ResumeBlockSource(
        resume_id=record.id,
        source_id=snapshot.source.id,
        source_revision_id=snapshot.revision.id,
        source_fingerprint=snapshot.revision.fingerprint,
        object_id=object_id,
        point_id=None,
        path=path,
        field=field,
    )
    db_session.add(link)
    db_session.commit()
    return link


def test_unresolvable_legacy_link_is_exposed_without_touching_the_row(db_session):
    record = _record(db_session)
    snapshot = _source(db_session)
    link = _link(db_session, record, snapshot, path="projects.9.description.0")
    original_content = copy.deepcopy(record.content)

    view = provenance_view(db_session, record)

    assert len(view["unresolved_links"]) == 1
    item = view["unresolved_links"][0]
    assert item["link_id"] == link.id
    assert item["source_id"] == snapshot.source.id
    assert item["source_title"] == "旧资料"
    assert item["source_kind"] == "manual"
    assert item["path"] == "projects.9.description.0"
    assert item["reason"] == "target_missing"
    # 失效关联不算「已关联」，也不被塞给任何块（不猜目标）。
    assert view["coverage"]["linked"] == 0
    assert all(entry["link"] is None for entry in view["objects"])

    # 旧行与正文一个字节都不改：GET 视图不会迁移历史数据。
    db_session.expire_all()
    assert db_session.get(ResumeBlockSource, link.id).path == "projects.9.description.0"
    assert db_session.get(ResumeRecord, record.id).content == original_content


def test_resolvable_legacy_path_still_maps_and_is_not_reported_unresolved(db_session):
    record = _record(db_session)
    snapshot = _source(db_session)
    link = _link(db_session, record, snapshot, path="projects.0.description.0")

    view = provenance_view(db_session, record)

    assert view["unresolved_links"] == []
    mapped = next(entry for entry in view["objects"] if entry["link"] is not None)
    assert mapped["link"]["link_id"] == link.id
    assert mapped["path"] != "projects.0.description.0"  # 映射到 v2 原生路径
    assert view["coverage"]["linked"] == 1


def test_unresolved_reason_codes_are_stable(db_session):
    record = _record(db_session)
    snapshot = _source(db_session)
    _link(db_session, record, snapshot, path="projects.0.description.0", object_id="bad id!")
    _link(db_session, record, snapshot, path="")

    view = provenance_view(db_session, record)

    reasons = sorted(item["reason"] for item in view["unresolved_links"])
    assert reasons == ["no_locator", "object_id_invalid"]
    for item in view["unresolved_links"]:
        assert item["source_title"] == "旧资料"


def test_api_response_adds_unresolved_links_and_keeps_existing_fields(client, db_session):
    resume = client.post(
        "/api/resumes/manual",
        json={
            "title": "P5-2 API",
            "content": {
                "name": "合成样本",
                "experience": [{"id": "expobj0001", "company": "示例公司"}],
            },
        },
    )
    assert resume.status_code in (200, 201), resume.text
    record = db_session.get(ResumeRecord, int(resume.json()["id"]))
    assert record is not None
    snapshot = _source(db_session)
    link = _link(db_session, record, snapshot, path="experience.7.company", field="experience")

    response = client.get(f"/api/provenance/resumes/{record.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    # 旧字段仍在（只增不改），新字段是一条可解释的失效关联。
    assert set(body) >= {"resume_id", "revision", "sources", "objects", "coverage"}
    assert body["unresolved_links"] == [
        {
            "link_id": link.id,
            "source_id": snapshot.source.id,
            "source_title": "旧资料",
            "source_kind": "manual",
            "object_id": None,
            "point_id": None,
            "path": "experience.7.company",
            "field": "experience",
            "reason": "target_missing",
        }
    ]
    # 旧客户端只读 coverage/objects 时行为不变。
    assert body["coverage"]["linked"] == 0
    assert body["sources"][0]["id"] == snapshot.source.id


def test_delete_unresolved_link_through_existing_endpoint(client, db_session):
    """出口复用现有 DELETE /links/{link_id}：不新增第二套删除链路。"""
    resume = client.post("/api/resumes/manual", json={"title": "P5-2 delete", "content": {}})
    assert resume.status_code in (200, 201), resume.text
    record = db_session.get(ResumeRecord, int(resume.json()["id"]))
    snapshot = _source(db_session)
    link = _link(db_session, record, snapshot, path="experience.7.company", field="experience")
    assert len(provenance_view(db_session, record)["unresolved_links"]) == 1

    deleted = client.delete(f"/api/provenance/resumes/{record.id}/links/{link.id}")
    assert deleted.status_code == 204
    assert provenance_view(db_session, record)["unresolved_links"] == []
