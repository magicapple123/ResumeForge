# SPDX-License-Identifier: Apache-2.0
"""``user_file`` 副本缺失/损坏自愈（P5）。

``user_file`` 是"镜像登记"，原件在业务表的 base64 列里。此前 ``save_from_bytes`` 命中
同 ``sha256`` 的行就合并来源并**直接返回**，从不看磁盘——于是"行在、文件没了"永远补
不回来，「我的文件」预览永久 404、导出永久报 ``missing``，告警变成消不掉的噪音。

这里钉住四件事（方案 P5 验收）：

1. 删掉副本 → 回填后文件回来、``/raw`` 200；
2. 副本被改坏 1 字节 → 再次保存同内容即修复（根因修复，不靠定时任务）；
3. 导出前修复一次 → 包内字节正确、清单里没有 ``missing``；
4. 库内原件与行登记哈希不一致 → **磁盘不动**，只计入 unresolved。
"""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

import pytest
from app.database import engine as app_engine
from app.models.material import Material
from app.models.user_file import UserFile
from app.services.data_backup import MANIFEST_MEMBER, create_backup_archive
from app.services.user_files import (
    backfill_missing_copies,
    ensure_copies,
    save_from_bytes,
    user_files_dir,
)

PNG_BYTES = b"\x89PNG\r\n\x1a\nself-heal-payload"


@pytest.fixture(autouse=True)
def clean_user_files_dir():
    directory = user_files_dir(app_engine)
    shutil.rmtree(directory, ignore_errors=True)
    yield
    shutil.rmtree(directory, ignore_errors=True)


def _data_url(content: bytes = PNG_BYTES) -> str:
    return "data:image/png;base64," + base64.b64encode(content).decode("ascii")


def _seed_material(db_session, name: str = "证书.png") -> UserFile:
    """一条"原件在库、副本落盘"的常规状态。"""
    db_session.add(
        Material(
            title="证书",
            files=[
                {
                    "name": name,
                    "mime_type": "image/png",
                    "size_bytes": len(PNG_BYTES),
                    "text": "",
                    "data_url": _data_url(),
                }
            ],
        )
    )
    db_session.commit()
    backfill_missing_copies(db_session)
    return db_session.query(UserFile).one()


def _manifest(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read(MANIFEST_MEMBER))


def test_backfill_restores_a_deleted_copy(db_session, client):
    """行还在、磁盘文件被删：回填必须把字节补回来，而不是"同 sha 已存在"就跳过。"""
    row = _seed_material(db_session)
    target = user_files_dir(app_engine) / row.disk_name
    assert target.is_file()

    target.unlink()
    assert not target.is_file()

    backfill_missing_copies(db_session)

    assert target.is_file()
    assert hashlib.sha256(target.read_bytes()).hexdigest() == row.sha256
    assert client.get(f"/api/user-files/{row.id}/raw").status_code == 200


def test_save_repairs_a_corrupted_copy(db_session):
    """副本被改坏 1 字节：再次保存同内容时按库内原件重写，而不是认为"文件已存在"。"""
    row = _seed_material(db_session)
    target = user_files_dir(app_engine) / row.disk_name
    corrupted = bytearray(target.read_bytes())
    corrupted[-1] ^= 0xFF
    target.write_bytes(bytes(corrupted))
    assert target.read_bytes() != PNG_BYTES

    save_from_bytes(
        db_session,
        PNG_BYTES,
        original_name="证书.png",
        mime="image/png",
        source_type="material",
        source_ref="material:1",
    )

    assert target.read_bytes() == PNG_BYTES
    assert db_session.query(UserFile).count() == 1  # 不加行、不重复落盘


def test_export_repairs_before_packing(db_session, tmp_path):
    """导出前修一次：包内字节正确、清单里没有 missing——告警不该变成永久噪音。"""
    row = _seed_material(db_session)
    target = user_files_dir(app_engine) / row.disk_name
    target.unlink()

    archive = create_backup_archive(app_engine, tmp_path / "staging")
    manifest = _manifest(archive)

    assert target.is_file()
    assert manifest["asset_manifest"]["user_files"]
    assert "user_files_missing" not in manifest["asset_manifest"]
    with zipfile.ZipFile(archive) as handle:
        assert handle.read(f"user_files/{row.disk_name}") == PNG_BYTES


def test_original_hash_mismatch_never_touches_the_disk(db_session):
    """库内原件与行登记哈希不符 = 库自身有问题：**不动磁盘**，只报警。"""
    db_session.add(
        Material(
            title="来路不明",
            files=[
                {
                    "name": "x.png",
                    "mime_type": "image/png",
                    "size_bytes": 4,
                    "text": "",
                    "data_url": _data_url(b"other-bytes"),
                }
            ],
        )
    )
    db_session.commit()
    material = db_session.query(Material).one()
    registered = b"registered-bytes"
    db_session.add(
        UserFile(
            sha256=hashlib.sha256(registered).hexdigest(),
            disk_name="registered.bin",
            original_name="registered.bin",
            mime="application/octet-stream",
            size=len(registered),
            source_type="material",
            source_ref=f"material:{material.id}",
        )
    )
    db_session.commit()

    stats = ensure_copies(app_engine)

    assert stats["unresolved"] == 1
    assert stats["repaired"] == 0
    assert not (user_files_dir(app_engine) / "registered.bin").exists()
