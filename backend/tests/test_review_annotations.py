# SPDX-License-Identifier: Apache-2.0
"""W18 离线对象批注：评审包、九步导入校验、去重、状态机、导出边界、隔离/备份。"""

from __future__ import annotations

import hashlib
import io
import json
import sqlite3
import zipfile
from contextlib import closing
from pathlib import Path

from app import database
from app.database_migrations import application_tables
from app.dataset_registry import dataset_database_file
from app.services.datasets import create_dataset


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
                "point_ids": {"description": ["pnt0000001"]},
            }
        ],
        "education": [{"id": "eduobj0001", "school": "示例大学"}],
    }


def _create_resume(client) -> int:
    response = client.post("/api/resumes/manual", json={"title": "批注测试", "content": _content()})
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _create_package(client, resume_id: int, permission: str = "comment") -> dict:
    response = client.post(
        "/api/share-packages", json={"resume_id": resume_id, "permission": permission}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _snapshot_sha(package: dict) -> str:
    payload = json.dumps(
        package["snapshot"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _annotation(**overrides) -> dict:
    item = {
        "external_id": "ext-0001",
        "object_id": "expobj0001",
        "point_id": None,
        "path": None,
        "field": None,
        "quoted_text": "负责合成数据接口",
        "text": "这条成果建议补一个量化数字",
        "created_at": "2026-10-24T10:00:00Z",
    }
    item.update(overrides)
    return item


def _payload(package: dict, annotations: list[dict], **overrides) -> str:
    data = {
        "format_version": 1,
        "kind": "resumeforge.review",
        "share_token": package["share_token"],
        "package_snapshot_sha256": _snapshot_sha(package),
        "resume_snapshot_sha256": "",
        "document_version_id": None,
        "reviewer": "评审人",
        "created_at": "2026-10-24T10:00:00Z",
        "annotations": annotations,
    }
    data.update(overrides)
    return json.dumps(data, ensure_ascii=False)


def _import(client, package_id: int, content: str):
    return client.post(
        f"/api/share-packages/{package_id}/annotations/import", json={"content": content}
    )


def test_import_resolves_object_and_path_anchors_and_marks_missing_stale(client):
    resume_id = _create_resume(client)
    package = _create_package(client, resume_id)

    response = _import(
        client,
        package["id"],
        _payload(
            package,
            [
                _annotation(external_id="ext-object"),
                _annotation(
                    external_id="ext-path",
                    object_id=None,
                    path="experience.0.description.0",
                ),
                _annotation(external_id="ext-gone", object_id="missing0001"),
            ],
        ),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["imported"] == 3
    assert body["stale"] == 1
    assert {item["external_id"]: item["status"] for item in body["annotations"]} == {
        "ext-object": "open",
        "ext-path": "open",
        "ext-gone": "stale",
    }
    listed = client.get(f"/api/share-packages/{package['id']}/annotations").json()
    assert len(listed["items"]) == 3
    assert listed["items"][0]["reviewer"] == "评审人"


def test_import_fail_closed_cases(client):
    resume_id = _create_resume(client)
    package = _create_package(client, resume_id)
    readonly = _create_package(client, resume_id, permission="read_only")

    assert _import(client, readonly["id"], _payload(readonly, [_annotation()])).status_code == 403
    wrong_token = _payload(package, [_annotation()], share_token="0" * 32)
    assert _import(client, package["id"], wrong_token).status_code == 403
    unknown_format = _payload(package, [_annotation()], format_version=2)
    assert _import(client, package["id"], unknown_format).status_code == 422
    assert _import(client, package["id"], "不是 JSON 的批注").status_code == 422
    too_long = _payload(package, [_annotation(text="x" * 2001)])
    assert _import(client, package["id"], too_long).status_code == 422
    bad_version = _payload(package, [_annotation()], document_version_id=9999)
    assert _import(client, package["id"], bad_version).status_code == 422
    # 全部校验失败后一行都不落库。
    assert client.get(f"/api/share-packages/{package['id']}/annotations").json()["items"] == []


def test_snapshot_mismatch_marks_everything_stale(client):
    resume_id = _create_resume(client)
    package = _create_package(client, resume_id)

    response = _import(
        client, package["id"], _payload(package, [_annotation()], package_snapshot_sha256="0" * 64)
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["stale"] == 1
    assert body["annotations"][0]["status"] == "stale"


def test_import_binds_to_named_version(client):
    from app.models.versions import ResumeVersion  # noqa: F401 - 仅确认可导入

    resume_id = _create_resume(client)
    version = client.post(f"/api/resumes/{resume_id}/versions", json={"name": "评审版本"}).json()
    package = _create_package(client, resume_id)

    response = _import(
        client,
        package["id"],
        _payload(package, [_annotation()], document_version_id=version["id"]),
    )

    assert response.status_code == 200, response.text
    assert response.json()["annotations"][0]["document_version_id"] == version["id"]


def test_reimport_deduplicates_and_preserves_resolved_state(client):
    resume_id = _create_resume(client)
    package = _create_package(client, resume_id)
    payload = _payload(package, [_annotation()])
    first = _import(client, package["id"], payload).json()
    annotation_id = first["annotations"][0]["id"]
    assert client.post(f"/api/resume-annotations/{annotation_id}/resolve").status_code == 200

    again = _import(client, package["id"], payload)

    assert again.status_code == 200, again.text
    body = again.json()
    assert body["imported"] == 0
    assert body["duplicates"] == 1
    listed = client.get(f"/api/share-packages/{package['id']}/annotations").json()["items"]
    assert listed[0]["status"] == "resolved"


def test_status_machine_resolve_reopen_dismiss_and_reattach(client):
    resume_id = _create_resume(client)
    package = _create_package(client, resume_id)
    imported = _import(
        client,
        package["id"],
        _payload(
            package,
            [_annotation(), _annotation(external_id="ext-stale", object_id="missing0001")],
        ),
    ).json()
    by_ext = {item["external_id"]: item for item in imported["annotations"]}
    open_id = by_ext["ext-0001"]["id"]
    stale_id = by_ext["ext-stale"]["id"]

    resolved = client.post(f"/api/resume-annotations/{open_id}/resolve").json()
    assert resolved["status"] == "resolved" and resolved["resolved_at"] is not None
    reopened = client.post(f"/api/resume-annotations/{open_id}/reopen").json()
    assert reopened["status"] == "open" and reopened["resolved_at"] is None
    assert client.post(f"/api/resume-annotations/{open_id}/dismiss").json()["status"] == "dismissed"
    # dismissed 是终态之一：不能再 resolve。
    assert client.post(f"/api/resume-annotations/{open_id}/resolve").status_code == 409

    # stale 只能 reattach 或 dismiss；直接 resolve → 409。
    assert client.post(f"/api/resume-annotations/{stale_id}/resolve").status_code == 409
    assert (
        client.post(f"/api/resume-annotations/{stale_id}/dismiss").json()["status"] == "dismissed"
    )

    second = _import(
        client,
        package["id"],
        _payload(
            package,
            [_annotation(external_id="ext-reattach", object_id="missing0001")],
        ),
    ).json()
    reattach_id = second["annotations"][0]["id"]
    bad = client.post(
        f"/api/resume-annotations/{reattach_id}/reattach",
        json={"object_id": "missing0001"},
    )
    assert bad.status_code == 422
    good = client.post(
        f"/api/resume-annotations/{reattach_id}/reattach",
        json={"object_id": "expobj0001"},
    )
    assert good.status_code == 200, good.text
    assert good.json()["status"] == "open"
    assert good.json()["object_id"] == "expobj0001"
    assert good.json()["path"] == "experience.0"


def test_review_package_zip_contains_template_and_instructions(client):
    resume_id = _create_resume(client)
    package = _create_package(client, resume_id)

    response = client.get(f"/api/share-packages/{package['id']}/review-package")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/zip")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        assert {"annotations.json", "说明.txt"} <= names
        template = json.loads(archive.read("annotations.json"))
    assert template["format_version"] == 1
    assert template["kind"] == "resumeforge.review"
    assert template["share_token"] == package["share_token"]
    assert template["package_snapshot_sha256"] == _snapshot_sha(package)
    assert template["annotations"] == []


def test_annotations_never_enter_export_outputs(client):
    from app.schemas.resume import ResumeContent
    from app.services import exporter

    resume_id = _create_resume(client)
    package = _create_package(client, resume_id)
    marker = "W18-PRIVATE-ANNOTATION-MARKER"
    _import(client, package["id"], _payload(package, [_annotation(text=marker)]))

    content = ResumeContent.model_validate(_content())
    assert marker not in exporter.export_json(content)
    assert marker not in exporter.export_markdown(content)
    # 渲染/导出模块根本不读批注表（结构性边界，而不是靠过滤字符串）。
    for module in (exporter,):
        source = __import__("inspect").getsource(module)
        assert "review_annotation" not in source


def test_annotations_are_dataset_scoped_and_backed_up(client):
    resume_id = _create_resume(client)
    package = _create_package(client, resume_id)
    _import(client, package["id"], _payload(package, [_annotation()]))

    def _count(database_file: Path, table: str) -> int:
        with closing(sqlite3.connect(str(database_file))) as connection:
            return connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

    active_file = Path(database.engine.url.database)
    assert _count(active_file, "resume_review_annotation") == 1
    other = create_dataset("批注隔离检查", database.engine)
    assert _count(dataset_database_file(other["id"]), "resume_review_annotation") == 0
    assert "resume_review_annotation" in set(application_tables())
