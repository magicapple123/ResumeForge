"""用户文件副本库（R6）：去重、data URL 兼容、端点、回填、迁移与备份往返。"""
import base64
import json
import os
import shutil
import sys
import types
from pathlib import Path

import pytest
from alembic import command
from app.database import engine as app_engine
from app.database_migrations import build_alembic_config
from app.models.material import Material
from app.models.user_file import UserFile
from app.services.data_backup.export import create_backup_archive
from app.services.user_files import (
    backfill_missing_copies,
    save_from_bytes,
    save_from_data_url,
    user_files_dir,
)
from sqlalchemy import create_engine, inspect

PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-image-data-01"
PNG_BYTES_ALT = b"\x89PNG\r\n\x1a\nfake-image-data-02"


@pytest.fixture(autouse=True)
def clean_user_files_dir():
    """副本目录是磁盘资产，不在 clean_db 的建表/删表范围内：每个用例前后各清一次。"""
    directory = user_files_dir(app_engine)
    shutil.rmtree(directory, ignore_errors=True)
    yield
    shutil.rmtree(directory, ignore_errors=True)


def _png_data_url(content: bytes = PNG_BYTES) -> str:
    return "data:image/png;base64," + base64.b64encode(content).decode("ascii")


def _seed(db_session, content: bytes = PNG_BYTES, name: str = "shot.png") -> UserFile:
    save_from_bytes(
        db_session,
        content,
        original_name=name,
        mime="image/png",
        source_type="material",
        source_ref="material:1",
    )
    return db_session.query(UserFile).one()


# ---------- save_from_bytes / save_from_data_url ----------


def test_save_from_bytes_deduplicates_content(db_session):
    """同内容两次保存：1 行 2 来源、磁盘 1 个文件。"""
    save_from_bytes(
        db_session,
        PNG_BYTES,
        original_name="a.png",
        mime="image/png",
        source_type="material",
        source_ref="material:1",
    )
    save_from_bytes(
        db_session,
        PNG_BYTES,
        original_name="a.png",
        mime="image/png",
        source_type="job_note",
        source_ref="job:9",
    )

    rows = db_session.query(UserFile).all()
    assert len(rows) == 1
    sources = json.loads(rows[0].sources_json)
    assert {item["source_ref"] for item in sources} == {"material:1", "job:9"}
    directory = user_files_dir(db_session.get_bind())
    files = list(directory.iterdir())
    assert len(files) == 1
    assert files[0].read_bytes() == PNG_BYTES


def test_save_from_data_url_accepts_prefixed_and_bare_base64(db_session):
    """带 data: 前缀与裸 base64 都能解码；MIME 分别来自头与兜底参数。"""
    save_from_data_url(
        db_session,
        _png_data_url(PNG_BYTES),
        source_type="material",
        source_ref="material:1",
        fallback_name="prefixed.png",
    )
    save_from_data_url(
        db_session,
        base64.b64encode(PNG_BYTES_ALT).decode("ascii"),
        source_type="photo",
        source_ref="photo:1",
        fallback_name="bare.png",
        fallback_mime="image/png",
    )

    rows = {row.original_name: row for row in db_session.query(UserFile).all()}
    assert set(rows) == {"prefixed.png", "bare.png"}
    assert rows["prefixed.png"].mime == "image/png"
    assert rows["bare.png"].mime == "image/png"
    directory = user_files_dir(db_session.get_bind())
    assert (directory / rows["prefixed.png"].disk_name).read_bytes() == PNG_BYTES
    assert (directory / rows["bare.png"].disk_name).read_bytes() == PNG_BYTES_ALT


def test_save_from_data_url_swallows_invalid_input(db_session):
    """坏数据 / 空串一律吞掉记 warning，绝不抛错、不留半截行。"""
    save_from_data_url(
        db_session,
        "data:image/png;base64,!!!!",
        source_type="material",
        source_ref="material:1",
    )
    save_from_data_url(db_session, "", source_type="material", source_ref="material:1")
    assert db_session.query(UserFile).count() == 0


# ---------- 端点 ----------


def test_list_pagination_and_fields(client, db_session):
    for index in range(3):
        save_from_bytes(
            db_session,
            PNG_BYTES + bytes([index]),
            original_name=f"文件{index}.png",
            mime="image/png",
            source_type="material",
            source_ref=f"material:{index}",
        )

    first = client.get("/api/user-files", params={"page": 1, "page_size": 2})
    assert first.status_code == 200
    data = first.json()
    assert data["total"] == 3
    assert len(data["items"]) == 2
    # 回显不含 sha256 / disk_name。
    assert set(data["items"][0]) == {
        "id",
        "original_name",
        "mime",
        "size",
        "source_type",
        "source_ref",
        "created_at",
    }
    second = client.get("/api/user-files", params={"page": 2, "page_size": 2})
    assert len(second.json()["items"]) == 1

    by_keyword = client.get("/api/user-files", params={"keyword": "文件1"})
    assert by_keyword.json()["total"] == 1

    by_source = client.get("/api/user-files", params={"source_type": "material"})
    assert by_source.json()["total"] == 3
    by_other = client.get("/api/user-files", params={"source_type": "photo"})
    assert by_other.json()["total"] == 0


def test_raw_endpoint_returns_content_inline(client, db_session):
    row = _seed(db_session, name="shot.png")
    response = client.get(f"/api/user-files/{row.id}/raw")
    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"] == "image/png"
    disposition = response.headers["content-disposition"]
    assert "inline" in disposition
    assert "shot.png" in disposition


def test_raw_missing_row_returns_404(client):
    assert client.get("/api/user-files/999/raw").status_code == 404


def test_raw_blocks_path_traversal(client, db_session):
    """伪造行的 disk_name 带 ``../``：resolve 守卫必须 404，绝不能读到目录外。"""
    row = UserFile(
        sha256="f" * 64,
        disk_name="../evil.txt",
        original_name="evil.txt",
        mime="text/plain",
        size=3,
        source_type="material",
        source_ref="material:1",
        sources_json="[]",
    )
    db_session.add(row)
    db_session.commit()
    response = client.get(f"/api/user-files/{row.id}/raw")
    assert response.status_code == 404


def test_open_in_system_uses_file_inside_directory(client, db_session, monkeypatch):
    row = _seed(db_session)
    directory = user_files_dir(db_session.get_bind())
    opened: list[Path] = []
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(os, "startfile", lambda path: opened.append(Path(path)), raising=False)

    response = client.post(f"/api/user-files/{row.id}/open-in-system")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert len(opened) == 1
    assert opened[0].resolve().parent == directory.resolve()


def test_open_in_system_failure_returns_400(client, db_session, monkeypatch):
    row = _seed(db_session)
    monkeypatch.setattr(sys, "platform", "win32")

    def _boom(_path):
        raise OSError("no association")

    monkeypatch.setattr(os, "startfile", _boom, raising=False)
    response = client.post(f"/api/user-files/{row.id}/open-in-system")
    assert response.status_code == 400
    assert "打开失败" in response.json()["detail"]


def test_reveal_opens_the_folder_and_selects_the_file(client, db_session, monkeypatch):
    """reveal 语义：进文件夹并定位文件（explorer /select），不是打开文件本身。"""
    row = _seed(db_session)
    directory = user_files_dir(db_session.get_bind())
    calls: list[list[str]] = []
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(
        "app.api.user_files.subprocess",
        types.SimpleNamespace(Popen=lambda args: calls.append(list(args))),
    )

    response = client.post(f"/api/user-files/{row.id}/reveal")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert len(calls) == 1
    assert calls[0][0] == "explorer"
    assert calls[0][1].startswith("/select,")
    selected = Path(calls[0][1].removeprefix("/select,")).resolve()
    assert selected.parent == directory.resolve()
    assert selected.name == row.disk_name


def test_reveal_missing_row_returns_404(client, db_session):
    response = client.post("/api/user-files/999999/reveal")
    assert response.status_code == 404


def test_lookup_finds_by_source_and_later_sources(client, db_session):
    save_from_bytes(
        db_session,
        PNG_BYTES,
        original_name="note-1.png",
        mime="image/png",
        source_type="job_note",
        source_ref="job:3",
    )
    save_from_bytes(
        db_session,
        PNG_BYTES_ALT,
        original_name="note-2.png",
        mime="image/png",
        source_type="job_note",
        source_ref="job:3",
    )

    result = client.get(
        "/api/user-files/lookup",
        params={"source_type": "job_note", "source_ref": "job:3"},
    )
    assert result.status_code == 200
    items = result.json()["items"]
    assert [item["original_name"] for item in items] == ["note-1.png", "note-2.png"]

    # 后来并入的来源（sources_json）也能反查命中：把第一份内容再存为照片来源后，
    # 原来源的反查结果不受影响。
    save_from_bytes(
        db_session,
        PNG_BYTES,
        original_name="note-1.png",
        mime="image/png",
        source_type="photo",
        source_ref="photo:77",
    )
    again = client.get(
        "/api/user-files/lookup",
        params={"source_type": "job_note", "source_ref": "job:3"},
    )
    assert {item["id"] for item in again.json()["items"]} == {
        item["id"] for item in items
    }


# ---------- 回填 ----------


def test_backfill_is_idempotent(db_session):
    db_session.add(
        Material(
            title="证书",
            files=[
                {
                    "name": "证书.png",
                    "mime_type": "image/png",
                    "size_bytes": len(PNG_BYTES),
                    "text": "",
                    "data_url": _png_data_url(),
                }
            ],
        )
    )
    db_session.commit()

    assert backfill_missing_copies(db_session) == 1
    assert db_session.query(UserFile).count() == 1

    # 第二轮：不再加行、不再膨胀来源，磁盘也只有一份。
    backfill_missing_copies(db_session)
    assert db_session.query(UserFile).count() == 1
    sources = json.loads(db_session.query(UserFile).one().sources_json)
    assert len(sources) == 1
    directory = user_files_dir(db_session.get_bind())
    assert len(list(directory.iterdir())) == 1


# ---------- 迁移 ----------


def test_migration_creates_user_file_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'user-files.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, "head")
    assert "user_file" in set(inspect(engine).get_table_names())
    columns = {item["name"] for item in inspect(engine).get_columns("user_file")}
    assert {
        "id",
        "sha256",
        "disk_name",
        "original_name",
        "mime",
        "size",
        "source_type",
        "source_ref",
        "sources_json",
        "created_at",
    } <= columns

    command.downgrade(config, "-1")
    assert "user_file" not in set(inspect(engine).get_table_names())


# ---------- 备份往返（referral_images 缺口） ----------


def test_backup_roundtrip_restores_referral_images(db_session, tmp_path):
    from app.dataset_registry import dataset_database_file
    from app.services.datasets import import_dataset
    from app.services.referral_service import REFERRAL_IMAGES_DIRNAME, referral_images_dir

    directory = referral_images_dir(db_session.get_bind())
    directory.mkdir(parents=True, exist_ok=True)
    image = directory / "refimg.png"
    image.write_bytes(PNG_BYTES)

    staging = tmp_path / "staging"
    archive_path = create_backup_archive(db_session.get_bind(), staging)

    created = import_dataset(archive_path, "往返测试", db_session.get_bind(), staging)
    dataset_file = dataset_database_file(created["id"])
    restored = dataset_file.parent / REFERRAL_IMAGES_DIRNAME / "refimg.png"
    assert restored.is_file()
    assert restored.read_bytes() == PNG_BYTES
