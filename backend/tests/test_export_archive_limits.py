# SPDX-License-Identifier: Apache-2.0
"""W19 原件归档上限（20）与归档列表/删除 API 的真实行为（be-export task-9）。

任务书要求把"归档上限 20、超限明确失败或淘汰"写成可复核的证据，而不是只写在文档里。
本文件钉住当前实现的口径：

- 第 1–20 份允许归档；**第 21 份拒绝新增**（不自动清理、不淘汰旧件），但成套导出本身
  仍成功——zip 照常返回，manifest 把这一份列进 ``failures`` 并写明原因。用户不会因为
  "归档满了"丢掉这次交付，也不会静默少存一份。
- 列表按 id 倒序（最新在前）；删除 API 先删文件再删行；删不存在/跨简历的 id → 404。
- 预设里的 ``max_artifacts_per_resume`` 只允许 1–20（越界 422）。
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from app.models.resume import ResumeRecord
from app.models.resume_export import MAX_ARTIFACTS_PER_RESUME, ResumeExportArtifact
from app.services.resume import export_archive as archive_service

BUNDLE = "/api/resumes/{id}/export-bundle"


def _content() -> dict:
    return {
        "name": "张示例",
        "summary": "一段总结",
        "experience": [{"id": "expobj0001", "company": "示例科技有限公司", "role": "后端实习生"}],
    }


def _create_resume(client, title: str = "归档上限测试") -> int:
    response = client.post("/api/resumes/manual", json={"title": title, "content": _content()})
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _bundle_with_archive(client, resume_id: int, **body):
    payload = {"formats": ["md"], "archive_original": True, **body}
    return client.post(BUNDLE.format(id=resume_id), json=payload)


def _artifacts(db_session, resume_id: int) -> list[ResumeExportArtifact]:
    return (
        db_session.query(ResumeExportArtifact)
        .filter(ResumeExportArtifact.resume_id == resume_id)
        .order_by(ResumeExportArtifact.id)
        .all()
    )


def _zip_member_names(response) -> set[str]:
    return set(zipfile.ZipFile(io.BytesIO(response.content)).namelist())


@pytest.fixture(autouse=True)
def archive_dir(tmp_path, monkeypatch):
    """每个用例的归档根改到 tmp_path：绝不在共享测试库目录留真实文件。

    归档是**真实落盘**的（archive_original=True），而 conftest 的 clean_db 只重建数据库、
    不清磁盘。若让文件写进「<测试库目录>/export_archive/」，同一进程里后续用例会被上个
    用例的残留污染——例如 test_export_bundle 的「未开归档时目录应为空」断言会变成纯顺序
    依赖（-n auto 下偶发）。这里把 export_archive 的唯一根换成本用例独立的 tmp_path。
    """
    directory = tmp_path / "export_archive"
    monkeypatch.setattr(archive_service, "archive_root", lambda _bind: directory)
    return directory


def test_twentieth_artifact_is_accepted_and_twenty_first_is_refused(
    client, db_session, archive_dir
):
    """上限是 20：第 20 份成功，第 21 份**拒绝新增但交付不丢**（明确失败，不静默丢）。"""
    resume_id = _create_resume(client)
    for _ in range(MAX_ARTIFACTS_PER_RESUME):
        response = _bundle_with_archive(client, resume_id)
        assert response.status_code == 200, response.text
        assert not json.loads(zipfile.ZipFile(io.BytesIO(response.content)).read("manifest.json"))[
            "failures"
        ]
    assert len(_artifacts(db_session, resume_id)) == MAX_ARTIFACTS_PER_RESUME

    before_files = sorted(path.name for path in archive_dir.iterdir())
    overflow = _bundle_with_archive(client, resume_id)

    assert overflow.status_code == 200, overflow.text
    archive = zipfile.ZipFile(io.BytesIO(overflow.content))
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["format_count"] == 1
    assert any("归档数量已达上限" in item["error"] for item in manifest["failures"])
    # 第 21 份没有落盘：行数/磁盘文件都还是 20。
    assert len(_artifacts(db_session, resume_id)) == MAX_ARTIFACTS_PER_RESUME
    after_files = sorted(path.name for path in archive_dir.iterdir())
    assert after_files == before_files
    # 交付本身仍然完整：zip 里有这一份 md 与说明。
    assert "manifest.json" in _zip_member_names(overflow)
    assert any(name.endswith(".md") for name in _zip_member_names(overflow))


def test_service_level_save_artifact_refuses_the_21st_row(client, db_session, archive_dir):
    """绕过 HTTP 也拒绝：上限在唯一归档实现 ``save_artifact`` 里，不是路由层的装饰。"""
    resume_id = _create_resume(client)
    for _ in range(MAX_ARTIFACTS_PER_RESUME):
        response = _bundle_with_archive(client, resume_id)
        assert response.status_code == 200, response.text
    record = db_session.get(ResumeRecord, resume_id)
    assert record is not None
    # 20 行归档、但盘上只有 1 个文件：同字节产物共享内容寻址磁盘名（去重，不是丢失）。
    assert len(list(archive_dir.iterdir())) == 1
    assert len(_artifacts(db_session, resume_id)) == MAX_ARTIFACTS_PER_RESUME

    with pytest.raises(ValueError, match="归档数量已达上限"):
        archive_service.save_artifact(
            db_session,
            record=record,
            content=b"overflow-bytes",
            filename="overflow.md",
            export_format="md",
        )


def test_shared_disk_file_survives_until_last_reference_is_deleted(client, db_session, archive_dir):
    """同一份字节的两次导出共享一个内容寻址文件：删一条行不能把文件删掉。

    否则另一条归档会变成"有行无文件"的悬空记录（列表还在、点开 404）。
    """
    resume_id = _create_resume(client)
    for _ in range(2):
        assert _bundle_with_archive(client, resume_id).status_code == 200
    rows = _artifacts(db_session, resume_id)
    assert len(rows) == 2
    assert rows[0].disk_name == rows[1].disk_name  # 内容寻址去重
    stored = archive_dir / rows[0].disk_name
    assert stored.is_file()

    # 删较新的一条：文件仍被另一条引用，必须保留。
    assert (
        client.delete(f"/api/resumes/{resume_id}/export-artifacts/{rows[1].id}").status_code == 204
    )
    assert stored.is_file()
    assert len(_artifacts(db_session, resume_id)) == 1

    # 删最后一条：文件才真正删除。
    assert (
        client.delete(f"/api/resumes/{resume_id}/export-artifacts/{rows[0].id}").status_code == 204
    )
    assert not stored.exists()


def test_artifact_list_is_newest_first_and_delete_api_removes_file(client, db_session, archive_dir):
    resume_id = _create_resume(client)
    # 两份产物用不同格式，保证是**不同的磁盘文件**（同字节会共享内容寻址文件，见上一条）。
    assert _bundle_with_archive(client, resume_id, formats=["md"]).status_code == 200
    assert _bundle_with_archive(client, resume_id, formats=["txt"]).status_code == 200
    rows = _artifacts(db_session, resume_id)
    assert len(rows) == 2
    first, second = rows
    first_file = archive_dir / first.disk_name
    second_file = archive_dir / second.disk_name
    assert first_file.is_file() and second_file.is_file()

    listed = client.get(f"/api/resumes/{resume_id}/export-artifacts").json()["items"]
    assert [item["id"] for item in listed] == [second.id, first.id]  # 最新在前

    deleted = client.delete(f"/api/resumes/{resume_id}/export-artifacts/{second.id}")
    assert deleted.status_code == 204, deleted.text
    assert not second_file.exists()
    assert first_file.is_file()
    assert [
        item["id"]
        for item in client.get(f"/api/resumes/{resume_id}/export-artifacts").json()["items"]
    ] == [first.id]

    # 已删除 → 404；跨简历的 id 也 404（不能靠猜 id 删别人的原件）。
    assert (
        client.delete(f"/api/resumes/{resume_id}/export-artifacts/{second.id}").status_code == 404
    )
    other_resume = _create_resume(client, title="别的简历")
    assert (
        client.delete(f"/api/resumes/{other_resume}/export-artifacts/{first.id}").status_code == 404
    )
    assert first_file.is_file()  # 跨简历删除没有副作用


def test_preset_archive_limit_is_bounded_to_1_20(client):
    def create_preset(**body):
        return client.post(
            "/api/resumes/export-presets",
            json={"name": "归档上限预设", "config": {"formats": ["md"], **body}},
        )

    too_many = create_preset(max_artifacts_per_resume=21)
    assert too_many.status_code == 422, too_many.text
    zero = create_preset(max_artifacts_per_resume=0)
    assert zero.status_code == 422, zero.text
    allowed = create_preset(max_artifacts_per_resume=1)
    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["config"]["max_artifacts_per_resume"] == 1
