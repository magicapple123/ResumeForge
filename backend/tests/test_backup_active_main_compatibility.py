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
        # R16 起整包是嵌套结构：当前活动的「虚构其他数据集」在 datasets/main.zip 里，
        # 原主数据以 datasets/<id>.zip 随包走。
        assert "datasets/main.zip" in archive.namelist()
        assert any(entry["id"] == "main" for entry in manifest["datasets"])
        assert any(entry["id"] == dataset_id for entry in manifest["datasets"])
    imported = client.post(
        "/api/settings/datasets/import?name=虚构完整恢复",
        headers={"Content-Type": "application/zip"},
        content=response.content,
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    restored = body["restored"]
    assert len(restored) == 2
    main_back = next(item for item in restored if item["source_id"] == "main")
    assert main_back["id"] != "main"
    # 界面说的"主数据集"是导出时正在用的那份（不是注册表里的 main）。
    assert body["id"] == next(item for item in restored if item["source_id"] == dataset_id)["id"]
    assert body["name"] == "虚构其他数据集"
    assert [item["name"] for item in body["restored_datasets"]] == ["主数据"]
    assert client.post(f"/api/settings/datasets/{main_back['id']}/activate").status_code == 200
    assert client.get("/api/jobs").json()["items"][0]["title"] == "虚构主数据记录"
