"""自定义简历字体（R10）：上传、选用、删除。

这条链路的失败方式是"上传成功但导出没变"——没有报错、用户只会觉得功能坏了。所以
测试要钉住：文件落到数据目录、选中后 `active_font_path()` 指向它、删除时当前选择
一起清空（而不是留一个坏路径让 PDF 导出报错）。
"""

from __future__ import annotations

import pytest
from app.services import user_fonts
from app.services.pdf_exporter import reset_font_cache


@pytest.fixture(autouse=True)
def font_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    reset_font_cache()
    yield tmp_path
    reset_font_cache()


def test_upload_list_and_activate():
    item = user_fonts.save_font("思源黑体.ttf", b"\x00\x01" * 64)
    assert item["name"] == "思源黑体.ttf"

    items = user_fonts.list_fonts()
    assert [entry["name"] for entry in items] == ["思源黑体.ttf"]
    assert items[0]["active"] is False

    user_fonts.set_active("思源黑体.ttf")

    assert user_fonts.active_font_name() == "思源黑体.ttf"
    assert user_fonts.active_font_path().name == "思源黑体.ttf"
    assert user_fonts.list_fonts()[0]["active"] is True


def test_unsupported_extension_is_rejected():
    with pytest.raises(user_fonts.FontError):
        user_fonts.save_font("evil.exe", b"MZ")


def test_path_traversal_is_stripped():
    """文件名里带 ../ 也只取最后一段，不会写到数据目录之外。"""
    item = user_fonts.save_font("../../etc/passwd.ttf", b"x" * 16)
    assert item["name"] == "passwd.ttf"
    assert user_fonts.active_font_path() is None


def test_too_large_is_rejected():
    with pytest.raises(user_fonts.FontError):
        user_fonts.save_font("big.ttf", b"x" * (user_fonts.MAX_BYTES + 1))


def test_deleting_the_active_font_clears_the_choice():
    user_fonts.save_font("a.ttf", b"x" * 32)
    user_fonts.set_active("a.ttf")

    user_fonts.delete_font("a.ttf")

    assert user_fonts.list_fonts() == []
    # 留着一个指向已删文件的 active，会让 PDF 导出拿着不存在的路径去注册字体。
    assert user_fonts.active_font_name() is None
    assert user_fonts.active_font_path() is None


def test_api_roundtrip(client):
    upload = client.post(
        "/api/settings/fonts",
        files={"file": ("测试字体.ttf", b"\x00\x01" * 32, "font/ttf")},
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["name"] == "测试字体.ttf"

    listed = client.get("/api/settings/fonts").json()
    assert [entry["name"] for entry in listed["items"]] == ["测试字体.ttf"]

    active = client.put("/api/settings/fonts/active", json={"name": "测试字体.ttf"})
    assert active.status_code == 200
    assert active.json()["active"] == {"name": "测试字体.ttf", "builtin": False}

    assert client.delete("/api/settings/fonts/测试字体.ttf").status_code == 204
    assert client.get("/api/settings/fonts").json()["active"] is None


def test_api_rejects_bad_extension(client):
    response = client.post(
        "/api/settings/fonts",
        files={"file": ("payload.exe", b"MZ", "application/octet-stream")},
    )
    assert response.status_code == 400


# ===== 内置字体（随包分发的 OFL 字体）=====


def test_builtin_fonts_are_listed_and_resolvable(font_dir):
    builtin = user_fonts.list_builtin_fonts()
    assert len(builtin) == len(user_fonts.BUILTIN_FONTS)
    assert all(item["builtin"] and item["size"] > 0 for item in builtin)

    name = builtin[0]["name"]
    user_fonts.set_active(name, builtin=True)

    info = user_fonts.active_font_info()
    assert info == {"name": name, "builtin": True}
    path = user_fonts.active_font_path()
    assert path is not None and path.parent == user_fonts.ASSETS_DIR


def test_builtin_font_must_exist(font_dir):
    with pytest.raises(user_fonts.FontError):
        user_fonts.set_active("不存在.ttf", builtin=True)


def test_custom_and_builtin_switch_cleanly(font_dir):
    user_fonts.save_font("custom.ttf", b"x" * 32)
    user_fonts.set_active("custom.ttf")
    assert user_fonts.active_font_info()["builtin"] is False

    builtin = user_fonts.list_builtin_fonts()[0]["name"]
    user_fonts.set_active(builtin, builtin=True)
    assert user_fonts.active_font_path().parent == user_fonts.ASSETS_DIR

    # 删自定义字体不该动到内置字体的选择。
    user_fonts.delete_font("custom.ttf")
    assert user_fonts.active_font_info() == {"name": builtin, "builtin": True}
