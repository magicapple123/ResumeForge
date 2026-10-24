# SPDX-License-Identifier: Apache-2.0
"""W19 导出预设：CRUD/同名/命名 token 校验/默认切换/数据集隔离/备份清单。"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from app import database
from app.database_migrations import application_tables
from app.dataset_registry import dataset_database_file
from app.services.datasets import create_dataset


def _preset(**body) -> dict:
    payload = {
        "name": "投递默认",
        "description": "PDF+Word",
        "config": {
            "formats": ["pdf", "docx"],
            "naming": "{name}-{job_title}-{date}",
            "archive_original": False,
        },
    }
    payload.update(body)
    return payload


def _create(client, **body):
    return client.post("/api/resumes/export-presets", json=_preset(**body))


def test_preset_crud_and_default_switch(client):
    first = _create(client, is_default=True)
    assert first.status_code == 201, first.text
    preset = first.json()
    assert preset["is_default"] is True
    second = _create(client, name="归档版", is_default=True).json()
    listed = client.get("/api/resumes/export-presets").json()["items"]
    defaults = [item for item in listed if item["is_default"]]
    assert [item["id"] for item in defaults] == [second["id"]]
    patched = client.patch(
        f"/api/resumes/export-presets/{preset['id']}",
        json=_preset(name="改名版", is_default=False),
    )
    assert patched.status_code == 200 and patched.json()["name"] == "改名版"
    assert client.delete(f"/api/resumes/export-presets/{preset['id']}").status_code == 204
    assert client.delete(f"/api/resumes/export-presets/{preset['id']}").status_code == 404


def test_preset_validation_cases(client):
    assert _create(client, name="").status_code == 422
    duplicate = _create(client)
    assert duplicate.status_code == 201
    assert _create(client).status_code == 422  # 同名
    unknown_token = _create(
        client, name="坏命名", config={"formats": ["pdf"], "naming": "{unknown}-{date}"}
    )
    assert unknown_token.status_code == 422
    assert "未知占位符" in unknown_token.text
    bad_format = _create(client, name="坏格式", config={"formats": ["exe"]})
    assert bad_format.status_code == 422
    bad_limit = _create(
        client, name="坏上限", config={"formats": ["pdf"], "max_artifacts_per_resume": 99}
    )
    assert bad_limit.status_code == 422


def test_presets_are_dataset_scoped_and_backed_up(client):
    _create(client)

    def _count(database_file: Path, table: str) -> int:
        with closing(sqlite3.connect(str(database_file))) as connection:
            return connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

    active_file = Path(database.engine.url.database)
    assert _count(active_file, "resume_export_preset") == 1
    other = create_dataset("导出配置隔离检查", database.engine)
    assert _count(dataset_database_file(other["id"]), "resume_export_preset") == 0
    assert {"resume_export_preset", "resume_export_artifact"} <= set(application_tables())
