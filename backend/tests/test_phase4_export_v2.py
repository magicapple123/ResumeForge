# SPDX-License-Identifier: Apache-2.0
"""Native document contracts for export gates, bundles and offline shares."""

import io
import json
import zipfile

from app.services.resume.document_view import header_text
from app.services.resume.resume_delivery import canonical_content_sha256
from tests.document_export_samples import make_document


def _resume(client, document):
    response = client.post(
        "/api/resumes/manual", json={"content": document, "title": "Native export"}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_bundle_hash_and_json_keep_native_document(client):
    record = _resume(client, make_document())
    response = client.post(
        f"/api/resumes/{record['id']}/export-bundle", json={"formats": ["json", "txt"]}
    )
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        name = next(row["name"] for row in manifest["files"] if row["format"] == "json")
        document = json.loads(archive.read(name))
    assert manifest["snapshot"]["content_sha256"] == canonical_content_sha256(record["content"])
    project = next(s for s in document["sections"] if s["key"] == "projects")
    assert project["entries"][0]["layout"]["head"] == "stacked"
    url = next(i for i in project["entries"][0]["items"] if i.get("key") == "public_url")
    assert url["placement"] == "trail"
    assert manifest["target"]["contact_present"] is True


def test_share_snapshot_is_native_redacted_and_has_no_hidden_data(client):
    record = _resume(client, make_document())
    response = client.post(
        "/api/share-packages", json={"resume_id": record["id"], "permission": "read_only"}
    )
    assert response.status_code == 201, response.text
    snapshot = response.json()["snapshot"]
    assert snapshot["version"] == 2
    assert header_text(snapshot, "phone") == "***"
    encoded = json.dumps(snapshot, ensure_ascii=False)
    for private in ("隐藏大学", "秘密字段", "隐藏要点", "data:image/"):
        assert private not in encoded
    assert client.get(f"/api/resumes/{record['id']}").json()["content"] == record["content"]


def test_export_gate_scans_custom_sections_but_skips_hidden_items(client):
    document = make_document()
    document["sections"].append(
        {
            "key": "custom_phase4",
            "title": "Custom",
            "kind": "entries",
            "entries": [
                {
                    "id": "ob_custom0001",
                    "items": [
                        {"kind": "text", "id": "pt_custom0001", "text": "【待补：证据】"},
                    ],
                },
            ],
        }
    )
    record = _resume(client, document)
    url = f"/api/resumes/{record['id']}/export"
    response = client.post(url, json={"format": "txt"})
    assert response.status_code == 409, response.text
    assert "Custom 第 1 条 里还有「【待补」" in response.json()["detail"]
    document["sections"][-1]["entries"][0]["items"][0]["hidden"] = True
    response = client.post(url, json={"format": "txt", "content": document})
    assert response.status_code == 200, response.text
    assert "【待补：证据】" not in response.text
