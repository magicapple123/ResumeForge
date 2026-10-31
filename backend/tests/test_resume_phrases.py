# SPDX-License-Identifier: Apache-2.0
"""W17 私有表达资产：CRUD/检索/收藏/插入新身份/计数/软删回收站/隔离/备份/隐私。"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import closing
from pathlib import Path

from app import database
from app.database_migrations import application_tables
from app.dataset_registry import dataset_database_file
from app.services.datasets import create_dataset
from tests.document_test_support import body_texts, entries_of


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
    response = client.post(
        "/api/resumes/manual", json={"title": "表达资产测试", "content": _content()}
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _resume(client, resume_id: int) -> dict:
    return client.get(f"/api/resumes/{resume_id}").json()


def _create_phrase(client, **body) -> dict:
    payload = {"text": "主导合成数据接口的设计与实现", "kind": "achievement", **body}
    response = client.post("/api/resume-phrases", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_phrase_crud_and_filters(client):
    created = _create_phrase(client, job_tags=["后端", "数据"], language="zh-CN")
    assert created["usage_count"] == 0
    assert created["job_tags"] == ["后端", "数据"]

    second = _create_phrase(client, text="把复盘写成可复用方法", kind="method")
    assert second["kind"] == "method"

    listed = client.get("/api/resume-phrases", params={"kind": "method"}).json()
    assert [item["id"] for item in listed["items"]] == [second["id"]]
    assert (
        client.get("/api/resume-phrases", params={"tag": "后端"}).json()["items"][0]["id"]
        == created["id"]
    )
    assert client.get("/api/resume-phrases", params={"keyword": "复盘"}).json()["items"]
    page = client.get("/api/resume-phrases", params={"limit": 1}).json()
    assert page["next_cursor"] == page["items"][0]["id"]
    rest = client.get(
        "/api/resume-phrases", params={"limit": 1, "cursor": page["next_cursor"]}
    ).json()
    assert rest["items"] and rest["items"][0]["id"] != page["items"][0]["id"]

    updated = client.patch(
        f"/api/resume-phrases/{created['id']}",
        json={"text": "改成更精炼的表述", "job_tags": ["后端"]},
    )
    assert updated.status_code == 200
    assert updated.json()["text"] == "改成更精炼的表述"

    assert client.post("/api/resume-phrases", json={"text": "x" * 2001}).status_code == 422


def test_collect_from_resume_and_rejects_unknown_path(client):
    resume_id = _create_resume(client)

    response = client.post(
        "/api/resume-phrases/collect",
        json={"resume_id": resume_id, "path": "experience.0.description.0"},
    )

    assert response.status_code == 201, response.text
    phrase = response.json()
    assert phrase["text"] == "负责合成数据接口"
    assert phrase["kind"] == "achievement"
    assert phrase["source_resume_id"] == resume_id
    assert phrase["source_object_id"] == "expobj0001"

    bad = client.post(
        "/api/resume-phrases/collect",
        json={"resume_id": resume_id, "path": "experience.9.description.0"},
    )
    assert bad.status_code == 422


def test_insert_into_existing_entry_creates_new_identity_and_counts(client):
    resume_id = _create_resume(client)
    phrase = _create_phrase(client)

    response = client.post(
        f"/api/resume-phrases/{phrase['id']}/insert",
        json={
            "resume_id": resume_id,
            "section": "experience",
            "entry_id": "expobj0001",
            "point_index": 0,
            "expected_revision": 0,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["inserted_object_id"] == "expobj0001"
    assert body["inserted_point_id"] and body["inserted_point_id"] != "pnt0000001"
    assert body["phrase"]["usage_count"] == 1
    record = _resume(client, resume_id)
    content = record["content"]
    entry = entries_of(content, "experience")[0]
    # v2：要点 = TextItem，id 就是要点身份（没有 point_ids 伴随映射，长度不变量由结构保证）。
    text_items = [item for item in entry["items"] if item["kind"] == "text"]
    assert text_items[0]["text"] == phrase["text"]
    assert len(text_items) == len([item for item in entry["items"] if item["kind"] == "text"])
    # 来源关联复用 W12：插入的块来自 kind=phrase 的来源。
    view = client.get(f"/api/provenance/resumes/{resume_id}").json()
    assert view["sources"][0]["kind"] == "phrase"
    assert view["sources"][0]["external_ref"] == f"resume_phrase:{phrase['id']}"


def test_insert_new_entry_and_revision_conflict(client):
    resume_id = _create_resume(client)
    phrase = _create_phrase(client)
    created = client.post(
        f"/api/resume-phrases/{phrase['id']}/insert",
        json={"resume_id": resume_id, "section": "education", "expected_revision": 0},
    )
    assert created.status_code == 200, created.text
    record = _resume(client, resume_id)
    content = record["content"]
    entries = entries_of(content, "education")
    new_entry = entries[-1]
    assert body_texts(content, "education", len(entries) - 1) == [phrase["text"]]
    assert new_entry["id"] != "eduobj0001"

    stale = client.post(
        f"/api/resume-phrases/{phrase['id']}/insert",
        json={"resume_id": resume_id, "section": "education", "expected_revision": 0},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "resume_revision_conflict"


def test_soft_delete_enters_trash_and_restores(client):
    phrase = _create_phrase(client)
    assert client.delete(f"/api/resume-phrases/{phrase['id']}").status_code == 204
    assert client.get("/api/resume-phrases").json()["items"] == []
    assert client.post(f"/api/trash/phrase/{phrase['id']}/restore").status_code == 204
    items = client.get("/api/resume-phrases").json()["items"]
    assert [item["id"] for item in items] == [phrase["id"]]


def test_phrase_is_dataset_scoped_and_backed_up(client):
    _create_phrase(client)

    def _count(database_file: Path, table: str) -> int:
        with closing(sqlite3.connect(str(database_file))) as connection:
            return connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

    active_file = Path(database.engine.url.database)
    assert _count(active_file, "resume_phrase") == 1
    other = create_dataset("资产隔离检查", database.engine)
    assert _count(dataset_database_file(other["id"]), "resume_phrase") == 0
    assert "resume_phrase" in set(application_tables())
    # 软删列已登记进回收站注册表（第 17 类），否则删了就永远找不回来。
    from app.services.trash import TRASH_SPEC_BY_KEY

    assert TRASH_SPEC_BY_KEY["phrase"].model.__tablename__ == "resume_phrase"


def test_phrase_text_is_not_logged(client, caplog):
    marker = "W17-PRIVATE-PHRASE-MARKER"
    with caplog.at_level(logging.DEBUG):
        created = _create_phrase(client, text=marker, quality_note="只在本地")
        assert client.get("/api/resume-phrases").status_code == 200
    assert created["text"] == marker
    assert marker not in caplog.text

# ===== W17 岗位标签：collect 写入 / PATCH 旧值对比 / 标签过滤 / 备份兼容 =====


def test_collect_with_job_tags_writes_and_filters(client):
    resume_id = _create_resume(client)
    response = client.post(
        "/api/resume-phrases/collect",
        json={
            "resume_id": resume_id,
            "path": "experience.0.description.0",
            "job_tags": ["后端", " 数据 ", "后端"],
        },
    )
    assert response.status_code == 201, response.text
    phrase = response.json()
    # 去空白 + 去重，顺序按用户给定。
    assert phrase["job_tags"] == ["后端", "数据"]
    listed = client.get("/api/resume-phrases", params={"tag": "数据"}).json()
    assert [item["id"] for item in listed["items"]] == [phrase["id"]]
    assert client.get("/api/resume-phrases", params={"tag": "后端"}).json()["items"]
    assert client.get("/api/resume-phrases", params={"tag": "不存在"}).json()["items"] == []


def test_patch_returns_previous_snapshot_for_diff(client):
    created = _create_phrase(client, job_tags=["后端"], quality_note="旧备注")
    response = client.patch(
        f"/api/resume-phrases/{created['id']}",
        json={"text": "更精炼的成果表述", "job_tags": ["后端", "平台"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["text"] == "更精炼的成果表述"
    assert body["job_tags"] == ["后端", "平台"]
    assert body["previous"] is not None
    assert body["previous"]["text"] == created["text"]
    assert body["previous"]["job_tags"] == ["后端"]
    assert body["previous"]["quality_note"] == "旧备注"
    # 旧值只用于对比，不需要在改后仍与当前行相同。
    assert body["previous"]["id"] == created["id"]


def test_job_tag_validation_rejects_oversize(client):
    too_long = "x" * 33
    response = client.post(
        "/api/resume-phrases", json={"text": "一条表达", "job_tags": [too_long]}
    )
    assert response.status_code == 400, response.text
    too_many = client.post(
        "/api/resume-phrases",
        json={"text": "一条表达", "job_tags": [f"t{index}" for index in range(21)]},
    )
    assert too_many.status_code == 422
    # collect 走同一条服务层校验（该端点既有契约：服务层 ValueError → 422）。
    resume_id = _create_resume(client)
    collected = client.post(
        "/api/resume-phrases/collect",
        json={
            "resume_id": resume_id,
            "path": "experience.0.description.0",
            "job_tags": [too_long],
        },
    )
    assert collected.status_code == 422


def test_phrase_job_tags_survive_dataset_backup_shape(client):
    phrase = _create_phrase(client, job_tags=["后端", "数据"])
    import sqlite3
    from contextlib import closing

    from app import database
    from app.dataset_registry import dataset_database_file
    from app.services.datasets import create_dataset

    # 标签是 JSON 列：读回仍是字符串数组（旧行默认 []），备份按同一 schema 带走。
    with closing(sqlite3.connect(str(Path(database.engine.url.database)))) as connection:
        row = connection.execute(
            "SELECT job_tags FROM resume_phrase WHERE id = ?", (phrase["id"],)
        ).fetchone()
        columns = {
            item[1] for item in connection.execute('PRAGMA table_info("resume_phrase")')
        }
    import json

    assert "job_tags" in columns
    # SQLAlchemy 的 JSON 序列化默认 ensure_ascii（中文存成 \uXXXX），按 JSON 解码比较。
    assert row is not None and json.loads(row[0]) == ["后端", "数据"]
    other = create_dataset("标签隔离检查", database.engine)
    with closing(sqlite3.connect(str(dataset_database_file(other["id"])))) as connection:
        other_columns = {
            item[1] for item in connection.execute('PRAGMA table_info("resume_phrase")')
        }
        count = connection.execute("SELECT COUNT(*) FROM resume_phrase").fetchone()[0]
    assert "job_tags" in other_columns
    assert count == 0
