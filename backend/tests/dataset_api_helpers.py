# SPDX-License-Identifier: Apache-2.0
"""数据集接口测试共用的构造辅助：备份包字节、导入、岗位读写与数据集列表。

2026-10-22（行数预算审计 A3）：从 ``test_api_datasets.py`` 拆出——生命周期与
导入导出两份测试文件都要用这里的辅助，各复制一份等于未来改一处漏一处。与
``frontend/src/test/profilePageHarness.tsx`` 同款思路：本模块约定**不带** ``test_``
前缀，pytest 不会收集它，只作为被 import 的共享模块存在。
"""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from app import database
from app.services.data_backup import create_backup_archive

MAIN = "main"


def _archive_bytes(tmp_path: Path) -> bytes:
    """把当前（测试）数据库导出成一份合法备份包。"""
    return create_backup_archive(database.engine, tmp_path / "staging").read_bytes()


def _import(
    client, payload: bytes, name: str = "导入的数据集", content_type: str = "application/zip"
):
    return client.post(
        f"/api/settings/datasets/import?name={name}",
        content=payload,
        headers={"Content-Type": content_type},
    )


def _job_titles(client) -> set[str]:
    response = client.get("/api/jobs")
    assert response.status_code == 200
    return {item["title"] for item in response.json()["items"]}


def _add_job(client, title: str) -> None:
    response = client.post(
        "/api/jobs",
        json={"title": title, "description": "职责", "requirements": "要求"},
    )
    assert response.status_code in (200, 201)


def _list_datasets(client) -> list[dict]:
    response = client.get("/api/settings/datasets")
    assert response.status_code == 200
    return response.json()


def _stored_llm_api_key() -> str:
    """读测试库里 ``llm_config`` 中 Key 的**存储原值**（Windows 上是 DPAPI 密文）。

    与 ``test_data_backup.py`` 的同名辅助一致：勾选"包含 API Key"时随包走的就是这个
    原值，按它断言在加密与非加密平台上都成立。
    """
    from app.services.data_backup import database_path

    path = database_path(database.engine)
    with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)) as connection:
        row = connection.execute(
            "SELECT value FROM app_setting WHERE key = 'llm_config'"
        ).fetchone()
    return "" if row is None else json.loads(row[0]).get("api_key", "")
