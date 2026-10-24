# SPDX-License-Identifier: Apache-2.0
"""W16 术语表：CRUD/唯一/导入更新/软删回收站/隔离/备份。"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from app import database
from app.database_migrations import application_tables
from app.dataset_registry import dataset_database_file
from app.services.datasets import create_dataset
from app.services.trash import TRASH_SPEC_BY_KEY


def _term(**body) -> dict:
    payload = {
        "source_term": "示例科技有限公司",
        "target_term": "Example Tech",
        "language_from": "zh-CN",
        "language_to": "en-US",
        "category": "company",
        "locked": True,
        "note": "公司名固定译法",
    }
    payload.update(body)
    return payload


def _create(client, **body):
    return client.post("/api/glossary-terms", json=_term(**body))


def test_glossary_crud_and_uniqueness(client):
    created = _create(client)
    assert created.status_code == 201, created.text
    term = created.json()
    assert term["locked"] is True and term["target_term"] == "Example Tech"

    duplicate = _create(client)
    assert duplicate.status_code == 400

    same_language = _create(client, source_term="另一个", language_to="zh-CN")
    assert same_language.status_code == 400

    listed = client.get("/api/glossary-terms", params={"language_to": "en-US"}).json()
    assert [item["id"] for item in listed["items"]] == [term["id"]]

    patched = client.patch(
        f"/api/glossary-terms/{term['id']}", json={"target_term": "Example Technology"}
    )
    assert patched.status_code == 200
    assert patched.json()["target_term"] == "Example Technology"
    # 没有单条 GET 接口（最小面），但同路径有 PATCH/DELETE → GET 应为 405 而不是 404。
    assert client.get("/api/glossary-terms/9999").status_code == 405


def test_glossary_import_creates_then_updates(client):
    first = client.post(
        "/api/glossary-terms/import",
        json={"items": [_term(), _term(source_term="示例大学", target_term="Example University")]},
    )
    assert first.status_code == 200, first.text
    assert first.json()["created"] == 2

    second = client.post(
        "/api/glossary-terms/import",
        json={"items": [_term(target_term="Example Tech Inc")]},
    )
    assert second.json()["created"] == 0
    assert second.json()["updated"] == 1
    listed = client.get("/api/glossary-terms").json()["items"]
    by_source = {item["source_term"]: item["target_term"] for item in listed}
    assert by_source["示例科技有限公司"] == "Example Tech Inc"


def test_glossary_soft_delete_and_restore(client):
    term = _create(client).json()
    assert client.delete(f"/api/glossary-terms/{term['id']}").status_code == 204
    assert client.get("/api/glossary-terms").json()["items"] == []
    assert TRASH_SPEC_BY_KEY["glossary_term"].model.__tablename__ == "resume_glossary_term"

    restored = client.post(f"/api/trash/glossary_term/{term['id']}/restore")
    assert restored.status_code == 204
    assert [item["id"] for item in client.get("/api/glossary-terms").json()["items"]] == [
        term["id"]
    ]


def test_glossary_is_dataset_scoped_and_backed_up(client):
    _create(client)

    def _count(database_file: Path, table: str) -> int:
        with closing(sqlite3.connect(str(database_file))) as connection:
            return connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

    active_file = Path(database.engine.url.database)
    assert _count(active_file, "resume_glossary_term") == 1
    other = create_dataset("术语隔离检查", database.engine)
    assert _count(dataset_database_file(other["id"]), "resume_glossary_term") == 0
    assert "resume_glossary_term" in set(application_tables())
