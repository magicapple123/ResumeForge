# SPDX-License-Identifier: Apache-2.0
"""Untrusted filenames must not select Windows special files or replace another writer."""

import builtins
from pathlib import Path

import pytest
from app.services.data_backup.paths import BackupError
from app.services.export_save_location import save_artifact
from tests.test_apply_browser_manager import _manager


@pytest.mark.parametrize(
    "name", ["C:relative.html", "document.html:stream", "CON.html", "tail.html."]
)
def test_saved_exports_reject_windows_ambiguous_names(tmp_path, name):
    with pytest.raises((BackupError, ValueError)):
        save_artifact(b"synthetic export", str(tmp_path), name)


def test_saved_export_keeps_a_file_created_in_the_last_write_window(tmp_path, monkeypatch):
    target = tmp_path / "resume.html"
    real_open = builtins.open

    def race(file, mode="r", *args, **kwargs):
        if Path(file) == target and ("w" in mode or "x" in mode) and not target.exists():
            with real_open(target, "wb") as original:
                original.write(b"another writer's synthetic original")
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", race)
    saved = Path(save_artifact(b"new synthetic export", str(tmp_path), "resume.html"))
    assert target.read_bytes() == b"another writer's synthetic original"
    assert saved != target
    assert saved.read_bytes() == b"new synthetic export"


@pytest.mark.parametrize(
    "url",
    [
        "--disable-web-security",
        "javascript:alert(1)",
        "file:///C:/private",
        "https://good.example\n--flag",
        "https:///no-host",
    ],
)
def test_browser_url_cannot_become_a_switch_or_privileged_protocol(tmp_path, url):
    from app.services.browser.browser_manager import BrowserError

    manager, popen = _manager(tmp_path)
    with pytest.raises(BrowserError):
        manager.start(url)
    assert popen.calls == []
