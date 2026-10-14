"""The primary database can be an extra archive dataset when a different one is active."""

import io
import json
import zipfile


def test_export_all_from_an_imported_dataset_roundtrips_main_as_an_extra(client):
    assert client.post("/api/jobs", json={"title": "虚构主数据记录"}).status_code == 201
    created = client.post("/api/settings/datasets", json={"name": "虚构其他数据集"})
    assert created.status_code == 200
    dataset_id = created.json()["id"]
    assert client.post(f"/api/settings/datasets/{dataset_id}/activate").status_code == 200
    assert client.post("/api/jobs", json={"title": "虚构当前记录"}).status_code == 201
    response = client.get("/api/settings/datasets/export-all")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert "datasets/main.db" in archive.namelist()
        assert any(entry["id"] == "main" for entry in manifest["datasets"])
    imported = client.post(
        "/api/settings/datasets/import?name=虚构完整恢复",
        headers={"Content-Type": "application/zip"},
        content=response.content,
    )
    assert imported.status_code == 200, imported.text
    restored = imported.json()["restored_datasets"]
    assert len(restored) == 1
    assert restored[0]["id"] != "main"
    assert client.post(f"/api/settings/datasets/{restored[0]['id']}/activate").status_code == 200
    assert client.get("/api/jobs").json()["items"][0]["title"] == "虚构主数据记录"
