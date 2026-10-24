# SPDX-License-Identifier: Apache-2.0
"""W13 命名版本与岗位变体：快照不可变、比较、恢复产生新版本、冻结、选择性同步。

全部走真实 API（client fixture）；合成数据，不涉及真实用户资料。
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from app import database
from app.database_migrations import application_tables
from app.dataset_registry import dataset_database_file
from app.models.resume_delivery import ResumeDeliveryRecord
from app.services.datasets import create_dataset


def _content(summary: str = "版本 A", description: str = "A") -> dict:
    return {
        "name": "张示例",
        "summary": summary,
        "experience": [
            {"company": "示例科技有限公司", "role": "后端实习生", "description": [description]}
        ],
    }


def _create_resume(client, title: str = "版本测试") -> int:
    response = client.post("/api/resumes/manual", json={"title": title, "content": _content()})
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _resume(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _save_content(client, resume_id: int, content: dict) -> dict:
    current = _resume(client, resume_id)
    response = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": content, "expected_revision": current["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_version(client, resume_id: int, name: str, **extra) -> dict:
    response = client.post(f"/api/resumes/{resume_id}/versions", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_create_list_and_detail_versions(client):
    resume_id = _create_resume(client)

    version = _create_version(client, resume_id, "投递版 v1")
    assert version["name"] == "投递版 v1"
    assert version["frozen"] is False
    assert len(version["content_sha256"]) == 64
    assert len(version["params_sha256"]) == 64

    listed = client.get(f"/api/resumes/{resume_id}/versions").json()
    assert [item["id"] for item in listed["items"]] == [version["id"]]

    detail = client.get(f"/api/resumes/{resume_id}/versions/{version['id']}").json()
    assert detail["content"]["summary"] == "版本 A"
    assert detail["render_context"]["document_mode"] == "resume"
    assert detail["render_context"]["page_limit"] >= 1


def test_version_snapshot_is_immutable(client, db_session):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "快照")
    original_hash = version["content_sha256"]

    _save_content(client, resume_id, _content("版本 B", "B"))

    detail = client.get(f"/api/resumes/{resume_id}/versions/{version['id']}").json()
    assert detail["content"]["summary"] == "版本 A"
    assert detail["content_sha256"] == original_hash
    # 后续编辑只改当前简历，不回写历史版本行。
    assert _resume(client, resume_id)["content"]["summary"] == "版本 B"


def test_freeze_flag_persists(client):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "已投递")
    response = client.post(
        f"/api/resumes/{resume_id}/versions/{version['id']}/freeze", json={"frozen": True}
    )
    assert response.status_code == 200, response.text
    assert response.json()["frozen"] is True
    listed = client.get(f"/api/resumes/{resume_id}/versions").json()
    assert listed["items"][0]["frozen"] is True


def test_compare_two_versions_and_current_layout(client, db_session):
    resume_id = _create_resume(client)
    first = _create_version(client, resume_id, "v1")
    _save_content(client, resume_id, _content("版本 B", "B"))
    second = _create_version(client, resume_id, "v2")

    compared = client.get(f"/api/resumes/{resume_id}/versions/{first['id']}/compare/{second['id']}")
    assert compared.status_code == 200, compared.text
    body = compared.json()
    assert body["content"]["stats"]["added"] > 0
    assert body["layout"]["equal"] is True

    from app.models.resume import ResumeRecord

    record = db_session.get(ResumeRecord, resume_id)
    record.page_limit = 2
    db_session.commit()
    current = client.get(f"/api/resumes/{resume_id}/versions/{first['id']}/compare/current").json()
    assert current["against_id"] == 0
    assert "page_limit" in current["layout"]["changed"]


def test_restore_creates_new_current_version_and_keeps_history(client, db_session):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "回滚点")
    _save_content(client, resume_id, _content("版本 B", "B"))
    before = _resume(client, resume_id)
    delivery_before = db_session.query(ResumeDeliveryRecord).count()

    restored = client.post(
        f"/api/resumes/{resume_id}/versions/{version['id']}/restore",
        json={"expected_revision": before["revision"]},
    )

    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["revision"] == before["revision"] + 1
    assert body["version"]["source"] == "restore"
    assert body["version"]["parent_version_id"] == version["id"]
    after = _resume(client, resume_id)
    assert after["content"]["summary"] == "版本 A"
    # 历史版本与已冻结的交付记录都不变；版本列表多了一条 restore。
    original = client.get(f"/api/resumes/{resume_id}/versions/{version['id']}").json()
    assert original["content"]["summary"] == "版本 A"
    versions = client.get(f"/api/resumes/{resume_id}/versions").json()["items"]
    assert len(versions) == 2
    assert db_session.query(ResumeDeliveryRecord).count() == delivery_before


def test_restore_revision_conflict_does_not_write(client):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "回滚点")
    stale_revision = _resume(client, resume_id)["revision"]
    _save_content(client, resume_id, _content("版本 B", "B"))

    response = client.post(
        f"/api/resumes/{resume_id}/versions/{version['id']}/restore",
        json={"expected_revision": stale_revision},
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "resume_revision_conflict"
    assert _resume(client, resume_id)["content"]["summary"] == "版本 B"
    assert len(client.get(f"/api/resumes/{resume_id}/versions").json()["items"]) == 1


def test_variant_is_independent_from_current_resume(client):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "v1")

    created = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "后端岗变体", "base_version_id": version["id"]},
    )
    assert created.status_code == 201, created.text
    variant = created.json()
    assert variant["base_version_id"] == version["id"]

    _save_content(client, resume_id, _content("版本 B", "B"))
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert detail["content"]["summary"] == "版本 A"
    assert len(client.get(f"/api/resumes/{resume_id}/variants").json()["items"]) == 1


def test_selective_sync_only_changes_listed_paths(client):
    resume_id = _create_resume(client)
    first = _create_version(client, resume_id, "v1")
    variant = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "变体", "base_version_id": first["id"]},
    ).json()
    _save_content(client, resume_id, _content("版本 B", "B"))
    second = _create_version(client, resume_id, "v2")

    response = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={
            "source_version_id": second["id"],
            "variant_ids": [variant["id"]],
            "paths": ["summary"],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"][0]["applied_paths"] == ["summary"]
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert detail["content"]["summary"] == "版本 B"
    # 没列出的路径保留岗位定制（还是 v1 的内容）。
    assert detail["content"]["experience"][0]["description"] == ["A"]
    assert detail["last_synced_version_id"] == second["id"]


def test_sync_rejects_unknown_path_and_foreign_variant(client):
    resume_id = _create_resume(client)
    variant = client.post(f"/api/resumes/{resume_id}/variants", json={"name": "变体"}).json()

    bad_path = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={"variant_ids": [variant["id"]], "paths": ["summary.absent"]},
    )
    assert bad_path.status_code == 400

    other_resume = _create_resume(client, "另一份")
    other_variant = client.post(
        f"/api/resumes/{other_resume}/variants", json={"name": "别人的变体"}
    ).json()
    foreign = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={"variant_ids": [other_variant["id"]], "paths": ["summary"]},
    )
    assert foreign.status_code == 404


def test_version_and_variant_404s(client):
    resume_id = _create_resume(client)
    assert client.get(f"/api/resumes/{resume_id}/versions/9999").status_code == 404
    assert client.get(f"/api/resumes/{resume_id}/variants/9999").status_code == 404
    # 空白名称通过 pydantic 的 min_length（长度 1）但在服务层 strip 后为空 → 400。
    assert client.post(f"/api/resumes/{resume_id}/versions", json={"name": " "}).status_code == 400


def test_versions_are_dataset_scoped_and_backed_up(client, db_session):
    resume_id = _create_resume(client)
    _create_version(client, resume_id, "隔离版本")

    def _count(database_file: Path, table: str) -> int:
        with closing(sqlite3.connect(str(database_file))) as connection:
            return connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

    active_file = Path(database.engine.url.database)
    assert _count(active_file, "resume_version") == 1

    other = create_dataset("版本隔离检查", database.engine)
    other_file = dataset_database_file(other["id"])
    assert _count(other_file, "resume_version") == 0
    assert _count(other_file, "resume_variant") == 0
    # 新表自动进入备份清单（清单从 Base.metadata 推导）。
    assert {"resume_version", "resume_variant"} <= set(application_tables())
