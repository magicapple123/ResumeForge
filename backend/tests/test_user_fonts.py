# SPDX-License-Identifier: Apache-2.0
"""自定义简历字体（R10）：上传、选用、删除。

这条链路的失败方式是"上传成功但导出没变"——没有报错、用户只会觉得功能坏了。所以
测试要钉住：文件落到数据目录、选中后 `active_font_path()` 指向它、删除时当前选择
一起清空（而不是留一个坏路径让 PDF 导出报错）。
"""

from __future__ import annotations

import base64

import pytest
from app.services import resume_font_embed, user_fonts
from app.services.pdf_exporter import reset_font_cache
from tests.font_fixtures import build_test_font


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
    assert active.json()["active"] == "测试字体.ttf"

    assert client.delete("/api/settings/fonts/测试字体.ttf").status_code == 204
    assert client.get("/api/settings/fonts").json()["active"] is None


def test_api_rejects_bad_extension(client):
    response = client.post(
        "/api/settings/fonts",
        files={"file": ("payload.exe", b"MZ", "application/octet-stream")},
    )
    assert response.status_code == 400


# ===== R10：把当前字体子集化内嵌进 HTML（预览 / 导出 HTML 同源）=====


def _payload_from_css(css: str) -> bytes:
    encoded = css.split("base64,", 1)[1].split(")", 1)[0]
    return base64.b64decode(encoded)


def test_embed_css_without_active_font_is_empty():
    """没选字体就什么都不输出：HTML 里不该出现孤零零的 @font-face。"""
    assert resume_font_embed.embed_css("简历张三") == ""
    assert resume_font_embed.active_web_font() is None


def test_embed_css_subset_is_base64_ttf():
    user_fonts.save_font("测试字体.ttf", build_test_font())
    user_fonts.set_active("测试字体.ttf")

    css = resume_font_embed.embed_css("简历张三")

    assert "@font-face" in css
    assert 'font-family:"ResumeActiveFont"' in css
    assert "data:font/ttf;base64," in css
    # 子集结果必须是真字体，而不是一段乱码被 base64 包起来。
    assert _payload_from_css(css).startswith(b"\x00\x01\x00\x00")
    assert len(_payload_from_css(css)) < resume_font_embed.MAX_EMBED_BYTES


def test_embed_css_falls_back_when_font_is_broken():
    """字体文件损坏只能退回系统字体：渲染失败会直接让用户打不开简历。"""
    user_fonts.save_font("broken.ttf", b"this is not a font")
    user_fonts.set_active("broken.ttf")

    assert resume_font_embed.active_web_font() is None
    assert resume_font_embed.embed_css("简历张三") == ""


def test_embed_css_gives_up_when_subset_is_too_big(monkeypatch):
    """体积保护：宁可退回系统字体，也不要把一份超大字塞进每个响应里。"""
    user_fonts.save_font("测试字体.ttf", build_test_font())
    user_fonts.set_active("测试字体.ttf")
    monkeypatch.setattr(resume_font_embed, "MAX_EMBED_BYTES", 64)

    assert resume_font_embed.embed_css("体积保护专用文本") == ""


def test_active_font_file_endpoint(client):
    assert client.get("/api/settings/fonts/active/file").status_code == 404

    font_bytes = build_test_font()
    user_fonts.save_font("测试字体.ttf", font_bytes)
    user_fonts.set_active("测试字体.ttf")

    response = client.get("/api/settings/fonts/active/file")

    assert response.status_code == 200
    assert response.headers["content-type"] == "font/ttf"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == font_bytes


def test_any_font_file_is_readable_for_preview(client):
    """预览不该要求"先设为当前"：任意已上传字体都要能拿到字节。"""
    font_bytes = build_test_font()
    user_fonts.save_font("预览字体.ttf", font_bytes)
    # 不调用 set_active：这正是重点。

    response = client.get("/api/settings/fonts/%E9%A2%84%E8%A7%88%E5%AD%97%E4%BD%93.ttf/file")

    assert response.status_code == 200
    assert response.headers["content-type"] == "font/ttf"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == font_bytes

    assert client.get("/api/settings/fonts/nope.ttf/file").status_code == 404
    # 只接受纯文件名：带目录成分的请求一律 404，避免越出 fonts 目录。
    assert client.get("/api/settings/fonts/..%2Fsecret.ttf/file").status_code == 404


def test_rename_only_changes_display_name():
    """重命名只改展示名：文件名（`format_config.font` 的键）必须原封不动。"""

    user_fonts.save_font("思源黑体.ttf", b"\x00\x01" * 64)
    assert user_fonts.list_fonts()[0]["display_name"] == "思源黑体"

    user_fonts.rename_font("思源黑体.ttf", "  正文宋  ")

    item = user_fonts.list_fonts()[0]
    assert item["name"] == "思源黑体.ttf"
    assert item["display_name"] == "正文宋"

    # 改名不影响"能不能按文件名取到文件"，也不影响已选中它的简历。
    user_fonts.set_active("思源黑体.ttf")
    assert user_fonts.active_font_path().name == "思源黑体.ttf"


def test_rename_rejects_empty_and_cleans_up_on_delete():
    user_fonts.save_font("思源黑体.ttf", b"\x00\x01" * 64)
    with pytest.raises(user_fonts.FontError):
        user_fonts.rename_font("思源黑体.ttf", "   ")

    user_fonts.rename_font("思源黑体.ttf", "正文宋")
    user_fonts.delete_font("思源黑体.ttf")

    # 删除后展示名条目也要清掉，否则重新上传同名文件会继承一个旧名字。
    user_fonts.save_font("思源黑体.ttf", b"\x00\x01" * 64)
    assert user_fonts.list_fonts()[0]["display_name"] == "思源黑体"
