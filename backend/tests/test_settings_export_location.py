"""「生成内容保存位置」设置：目录校验、设置读写与导出落盘。

默认语义是**零变化**：设置留空时导出行为与历史版本完全一致（不落盘、无
``X-Saved-To`` 头）；设置非空时导出在返回下载响应的同时多写一份到指定目录。
"""
from urllib.parse import unquote

from app.services.export_save_location import validate_directory

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


def test_put_rejects_an_invalid_directory_with_reason(client, tmp_path):
    response = client.put(
        "/api/settings/export-save-location",
        json={"path": str(tmp_path / "missing")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "目录不存在"


def test_put_then_get_round_trips_a_valid_directory(client, tmp_path):
    saved = client.put(
        "/api/settings/export-save-location", json={"path": str(tmp_path)}
    )
    assert saved.status_code == 200
    assert saved.json()["path"] == str(tmp_path)

    loaded = client.get("/api/settings/export-save-location")
    assert loaded.status_code == 200
    assert loaded.json()["path"] == str(tmp_path)


def test_put_empty_string_restores_default(client, tmp_path):
    client.put("/api/settings/export-save-location", json={"path": str(tmp_path)})
    cleared = client.put("/api/settings/export-save-location", json={"path": ""})
    assert cleared.status_code == 200
    assert cleared.json()["path"] == ""
    assert client.get("/api/settings/export-save-location").json()["path"] == ""


# ===== 导出落盘分支 =====


def _create_resume(client) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "落盘测试", "content": {"name": "张三", "summary": "测试"}},
    )
    assert created.status_code in (200, 201), created.text
    return created.json()["id"]


def test_export_saves_a_copy_and_reports_the_path(client, tmp_path):
    record_id = _create_resume(client)
    client.put("/api/settings/export-save-location", json={"path": str(tmp_path)})

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
    client.put("/api/settings/export-save-location", json={"path": str(gone)})
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
