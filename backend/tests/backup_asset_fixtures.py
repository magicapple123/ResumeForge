"""备份/资产用例的共享夹具（``test_backup_asset_manifest.py`` 与
``test_backup_asset_restore.py`` 共用；先例：``profile_relevance_fixtures.py``）。

一次拆分只为回到单文件行数预算：夹具原样搬迁，行为不变。
"""

import hashlib
import json
import zipfile
from pathlib import Path

from app import database
from app.database import build_engine, database_url_for
from app.dataset_registry import dataset_database_file
from app.models.referral import Referral
from app.models.user_file import UserFile
from app.services.data_backup import MANIFEST_MEMBER, database_path
from app.services.datasets import (
    export_all_datasets,
    import_dataset,
    list_datasets,
)
from sqlalchemy.orm import Session

__all__ = [
    "MANIFEST_MEMBER",
    "_add_main_user_file",
    "_add_referral_image",
    "_add_user_file",
    "_dataset_names",
    "_fingerprints",
    "_import_all",
    "_member_names",
    "_read_manifest",
    "database",
    "database_path",
    "dataset_database_file",
    "export_all_datasets",
    "import_dataset",
]


def _add_user_file(dataset_db: Path, disk_name: str, content: bytes) -> None:
    """往一份数据集库里登记一条 user_file 行，并把内容写到该库同目录 user_files/。"""
    engine = build_engine(database_url_for(dataset_db))
    try:
        with Session(engine) as session:
            session.add(
                UserFile(
                    sha256=hashlib.sha256(content).hexdigest(),
                    disk_name=disk_name,
                    original_name=disk_name,
                    mime="application/octet-stream",
                    size=len(content),
                    source_type="test",
                    source_ref="test:asset-manifest",
                )
            )
            session.commit()
    finally:
        engine.dispose()
    directory = dataset_db.parent / "user_files"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / disk_name).write_bytes(content)


def _add_referral_image(dataset_db: Path, image_name: str, content: bytes) -> None:
    """往一份数据集库里登记一条 referral.note_images 引用，并落盘对应图片。"""
    engine = build_engine(database_url_for(dataset_db))
    try:
        with Session(engine) as session:
            session.add(Referral(note_images=[f"referral_images/{image_name}"]))
            session.commit()
    finally:
        engine.dispose()
    directory = dataset_db.parent / "referral_images"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / image_name).write_bytes(content)


def _add_main_user_file(db_session, disk_name: str, content: bytes) -> None:
    """主库（当前活动测试库）的 user_file 行 + 磁盘副本。"""
    db_session.add(
        UserFile(
            sha256=hashlib.sha256(content).hexdigest(),
            disk_name=disk_name,
            original_name=disk_name,
            mime="application/octet-stream",
            size=len(content),
            source_type="test",
            source_ref="test:asset-manifest",
        )
    )
    db_session.commit()
    directory = database_path(database.engine).parent / "user_files"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / disk_name).write_bytes(content)


def _member_names(archive_path: Path) -> set[str]:
    with zipfile.ZipFile(archive_path) as archive:
        return set(archive.namelist())


def _fingerprints(root: Path) -> dict[str, str]:
    """目录树的字节指纹：相对路径 -> sha256（含库、边车、附件、元信息）。

    RR-03 的验收口径是"导入前后所有库/附件的字节指纹"而不是"错误信息里说了什么"，
    所以失败路径一律用这张表比对，而不是只断言某个字符串出现过。
    """
    table: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            table[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return table


def _read_manifest(archive_path: Path) -> dict:
    with zipfile.ZipFile(archive_path) as archive:
        return json.loads(archive.read(MANIFEST_MEMBER))


def _dataset_names() -> set[str]:
    return {item["name"] for item in list_datasets()}


def _import_all(three_datasets, tmp_path):
    archive = export_all_datasets(database.engine, tmp_path / "staging-export")
    result = import_dataset(archive, "整包恢复", database.engine, tmp_path / "staging-import")
    return archive, result
