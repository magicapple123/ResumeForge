# SPDX-License-Identifier: Apache-2.0
"""Production backup boundaries: untrusted names, strict manifests and publishing races."""

import hashlib
import os
import zipfile
from contextlib import suppress

import pytest
from app.services.data_backup.asset_manifest import _assert_safe_asset_name
from app.services.data_backup.asset_restore import AssetRestorePlan
from app.services.data_backup.paths import BackupError


@pytest.mark.parametrize(
    "name", ["C:relative.bin", "file.bin:stream", "CON.txt", "LPT1", "tail.", "tail ", "tab\t.bin"]
)
def test_asset_names_reject_windows_escapes_and_aliases(name):
    with pytest.raises(BackupError):
        _assert_safe_asset_name(name, "user_files")


def _prepare_plan(tmp_path, *, valid_manifest=True):
    payload = b"synthetic archive content"
    archive = tmp_path / "source.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("user_files/safe.bin", payload)
    entry = {"name": "safe.bin"}
    if valid_manifest:
        entry.update(size_bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
    section = {"manifest_version": 1, "user_files": [entry]}
    destinations = {
        category: tmp_path / "destination" / category
        for category in ("user_files", "referral_images")
    }
    plan = AssetRestorePlan(tmp_path / "private-stage")
    return plan, archive, section, destinations


def test_new_manifest_cannot_skip_hash_and_size_verification(tmp_path):
    plan, archive, section, destinations = _prepare_plan(tmp_path, valid_manifest=False)
    with pytest.raises(BackupError):
        plan.add_section(
            archive,
            section,
            prefixes={"user_files": "user_files/", "referral_images": "referral_images/"},
            destinations=destinations,
            label="synthetic",
        )


def test_publish_does_not_replace_a_file_arriving_after_exists_check(tmp_path, monkeypatch):
    plan, archive, section, destinations = _prepare_plan(tmp_path)
    plan.add_section(
        archive,
        section,
        prefixes={"user_files": "user_files/", "referral_images": "referral_images/"},
        destinations=destinations,
        label="synthetic",
    )
    target = destinations["user_files"] / "safe.bin"
    late_payload = b"another writer's synthetic original"
    real_replace, real_link, real_rename = os.replace, os.link, os.rename

    def race(operation):
        def wrapped(source, destination, *args, **kwargs):
            if os.fspath(destination) == os.fspath(target):
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    target.write_bytes(late_payload)
            return operation(source, destination, *args, **kwargs)

        return wrapped

    monkeypatch.setattr(os, "replace", race(real_replace))
    monkeypatch.setattr(os, "link", race(real_link))
    monkeypatch.setattr(os, "rename", race(real_rename))
    with suppress(BackupError, OSError):
        plan.publish()
    assert target.read_bytes() == late_payload, (
        "Atomic publication must never overwrite a concurrent writer"
    )
