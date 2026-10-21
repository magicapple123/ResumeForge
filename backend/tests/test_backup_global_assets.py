# SPDX-License-Identifier: Apache-2.0
"""全局字体随包导出/导入（P2，格式 6）。

钉住四件事：

1. 字体目录非空 → 包里带 ``global_assets.json`` + ``fonts/`` 成员，格式号升到 6；
2. 字体目录为空 → **格式号保持 5**（内容分级，不虚升），也不出现字体成员；
3. 导入只补不覆盖：同名字体保留本机、``names.json`` 只补缺失键、``active.json``
   只在本机没有选择时采用；
4. 字体坏了/对不上哈希只进 ``font_issues``，**不回滚**已经落盘的数据集。
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest
from app.database import engine
from app.schemas.setting import LLMConfig
from app.services import user_fonts
from app.services.data_backup import MANIFEST_MEMBER, BackupError, create_backup_archive
from app.services.data_backup.global_assets import (
    GLOBAL_ASSETS_MEMBER,
    GLOBAL_ASSETS_VERSION,
    build_global_assets_payload,
    read_global_assets_payload,
    restore_global_assets,
)
from app.services.data_backup.paths import (
    BACKUP_FORMAT_GLOBAL_ASSETS,
    BACKUP_FORMAT_GLOBAL_CONFIG,
)
from app.services.datasets import export_dataset
from app.services.global_llm_profiles import write_global_llm

FONT_A = "Sans-A.ttf"
FONT_B = "Serif-B.otf"
FONT_A_BYTES = b"\x00\x01\x00\x00" + b"a" * 200
FONT_B_BYTES = b"\x00\x01\x00\x00" + b"b" * 300


@pytest.fixture
def fonts_home(tmp_path, monkeypatch):
    """每个用例一份独立的字体目录（``DATA_DIR/fonts`` 的父目录）。"""
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    return tmp_path / "fonts"


def _seed_fonts(directory: Path, *, active: str | None = None, names: dict | None = None) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / FONT_A).write_bytes(FONT_A_BYTES)
    (directory / FONT_B).write_bytes(FONT_B_BYTES)
    if active:
        (directory / user_fonts.ACTIVE_FILENAME).write_text(
            json.dumps({"name": active}, ensure_ascii=False), encoding="utf-8"
        )
    if names:
        (directory / user_fonts.NAMES_FILENAME).write_text(
            json.dumps(names, ensure_ascii=False), encoding="utf-8"
        )


def _manifest(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read(MANIFEST_MEMBER))


def _members(archive: Path) -> set[str]:
    with zipfile.ZipFile(archive) as handle:
        return set(handle.namelist())


def _tamper_member(archive: Path, member: str, payload: bytes) -> Path:
    target = archive.with_name(f"tampered-{archive.name}")
    with (
        zipfile.ZipFile(archive) as source,
        zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as destination,
    ):
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == member:
                data = payload
            destination.writestr(info, data)
    return target


def _post_import(client, archive: Path, name: str = "字体包") -> dict:
    response = client.post(
        f"/api/settings/datasets/import?name={name}",
        content=archive.read_bytes(),
        headers={"Content-Type": "application/zip"},
    )
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# 导出侧
# ---------------------------------------------------------------------------


def test_export_carries_fonts_and_bumps_the_format(fonts_home, tmp_path):
    _seed_fonts(fonts_home, active=FONT_A, names={FONT_B: "衬线"})

    archive = export_dataset("main", engine, tmp_path / "staging")
    manifest = _manifest(archive)
    members = _members(archive)

    assert manifest["format"] == BACKUP_FORMAT_GLOBAL_ASSETS == 6
    assert manifest["global_assets"] == {"version": GLOBAL_ASSETS_VERSION, "fonts": 2}
    assert GLOBAL_ASSETS_MEMBER in members
    assert {f"fonts/{FONT_A}", f"fonts/{FONT_B}"} <= members
    assert members & {"fonts/active.json", "fonts/names.json"}

    payload = read_global_assets_payload(archive)
    assert payload is not None
    assert payload["active"] == FONT_A
    recorded = {item["name"]: item for item in payload["fonts"]}
    assert recorded[FONT_A]["size_bytes"] == len(FONT_A_BYTES)
    assert recorded[FONT_B]["sha256"]


def test_empty_fonts_dir_keeps_the_format_at_five(fonts_home, tmp_path):
    """字体目录为空时不能虚升格式号：包里没带字体就不该让老版本拒收。"""
    assert build_global_assets_payload() is None
    write_global_llm(LLMConfig(base_url="https://example.invalid/v1", model="m", api_key="k"))

    archive = create_backup_archive(engine, tmp_path / "staging", include_global_llm=True)
    manifest = _manifest(archive)

    assert manifest["format"] == BACKUP_FORMAT_GLOBAL_CONFIG == 5
    assert "global_assets" not in manifest
    assert GLOBAL_ASSETS_MEMBER not in _members(archive)


def test_fonts_are_only_carried_by_the_outer_collection_package(fonts_home, tmp_path):
    """嵌套整包：字体只在**外层**带一次，子包里不该各存一份。"""
    from app.services.datasets import export_all_datasets

    _seed_fonts(fonts_home)
    archive = export_all_datasets(engine, tmp_path / "staging")
    manifest = _manifest(archive)

    assert manifest["format"] == BACKUP_FORMAT_GLOBAL_ASSETS
    with zipfile.ZipFile(archive) as outer:
        sub = outer.read("datasets/main.zip")
    with zipfile.ZipFile(io.BytesIO(sub)) as inner:
        assert GLOBAL_ASSETS_MEMBER not in set(inner.namelist())


# ---------------------------------------------------------------------------
# 导入侧
# ---------------------------------------------------------------------------


def test_restore_brings_back_fonts_names_and_active(fonts_home, tmp_path):
    _seed_fonts(fonts_home, active=FONT_A, names={FONT_B: "衬线"})
    archive = export_dataset("main", engine, tmp_path / "staging")

    payload = read_global_assets_payload(archive)
    assert payload is not None
    for path in fonts_home.iterdir():
        path.unlink()  # 模拟"换了一台机器"：本机一个字体都没有

    result = restore_global_assets(archive, payload)

    assert result["restored"] == 2
    assert (fonts_home / FONT_A).read_bytes() == FONT_A_BYTES
    assert (fonts_home / FONT_B).read_bytes() == FONT_B_BYTES
    assert user_fonts.active_font_name() == FONT_A
    assert result["active_set"] is True
    names = json.loads((fonts_home / user_fonts.NAMES_FILENAME).read_text(encoding="utf-8"))
    assert names[FONT_B] == "衬线"


def test_existing_font_is_kept_and_counted_as_skipped(fonts_home, tmp_path):
    _seed_fonts(fonts_home)
    archive = export_dataset("main", engine, tmp_path / "staging")
    payload = read_global_assets_payload(archive)
    assert payload is not None

    local_bytes = b"local-version-wins"
    (fonts_home / FONT_A).write_bytes(local_bytes)
    (fonts_home / FONT_B).unlink()  # 另一款本机没有 → 应该被恢复

    result = restore_global_assets(archive, payload)

    assert result["skipped"] == 1
    assert result["restored"] == 1
    assert (fonts_home / FONT_A).read_bytes() == local_bytes


def test_active_and_display_names_are_never_overridden(fonts_home, tmp_path):
    """本机已有选择/已有显示名时保留本机：字体是偏好，不是数据。"""
    _seed_fonts(fonts_home, active=FONT_A, names={FONT_B: "衬线"})
    archive = export_dataset("main", engine, tmp_path / "staging")
    payload = read_global_assets_payload(archive)
    assert payload is not None

    (fonts_home / user_fonts.ACTIVE_FILENAME).write_text(
        json.dumps({"name": FONT_B}, ensure_ascii=False), encoding="utf-8"
    )
    (fonts_home / user_fonts.NAMES_FILENAME).write_text(
        json.dumps({FONT_B: "本机起的名字"}, ensure_ascii=False), encoding="utf-8"
    )

    result = restore_global_assets(archive, payload)

    assert result["active_set"] is False
    assert user_fonts.active_font_name() == FONT_B
    names = json.loads((fonts_home / user_fonts.NAMES_FILENAME).read_text(encoding="utf-8"))
    assert names[FONT_B] == "本机起的名字"
    assert result["names_added"] == 0


def test_corrupt_font_is_reported_but_does_not_roll_back_the_dataset(fonts_home, tmp_path, client):
    """字体是附加物：它坏了，数据集照样恢复，界面拿到的是 font_issues 而不是失败。"""
    _seed_fonts(fonts_home)
    archive = export_dataset("main", engine, tmp_path / "staging")
    broken = _tamper_member(archive, f"fonts/{FONT_A}", b"not-the-same-bytes")

    result = _post_import(client, broken, "字体损坏包")

    assert result["id"]
    assert result["restored_fonts"] == 0
    assert result["font_issues"], "字体校验失败必须如实上报，不能静默"
    assert "A.ttf" in result["font_issues"][0]


def test_import_restores_fonts_through_the_api(fonts_home, tmp_path, client):
    _seed_fonts(fonts_home, active=FONT_A)
    archive = export_dataset("main", engine, tmp_path / "staging")
    for path in fonts_home.iterdir():
        path.unlink()

    result = _post_import(client, archive, "字体往返包")

    assert result["restored_fonts"] == 2
    assert result["skipped_fonts"] == 0
    assert result["active_font_set"] is True
    assert "font_issues" not in result
    assert (fonts_home / FONT_A).is_file()


# ---------------------------------------------------------------------------
# fail-closed
# ---------------------------------------------------------------------------


def test_unknown_global_assets_version_is_rejected():
    """段在但版本号不认识 → 拒收，不给"按自己读不懂的形状写用户字体目录"留门。"""
    from app.services.data_backup.import_archive import _read_manifest

    archive = Path(__file__).parent / "fixtures" / "backup-formats" / "format-6.zip"
    tampered = _tamper_member(
        archive,
        MANIFEST_MEMBER,
        json.dumps(
            {
                **_manifest(archive),
                "global_assets": {"version": GLOBAL_ASSETS_VERSION + 1, "fonts": 1},
            },
            ensure_ascii=False,
        ).encode("utf-8"),
    )

    with zipfile.ZipFile(tampered) as handle, pytest.raises(BackupError, match="字体清单"):
        _read_manifest(handle)
