"""Reject malformed/duplicated sections before staging and keep archive validation linear."""

import io
import zipfile

import pytest
from app.services.data_backup import archive_guard
from app.services.data_backup.asset_safety import safe_asset_name
from app.services.data_backup.paths import BackupError


@pytest.mark.parametrize("value", ["CON .txt", "COM1 .bin", "name\ud800.bin"])
def test_windows_device_aliases_and_surrogates_cannot_be_asset_names(value):
    with pytest.raises(BackupError):
        safe_asset_name(value)


def test_repeated_dataset_sections_cannot_amplify_a_small_zip_into_unbounded_staging():
    entry = {"id": "a" * 16, "file": "datasets/" + "a" * 16 + ".db", "size_bytes": 20}
    with pytest.raises(BackupError, match="重复"):
        archive_guard.validate_manifest_assets({"datasets": [entry, dict(entry)]})


def test_extra_dataset_asset_schema_is_as_strict_as_the_main_schema():
    entry = {
        "id": "main",
        "file": "datasets/main.db",
        "size_bytes": 20,
        "asset_manifest": {"manifest_version": 999, "user_files": []},
    }
    with pytest.raises(BackupError, match="版本"):
        archive_guard.validate_manifest_assets({"datasets": [entry]})


def test_archive_metadata_is_validated_once_per_read_handle(tmp_path, monkeypatch):
    pack = tmp_path / "many.zip"
    with zipfile.ZipFile(pack, "w") as archive:
        for index in range(25):
            archive.writestr(f"user_files/synthetic-{index}.bin", b"test")
    calls = 0
    real_validate = archive_guard.safe_asset_name

    def counted(value, *args):
        nonlocal calls
        calls += 1
        return real_validate(value, *args)

    monkeypatch.setattr(archive_guard, "safe_asset_name", counted)
    with zipfile.ZipFile(pack) as archive:
        for index in range(25):
            archive_guard.copy_archive_member(
                archive, f"user_files/synthetic-{index}.bin", io.BytesIO()
            )
    assert calls == 50, "Do not re-scan all members for each attachment (quadratic import cost)"
