"""诊断包导出的守卫：zip 内容、脱敏兜底、文件名。"""

import io
import json
import zipfile
from pathlib import Path

import pytest
from app.api import system as system_api
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_export_diagnostics_returns_zip_with_expected_members():
    response = client.get("/api/system/diagnostics/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"].startswith(
        'attachment; filename="resumeforge-diagnostics-'
    )
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = set(archive.namelist())
    assert {"diagnostics.json", "system.json"} <= names
    payload = json.loads(archive.read("diagnostics.json").decode("utf-8"))
    assert "events" in payload
    system = json.loads(archive.read("system.json").decode("utf-8"))
    assert system["app_version"]


def test_recent_log_tail_redacts_token_like_strings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """日志尾部进诊断包前必须抹掉疑似令牌；这是给支持者看的最后一道闸。"""
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "backend.log").write_text(
        "2026-10-07 INFO [app.api] [request_id=abc] 请求处理完成\n"
        "2026-10-07 INFO [app.llm] [request_id=abc] using key sk-abcdef1234567890abcdef\n"
        "2026-10-07 INFO [app.x] [request_id=abc] blob "
        "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2xtbm9wcXJzdHV2\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(system_api, "DATA_DIR", tmp_path)
    tail = system_api._recent_log_tail()
    assert "请求处理完成" in tail
    assert "sk-abcdef1234567890abcdef" not in tail
    assert "<redacted>" in tail
    assert "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2xtbm9wcXJzdHV2" not in tail


def test_recent_log_tail_missing_file_is_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(system_api, "DATA_DIR", tmp_path)
    assert system_api._recent_log_tail() == ""
