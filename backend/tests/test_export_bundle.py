# SPDX-License-Identifier: Apache-2.0
"""W19 成套导出 + 原件归档：快照一致性/独立失败/归档哈希/删除/路径安全/备份包含。"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

from app.models.resume_delivery import ResumeDeliveryRecord
from app.models.resume_export import ResumeExportArtifact
from app.services.data_backup import MANIFEST_MEMBER, create_backup_archive
from app.services.resume.export_archive import archive_root
from app.services.resume.resume_delivery import canonical_content_sha256


def _content() -> dict:
    return {
        "name": "张示例",
        "summary": "一段总结",
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技有限公司",
                "role": "后端实习生",
                "description": ["负责合成数据接口"],
            }
        ],
    }


def _create_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual", json={"title": "导出包测试", "content": _content()}
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _bundle(client, resume_id: int, **body):
    payload = {"formats": ["json", "md", "txt"], **body}
    return client.post(f"/api/resumes/{resume_id}/export-bundle", json=payload)


def _zip(response) -> tuple[zipfile.ZipFile, bytes]:
    raw = response.content
    return zipfile.ZipFile(io.BytesIO(raw)), raw


def test_bundle_zip_manifest_hashes_match_files(client):
    resume_id = _create_resume(client)
    response = _bundle(client, resume_id)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/zip")
    archive, raw = _zip(response)
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["format_count"] == 3
    assert manifest["failures"] == []
    names = set(archive.namelist())
    for item in manifest["files"]:
        assert item["name"] in names
        digest = hashlib.sha256(archive.read(item["name"])).hexdigest()
        # 逐项哈希链：包内字节 == manifest.sha256 == size（不是 `or True` 恒真式）。
        assert digest == item["sha256"], item["name"]
        assert item["size"] == len(archive.read(item["name"])), item["name"]
        assert item["render_config_sha256"]
    # 响应头是**快照内容指纹**（路由契约），必须是 manifest 里声明的那一个。
    assert manifest["snapshot"]["content_sha256"] == response.headers["X-Content-Sha256"]
    assert "说明.txt" in names


def test_bundle_manifest_records_real_resources(client):
    """W19 资源清单真实化：每个产物都带 font / renderer / template，且与当前配置一致。"""
    from app.config import get_settings

    resume_id = _create_resume(client)
    response = _bundle(client, resume_id, formats=["md", "docx"])

    assert response.status_code == 200, response.text
    archive, _raw = _zip(response)
    manifest = json.loads(archive.read("manifest.json"))
    detail = client.get(f"/api/resumes/{resume_id}").json()
    app_version = get_settings().app_version
    by_format = {item["format"]: item for item in manifest["files"]}
    assert set(by_format) == {"md", "docx"}

    for item in manifest["files"]:
        assert item["template"]
        renderer = item["renderer"]
        assert renderer["name"], item["format"]
        assert renderer["version"], item["format"]
        assert renderer["app_version"] == app_version
        assert renderer["template"] == item["template"] == detail["template"]
        font = item["font"]
        assert font["font_scale"] == detail["font_scale"]
        assert isinstance(font["available"], bool)
        assert isinstance(font["embedded"], bool)

    # Word：族名来自真实字体解析（非空），且如实标注"不嵌字体"。
    assert by_format["docx"]["renderer"]["name"] == "python-docx"
    assert by_format["docx"]["font"]["family"]
    assert by_format["docx"]["font"]["embedded"] is False
    # 纯文本格式没有字体概念：不编造族名。
    assert by_format["md"]["font"]["applicable"] is False
    assert by_format["md"]["font"]["family"] is None

    # 包级资源摘要同样来自真实上下文，不是空字典。
    top = manifest["resource_manifest"]
    assert top["app_version"] == app_version
    assert top["template"] == detail["template"]
    assert top["font"]["family"]
    assert top["render_config_sha256"]


def test_bundle_uses_draft_content_without_writing(client):
    resume_id = _create_resume(client)
    before = client.get(f"/api/resumes/{resume_id}").json()["content"]["summary"]
    draft = _content()
    draft["summary"] = "DRAFT-MARKER 草稿总结"

    response = _bundle(client, resume_id, formats=["md"], content=draft)

    assert response.status_code == 200, response.text
    archive, _raw = _zip(response)
    assert "DRAFT-MARKER 草稿总结" in archive.read(
        next(name for name in archive.namelist() if name.endswith(".md"))
    ).decode("utf-8")
    # 不落库：记录正文没变。
    assert client.get(f"/api/resumes/{resume_id}").json()["content"]["summary"] == before
    from app.schemas.resume import ResumeContent

    expected = canonical_content_sha256(ResumeContent.model_validate(draft).model_dump())
    assert response.headers["X-Content-Sha256"] == expected


def test_bundle_strict_revision_conflict_returns_409_without_zip(client):
    resume_id = _create_resume(client)
    current = client.get(f"/api/resumes/{resume_id}").json()["revision"]

    response = _bundle(
        client, resume_id, formats=["md"], resume_revision=current + 5, strict_revision=True
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "resume_revision_changed"
    assert "application/zip" not in response.headers.get("content-type", "")


def test_bundle_single_format_failure_does_not_fail_others(client, monkeypatch):
    resume_id = _create_resume(client)
    from app.services.resume import export_bundle as bundle_service

    original = bundle_service.build_export_delivery

    def _flaky(request, resume, context, *, source_resume_id):
        if request.format == "pdf":
            raise RuntimeError("字体缺失（合成失败）")
        return original(request, resume, context, source_resume_id=source_resume_id)

    monkeypatch.setattr(bundle_service, "build_export_delivery", _flaky)
    response = _bundle(client, resume_id, formats=["md", "pdf"])

    assert response.status_code == 200, response.text
    archive, _raw = _zip(response)
    manifest = json.loads(archive.read("manifest.json"))
    assert [item["format"] for item in manifest["files"]] == ["md"]
    assert [item["format"] for item in manifest["failures"]] == ["pdf"]


def test_archive_original_saves_bytes_and_backup_includes_them(client, db_session, tmp_path):
    resume_id = _create_resume(client)
    response = _bundle(client, resume_id, formats=["md"], archive_original=True)
    assert response.status_code == 200, response.text

    artifact = db_session.query(ResumeExportArtifact).one()
    root = archive_root(db_session.get_bind())
    stored = root / artifact.disk_name
    assert stored.is_file()
    assert hashlib.sha256(stored.read_bytes()).hexdigest() == artifact.sha256
    assert len(artifact.sha256) == 64
    listed = client.get(f"/api/resumes/{resume_id}/export-artifacts").json()["items"]
    assert [item["id"] for item in listed] == [artifact.id]

    # 备份包含 export_archive/ 段与成员（资产清单按 DB 引用收集）。
    # 先 checkpoint：本测试的会话与导出路由是不同连接，确保 WAL 内容已写回主库再交给备份快照。
    db_session.execute(__import__("sqlalchemy").text("PRAGMA wal_checkpoint(TRUNCATE)"))
    db_session.commit()
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    archive_path = create_backup_archive(db_session.get_bind(), backup_dir)
    with zipfile.ZipFile(archive_path) as backup:
        names = set(backup.namelist())
        manifest = json.loads(backup.read(MANIFEST_MEMBER))
        assert f"export_archive/{artifact.disk_name}" in names
        asset_section = manifest["asset_manifest"]["export_archive"]
        assert [entry["name"] for entry in asset_section] == [artifact.disk_name]
        assert asset_section[0]["sha256"] == artifact.sha256

    deleted = client.delete(f"/api/resumes/{resume_id}/export-artifacts/{artifact.id}")
    assert deleted.status_code == 204
    assert not stored.exists()
    assert client.get(f"/api/resumes/{resume_id}/export-artifacts").json()["items"] == []


def test_archive_delete_rejects_path_traversal(client, db_session):
    resume_id = _create_resume(client)
    root = archive_root(db_session.get_bind())
    outside = root.parent / "outside-evil.txt"
    outside.write_bytes(b"keep me")
    row = ResumeExportArtifact(resume_id=resume_id, disk_name="../../outside-evil.txt")
    db_session.add(row)
    db_session.commit()
    row_id = row.id

    response = client.delete(f"/api/resumes/{resume_id}/export-artifacts/{row_id}")

    assert response.status_code == 400
    assert outside.is_file()


def test_bundle_without_archive_does_not_freeze_or_write(client, db_session):
    resume_id = _create_resume(client)
    before_revision = client.get(f"/api/resumes/{resume_id}").json()["revision"]
    before_deliveries = db_session.query(ResumeDeliveryRecord).count()
    root = archive_root(db_session.get_bind())

    response = _bundle(client, resume_id, formats=["md"])
    assert response.status_code == 200
    after = client.get(f"/api/resumes/{resume_id}").json()
    assert after["revision"] == before_revision
    assert db_session.query(ResumeDeliveryRecord).count() == before_deliveries
    assert db_session.query(ResumeExportArtifact).count() == 0
    assert not (root.exists() and any(root.iterdir()))


def test_single_format_download_uses_draft_snapshot(client):
    """W19①：单格式下载支持当前草稿 content，与预览同一快照，不落库不冻结。"""
    resume_id = _create_resume(client)
    before = client.get(f"/api/resumes/{resume_id}").json()
    draft = _content()
    draft["summary"] = "DRAFT-DOWNLOAD-MARKER"

    response = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "md", "content": draft},
    )

    assert response.status_code == 200, response.text
    assert "DRAFT-DOWNLOAD-MARKER" in response.content.decode("utf-8")
    # 同名响应的 X-Content-Sha256 是**产物字节**指纹（交付指纹），与预览同一口径。
    assert response.headers["X-Content-Sha256"] == hashlib.sha256(response.content).hexdigest()
    # 同一草稿 + 同一组参数再请求一次：字节与渲染配置指纹逐字一致（下载与预览同快照）。
    repeated = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "md", "content": draft},
    )
    assert repeated.content == response.content
    assert repeated.headers["X-Render-Config-Sha256"] == response.headers["X-Render-Config-Sha256"]
    after = client.get(f"/api/resumes/{resume_id}").json()
    assert after["content"]["summary"] == before["content"]["summary"]
    assert after["revision"] == before["revision"]
