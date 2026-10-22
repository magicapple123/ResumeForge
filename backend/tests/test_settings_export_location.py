# SPDX-License-Identifier: Apache-2.0
"""「生成内容保存位置」设置：目录校验、设置读写与导出落盘。

默认语义是**零变化**：设置留空时导出行为与历史版本完全一致（不落盘、无
``X-Saved-To`` 头）；设置非空时导出在返回下载响应的同时多写一份到指定目录。
"""

from urllib.parse import unquote

import pytest
from app.database import SessionLocal
from app.main import app
from app.services.export_save_location import validate_directory
from app.services.settings_service import save_export_save_location
from fastapi.testclient import TestClient

# ===== validate_directory：三态 =====


def test_validate_directory_accepts_a_real_directory(tmp_path):
    assert validate_directory(str(tmp_path)) is None


def test_validate_directory_rejects_a_missing_directory(tmp_path):
    assert validate_directory(str(tmp_path / "not_here")) == "目录不存在"


def test_validate_directory_rejects_a_file(tmp_path):
    target = tmp_path / "plain_file.txt"
    target.write_text("x", encoding="utf-8")
    assert validate_directory(str(target)) == "不是目录"


# ===== 设置端点：读写与非法目录 =====


def _choose_save_location(client, monkeypatch, selected: str):
    monkeypatch.setattr("app.api.settings.pick_directory", lambda: selected)
    response = client.post("/api/settings/export-save-location/pick")
    assert response.status_code == 200, response.text
    assert response.json()["path"] == selected


def test_put_rejects_client_supplied_directory_without_filesystem_access(
    client, tmp_path, monkeypatch
):
    calls = []
    monkeypatch.setattr("app.api.settings.validate_directory", lambda path: calls.append(path))
    response = client.put(
        "/api/settings/export-save-location",
        json={"path": str(tmp_path / "missing")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "保存位置只能由「选择文件夹」写入"
    assert calls == []
    assert client.get("/api/settings/export-save-location").json()["path"] == ""


def test_folder_picker_validates_and_persists_selected_directory(client, monkeypatch, tmp_path):
    monkeypatch.setattr("app.api.settings.pick_directory", lambda: str(tmp_path))
    selected = client.post("/api/settings/export-save-location/pick")
    assert selected.status_code == 200
    assert selected.json()["path"] == str(tmp_path)

    loaded = client.get("/api/settings/export-save-location")
    assert loaded.status_code == 200
    assert loaded.json()["path"] == str(tmp_path)


def test_folder_picker_rejects_invalid_directory_without_persisting(client, monkeypatch, tmp_path):
    monkeypatch.setattr("app.api.settings.pick_directory", lambda: str(tmp_path / "missing"))
    selected = client.post("/api/settings/export-save-location/pick")
    assert selected.status_code == 400
    assert selected.json()["detail"] == "目录不存在"
    assert client.get("/api/settings/export-save-location").json()["path"] == ""


def test_put_empty_string_restores_default(client, tmp_path, monkeypatch):
    _choose_save_location(client, monkeypatch, str(tmp_path))
    cleared = client.put("/api/settings/export-save-location", json={"clear": True})
    assert cleared.status_code == 200
    assert cleared.json()["path"] == ""
    assert client.get("/api/settings/export-save-location").json()["path"] == ""


def test_remote_client_cannot_read_the_local_save_directory(client, tmp_path, monkeypatch):
    _choose_save_location(client, monkeypatch, str(tmp_path))
    with TestClient(app, client=("192.0.2.1", 50001)) as remote:
        response = remote.get("/api/settings/export-save-location")
    assert response.status_code == 403
    assert "path" not in response.json()


# ===== 导出落盘分支 =====


def _create_resume(client) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "落盘测试", "content": {"name": "张三", "summary": "测试"}},
    )
    assert created.status_code in (200, 201), created.text
    return created.json()["id"]


def test_export_saves_a_copy_and_reports_the_path(client, tmp_path, monkeypatch):
    record_id = _create_resume(client)
    _choose_save_location(client, monkeypatch, str(tmp_path))

    response = client.get(f"/api/resumes/{record_id}/export?format=json")

    assert response.status_code == 200
    assert "X-Saved-To" in response.headers
    saved_to = unquote(response.headers["X-Saved-To"])
    assert saved_to.startswith(str(tmp_path))

    files = list(tmp_path.iterdir())
    assert len(files) == 1
    assert str(files[0]) == saved_to
    # 落盘的就是返回给浏览器的同一份产物
    assert files[0].read_bytes() == response.content


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.example"},
        {"Sec-Fetch-Site": "cross-site"},
        {"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"},
        {"Origin": "http://localhost:5173", "Sec-Fetch-Site": "cross-site"},
        {"Origin": "null"},
        {"Origin": "not-an-origin"},
    ],
)
def test_cross_site_export_does_not_write_to_the_configured_local_directory(
    client, tmp_path, headers, monkeypatch
):
    """Cross-site GETs cannot read private exports or trigger local disk writes."""
    record_id = _create_resume(client)
    _choose_save_location(client, monkeypatch, str(tmp_path))
    calls = []
    monkeypatch.setattr(
        "app.api.resumes.export_routes.validate_directory", lambda path: calls.append(path)
    )

    response = client.get(f"/api/resumes/{record_id}/export?format=json", headers=headers)

    assert response.status_code == 403
    assert "X-Saved-To" not in response.headers
    assert list(tmp_path.iterdir()) == []
    assert calls == []


@pytest.mark.parametrize("method", ["get", "post"])
@pytest.mark.parametrize("host", ["192.0.2.1", "::ffff:192.0.2.1"])
def test_remote_export_does_not_probe_or_save_to_local_directory(
    client, tmp_path, monkeypatch, method, host
):
    record_id = _create_resume(client)
    _choose_save_location(client, monkeypatch, str(tmp_path))
    calls = []
    monkeypatch.setattr(
        "app.api.resumes.export_routes.validate_directory", lambda path: calls.append(path)
    )
    with TestClient(app, client=(host, 50001)) as remote:
        if method == "get":
            response = remote.get(f"/api/resumes/{record_id}/export?format=json")
        else:
            response = remote.post(f"/api/resumes/{record_id}/export", json={"format": "json"})

    assert response.status_code == 403
    assert "X-Saved-To" not in response.headers
    assert list(tmp_path.iterdir()) == []
    assert calls == []


@pytest.mark.parametrize("method", ["get", "post"])
@pytest.mark.parametrize("host", ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
def test_local_export_preserves_saved_copy_for_both_routes(
    client, tmp_path, monkeypatch, method, host
):
    record_id = _create_resume(client)
    _choose_save_location(client, monkeypatch, str(tmp_path))
    with TestClient(app, client=(host, 50001)) as local:
        if method == "get":
            response = local.get(
                f"/api/resumes/{record_id}/export?format=json",
                headers={"Origin": "http://localhost:5173", "Sec-Fetch-Site": "same-origin"},
            )
        else:
            response = local.post(f"/api/resumes/{record_id}/export", json={"format": "json"})

    assert response.status_code == 200
    assert "X-Saved-To" in response.headers
    files = list(tmp_path.iterdir())
    assert len(files) == 1
    assert files[0].read_bytes() == response.content


def test_export_with_empty_setting_keeps_default_behavior(client, tmp_path):
    record_id = _create_resume(client)

    response = client.get(f"/api/resumes/{record_id}/export?format=json")

    assert response.status_code == 200
    assert "X-Saved-To" not in response.headers
    assert list(tmp_path.iterdir()) == []


def test_export_survives_an_unwritable_save_directory(client, tmp_path):
    """目录设置后失效（被删/变成只读）：导出必须照常返回，只是不落盘。"""
    record_id = _create_resume(client)
    gone = tmp_path / "gone"
    gone.mkdir()
    with SessionLocal() as db:
        save_export_save_location(db, str(gone))
    gone.rmdir()

    response = client.get(f"/api/resumes/{record_id}/export?format=json")

    assert response.status_code == 200
    assert "X-Saved-To" not in response.headers
    assert list(tmp_path.iterdir()) == []


# ===== 文件夹点选（原生选择器子进程的端点包装） =====


def test_pick_endpoint_returns_the_selected_path(client, monkeypatch, tmp_path):
    import app.services.export_save_location as esl

    class _Proc:
        returncode = 0
        stdout = f"{tmp_path}\n"
        stderr = ""

    monkeypatch.setattr(esl.subprocess, "run", lambda *a, **kw: _Proc())
    response = client.post("/api/settings/export-save-location/pick")
    assert response.status_code == 200
    assert response.json()["path"] == str(tmp_path)
    assert client.get("/api/settings/export-save-location").json()["path"] == str(tmp_path)


def test_pick_endpoint_returns_none_when_cancelled(client, monkeypatch):
    import app.services.export_save_location as esl

    class _Proc:
        returncode = 0
        stdout = "\n"
        stderr = ""

    monkeypatch.setattr(esl.subprocess, "run", lambda *a, **kw: _Proc())
    response = client.post("/api/settings/export-save-location/pick")
    assert response.status_code == 200
    assert response.json()["path"] is None


def test_pick_endpoint_reports_unavailable_environment(client, monkeypatch):
    import app.services.export_save_location as esl

    def _boom(*_a, **_kw):
        raise OSError("no display")

    monkeypatch.setattr(esl.subprocess, "run", _boom)
    response = client.post("/api/settings/export-save-location/pick")
    assert response.status_code == 503
    assert "重试" in response.json()["detail"]
