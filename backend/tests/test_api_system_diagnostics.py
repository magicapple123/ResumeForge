# SPDX-License-Identifier: Apache-2.0
"""诊断包导出的守卫：zip 内容、脱敏兜底、文件名。"""

import io
import json
import zipfile
from pathlib import Path

import pytest
from app.api import system as system_api
from app.main import app
from app.services.diagnostics import record_event
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


def test_preview_reports_metadata_without_event_bodies():
    """导出前预览：只有元信息（条数/时间范围/类别/文件体积），不返回事件正文。"""
    record_event("test.preview", note="合成内容")

    response = client.get("/api/system/diagnostics/preview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["event_count"] >= 1
    assert payload["time_range"] is not None
    assert "test.preview" in payload["categories"]
    assert {item["name"] for item in payload["files"]} >= {"diagnostics.json", "system.json"}
    assert all(item["bytes"] > 0 for item in payload["files"])
    assert payload["contains_resume_content"] is False
    assert "不包含简历全文" in payload["note"]
    # 预览不应把事件正文（note 的值）带回给页面。
    assert "合成内容" not in response.text


def test_exported_zip_contains_no_contact_info_or_secrets():
    """负例钉住口径（RF-20 验收）：注入合成联系方式/密钥后，导出 zip 里找不到原值。"""
    contact_like = "mail zhangsan@example.com phone 13800138000 key sk-abcdef1234567890"
    record_event("test.negative", path=f"/resumes?q={contact_like}")

    response = client.get("/api/system/diagnostics/export")

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    members = archive.namelist()
    # zip 成员白名单：只有脱敏事件、系统信息与（可选）日志尾部，别无其它。
    assert set(members) <= {"diagnostics.json", "system.json", "backend-recent.log"}
    # zip 是压缩存储的：逐成员解压后再做"无原值"断言。
    blob = "\n".join(archive.read(name).decode("utf-8", errors="replace") for name in members)
    for secret in ("zhangsan@example.com", "13800138000", "sk-abcdef1234567890"):
        assert secret not in blob
    # 脱敏后的占位符确实在包里，证明事件走了清洗路径而不是被整个丢弃。
    assert "<redacted>" in blob
