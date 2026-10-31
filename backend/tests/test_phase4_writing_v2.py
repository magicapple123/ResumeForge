# SPDX-License-Identifier: Apache-2.0
"""Native edits preserve identity, hidden data and layout."""

import copy
import json

import pytest
from app.services.resume.document_io import ensure_document_version
from app.services.resume.document_paths import (
    identity_path,
    read_document_value,
    resolve_document_path,
    write_document_value,
)
from app.services.resume.resume_revision import revise_resume
from tests.document_export_samples import make_document


def test_old_paths_resolve_to_native_nodes_without_a_projection():
    document = ensure_document_version(
        {
            "name": "Synthetic",
            "job_intent": "Engineer",
            "experience": [
                {
                    "id": "ob_compat001",
                    "company": "Example",
                    "start_date": "2020-01",
                    "end_date": "2021-02",
                    "description": ["First", "Second"],
                    "point_ids": {"description": ["pt_compat001", "pt_compat002"]},
                }
            ],
        }
    )
    before = copy.deepcopy(document)
    target = resolve_document_path(document, "experience.0.description.1")
    assert target.path == "experience.ob_compat001.pt_compat002"
    assert target.read() == "Second"
    assert read_document_value(document, "experience.0.start_date") == "2020-01"
    assert read_document_value(document, "job_intent") == "Engineer"
    assert document == before
    assert identity_path(document, "ob_missing00", "pt_compat001") is None
    assert write_document_value(document, target.path, "Updated")
    assert read_document_value(document, "experience.0.description.1") == "Updated"
    assert write_document_value(document, "experience.0.end_date", "2025-03")
    assert read_document_value(document, "experience.0.start_date") == "2020-01"
    assert read_document_value(document, "experience.0.end_date") == "2025-03"


def test_phrase_insert_preserves_all_existing_native_items(client):
    document = make_document()
    response = client.post(
        "/api/resumes/manual", json={"title": "Synthetic native phrases", "content": document}
    )
    assert response.status_code == 201, response.text
    record = response.json()
    phrase = client.post(
        "/api/resume-phrases", json={"text": "New synthetic achievement", "kind": "achievement"}
    ).json()
    response = client.post(
        f"/api/resume-phrases/{phrase['id']}/insert",
        json={
            "resume_id": record["id"],
            "section": "projects",
            "entry_id": "ob_prj000001",
            "expected_revision": record["revision"],
        },
    )
    assert response.status_code == 200, response.text
    content = response.json()["resume"]["content"]
    for old_section, new_section in zip(
        record["content"]["sections"], content["sections"], strict=True
    ):
        assert old_section["key"] == new_section["key"]
        for old_entry, new_entry in zip(
            old_section["entries"], new_section["entries"], strict=True
        ):
            for old_item in old_entry["items"]:
                assert next(i for i in new_entry["items"] if i["id"] == old_item["id"]) == old_item
    assert response.json()["inserted_point_id"]


def test_old_list_and_label_paths_keep_their_values_without_a_document_projection():
    document = make_document()
    original = copy.deepcopy(document)
    assert read_document_value(document, "projects.0.tech_stack") == ["Python", "SQL", "秘密值"]
    assert read_document_value(document, "projects.ob_prj000001.it_prj000004") == ["Python", "SQL"]
    assert document == original
    field = document["sections"][1]["entries"][0]["items"][-1]
    field["label"] = "说明"
    assert read_document_value(document, "projects.0.description.0") == "说明：" + field["value"]
    assert read_document_value(document, "projects.ob_prj000001.it_prj000007") == field["value"]


def test_invalid_group_write_and_overlong_legacy_path_leave_document_unchanged():
    document = make_document()
    document["sections"][1]["entries"][0]["items"].append(
        {"kind": "text", "id": "pt_atomic0001", "text": "Existing second point"}
    )
    original = copy.deepcopy(document)
    assert not write_document_value(document, "projects.0.description", ["Changed", 123])
    assert resolve_document_path(document, "projects.0.description.0.extra") is None
    assert document == original


@pytest.mark.asyncio
async def test_native_revision_only_updates_requested_values_and_keeps_metadata():
    original = make_document()
    original_before = copy.deepcopy(original)
    captured = []

    class Provider:
        async def chat(self, messages, **kwargs):
            captured.extend(messages)
            return json.dumps(
                {
                    "updates": [
                        {
                            "path": "summary.ob_sum000001.pt_sum000001",
                            "value": "Rewritten synthetic summary",
                        }
                    ]
                }
            )

    revised = await revise_resume(Provider(), original, None, "Rewrite the summary")
    expected = copy.deepcopy(original)
    expected["sections"][-1]["entries"][0]["items"][0]["text"] = "Rewritten synthetic summary"
    assert revised == expected
    assert original == original_before
    prompt = json.dumps(captured, ensure_ascii=False)
    for private in ("陈可", "13800000000", "chen@example.com", "秘密字段", "隐藏要点"):
        assert private not in prompt
