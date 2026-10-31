# SPDX-License-Identifier: Apache-2.0
"""Historical DB anchors remain readable without destructive migrations."""

import copy

from app.models.provenance import ResumeBlockSource, ResumeFactLock
from app.models.resume import ResumeRecord
from app.services.resume.content_locks import validate_content_locks_for
from app.services.resume.document_io import ensure_document_version
from app.services.resume.document_paths import read_document_value
from app.services.resume.document_provenance import upsert_source
from app.services.resume.document_provenance_adopt import adopt_source_text
from app.services.resume.document_provenance_view import provenance_view, source_chain
from app.services.resume.fact_locks import (
    create_fact_lock,
    normalize_lock_value,
    validate_fact_locks,
)
from app.services.resume.review_annotations import resolve_anchor
from tests.document_export_samples import make_document


def _record(db_session, document=None):
    record = ResumeRecord(title="Historical anchors", content=document or make_document())
    db_session.add(record)
    db_session.commit()
    return record


def _old_link(db_session, record):
    snapshot = upsert_source(
        db_session,
        kind="manual",
        external_ref=None,
        title="Synthetic old source",
        payload="Updated synthetic delivery text",
    )
    link = ResumeBlockSource(
        resume_id=record.id,
        source_id=snapshot.source.id,
        source_revision_id=snapshot.revision.id,
        source_fingerprint=snapshot.revision.fingerprint,
        object_id=None,
        point_id=None,
        path="projects.0.description.0",
        field="projects",
    )
    db_session.add(link)
    db_session.commit()
    return link


def test_old_path_only_source_is_visible_through_native_paths_without_updating_rows(db_session):
    record = _record(db_session)
    link = _old_link(db_session, record)
    original = copy.deepcopy(record.content)
    view = provenance_view(db_session, record)
    target = next(o for o in view["objects"] if o["path"] == "projects.ob_prj000001.it_prj000007")
    assert target["link"]["link_id"] == link.id
    chain = source_chain(db_session, record, path=target["path"])
    assert chain["sources"] and chain["sources"][0]["id"] == link.source_id
    db_session.expire_all()
    assert db_session.get(ResumeBlockSource, link.id).path == "projects.0.description.0"
    assert db_session.get(ResumeRecord, record.id).content == original


def test_old_path_only_adoption_preserves_hidden_and_all_other_native_items(db_session):
    record = _record(db_session)
    link = _old_link(db_session, record)
    expected = copy.deepcopy(record.content)
    expected["sections"][1]["entries"][0]["items"][-1]["value"] = "Updated synthetic delivery text"
    result = adopt_source_text(
        db_session,
        record=record,
        link=link,
        text="Updated synthetic delivery text",
        expected_revision=record.revision,
    )
    normalized_expected = ensure_document_version(expected)
    assert result["content"] == normalized_expected
    assert result["applied_path"] == "projects.ob_prj000001.it_prj000007"


def test_old_relative_fact_lock_follows_identity_across_reorder_without_rewriting_row(db_session):
    document = make_document()
    record = _record(db_session, document)
    lock = ResumeFactLock(
        resume_id=record.id,
        object_id="ob_prj000001",
        point_id=None,
        path="projects.0.name",
        relative_path="name",
        field="name",
        lock_kind="institution",
        locked_value="校园招聘会策划",
        label="Old title",
    )
    db_session.add(lock)
    db_session.commit()
    assert validate_fact_locks(db_session, record, copy.deepcopy(document)) == []
    reordered = copy.deepcopy(document)
    other = copy.deepcopy(reordered["sections"][1]["entries"][0])
    other["id"] = "ob_other0001"
    for index, item in enumerate(other["items"]):
        item["id"] = f"it_other{index:04d}"
    other["items"][0]["value"] = "Other synthetic project"
    reordered["sections"][1]["entries"].insert(0, other)
    assert validate_fact_locks(db_session, record, reordered) == []
    assert lock.path == "projects.0.name"
    changed = copy.deepcopy(reordered)
    changed["sections"][1]["entries"][1]["items"][0]["value"] = "Different title"
    assert len(validate_fact_locks(db_session, record, changed)) == 1


def test_deleted_fact_lock_identity_never_falls_back_to_same_index_with_same_value(db_session):
    document = ensure_document_version(
        {
            "experience": [
                {"id": "ob_original01", "company": "Synthetic Company"},
                {"id": "ob_replaced01", "company": "Synthetic Company"},
            ],
        }
    )
    record = _record(db_session, document)
    lock = ResumeFactLock(
        resume_id=record.id,
        object_id="ob_original01",
        point_id=None,
        path="experience.0.company",
        relative_path="company",
        field="company",
        lock_kind="institution",
        locked_value="Synthetic Company",
        label="Original",
    )
    db_session.add(lock)
    db_session.commit()
    candidate = copy.deepcopy(document)
    candidate["sections"][0]["entries"].pop(0)
    violations = validate_fact_locks(db_session, record, candidate)
    assert len(violations) == 1 and "不存在" in violations[0].reason


def test_new_fact_lock_uses_native_anchor_and_date_half_remains_independent(db_session):
    record = _record(db_session)
    lock = create_fact_lock(db_session, record, path="projects.0.start_date")
    assert lock.path == "projects.ob_prj000001.it_prj000003.start_date"
    assert lock.object_id == "ob_prj000001" and lock.point_id == "it_prj000003"
    assert validate_fact_locks(db_session, record, record.content) == []
    candidate = copy.deepcopy(record.content)
    candidate["sections"][1]["entries"][0]["items"][2]["value"] = "2024-03|2025-01"
    assert validate_fact_locks(db_session, record, candidate) == []
    assert read_document_value(candidate, lock.path) == "2024-03"


def test_mixed_version_content_lock_keeps_hidden_entry_protected():
    old = {
        "experience": [
            {
                "id": "ob_hidden0001",
                "company": "Hidden",
                "description": ["Hidden original"],
                "hidden": True,
                "lock_content": True,
            }
        ]
    }
    document = ensure_document_version(old)
    assert validate_content_locks_for(old, document) == []
    candidate = copy.deepcopy(document)
    candidate["sections"][0]["entries"][0]["items"][-1]["text"] = "Changed hidden fact"
    assert len(validate_content_locks_for(old, candidate)) == 1


def test_annotation_native_identity_resolves_and_deleted_identity_stays_stale():
    document = make_document()
    hit, path, object_id, point_id = resolve_anchor(document, "ob_prj000001", "it_prj000007", None)
    assert hit and path == "projects.ob_prj000001.it_prj000007"
    assert object_id == "ob_prj000001" and point_id == "it_prj000007"
    assert resolve_anchor(document, "ob_missing001", None, "projects.0")[0] is False


def test_old_aggregate_fact_lock_compares_facts_without_a_full_legacy_projection(db_session):
    old_entry = {"id": "ob_aggregate01", "company": "Synthetic Company", "description": ["A" * 700]}
    document = ensure_document_version({"experience": [old_entry]})
    record = _record(db_session, document)
    lock = ResumeFactLock(
        resume_id=record.id,
        object_id=old_entry["id"],
        point_id=None,
        path="experience.0",
        relative_path="",
        field="experience",
        lock_kind="institution",
        locked_value=normalize_lock_value(old_entry),
    )
    db_session.add(lock)
    db_session.commit()
    assert len(lock.locked_value) == 500
    assert validate_fact_locks(db_session, record, document) == []
    candidate = copy.deepcopy(document)
    candidate["sections"][0]["entries"][0]["items"][0]["value"] = "Changed company"
    assert len(validate_fact_locks(db_session, record, candidate)) == 1
    candidate = copy.deepcopy(document)
    candidate["sections"][0]["entries"][0]["items"][-1]["text"] = "Changed start" + "A" * 700
    assert len(validate_fact_locks(db_session, record, candidate)) == 1
