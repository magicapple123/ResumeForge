# SPDX-License-Identifier: Apache-2.0
"""简历字体（R10）：列表、选用、重命名、删除、子集内嵌。

**上传接口已于 2026-11 下线**：字体来源收敛为"内置思源黑体按需下载"+ 历史上传的文件。
所以本文件不再测"上传校验"，改为直接往字体目录写文件（``write_font``）再验证后续链路——
存量用户的那批文件走的正是这条路径。

这条链路的失败方式是"选中了但导出没变"——没有报错、用户只会觉得功能坏了。所以测试要
钉住：选中后 `active_font_path()` 指向它、删除时当前选择一起清空（而不是留一个坏路径
让 PDF 导出报错）。
"""

from __future__ import annotations

import base64

import pytest
from app.services import resume_font_builtin, resume_font_embed, user_fonts
from app.services.pdf_exporter import reset_font_cache
from tests.font_fixtures import build_test_font, write_font


@pytest.fixture(autouse=True)
def font_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    # 内置字体的下载模块有自己的 DATA_DIR（叶子模块，不读 user_fonts）：两个都要指到
    # 临时目录，否则"下载状态"会去扫真实的 data/fonts。
    monkeypatch.setattr(resume_font_builtin, "DATA_DIR", str(tmp_path))
    resume_font_builtin.reset_state()
    reset_font_cache()
    yield tmp_path
    resume_font_builtin.reset_state()
    reset_font_cache()


def _user_items() -> list[dict]:
    """列表里"用户字体"那部分（首位固定是内置思源黑体）。"""
    return [item for item in user_fonts.list_fonts() if not item.get("builtin")]


def test_list_and_activate():
    write_font("思源黑体.ttf", b"\x00\x01" * 64)

    items = _user_items()
    assert [entry["name"] for entry in items] == ["思源黑体.ttf"]
    assert items[0]["active"] is False

    user_fonts.set_active("思源黑体.ttf")

    assert user_fonts.active_font_name() == "思源黑体.ttf"
    assert user_fonts.active_font_path().name == "思源黑体.ttf"
    assert _user_items()[0]["active"] is True


def test_deleting_the_active_font_clears_the_choice():
    write_font("a.ttf", b"x" * 32)
    user_fonts.set_active("a.ttf")

    user_fonts.delete_font("a.ttf")

    assert user_fonts.list_fonts() == []
    # 留着一个指向已删文件的 active，会让 PDF 导出拿着不存在的路径去注册字体。
    assert user_fonts.active_font_name() is None
    assert user_fonts.active_font_path() is None


def test_upload_endpoint_is_gone(client):
    """上传已下线：`POST /api/settings/fonts` 不该再存在（该路径只剩 GET）。"""
    response = client.post(
        "/api/settings/fonts",
        files={"file": ("新字体.ttf", b"\x00\x01" * 32, "font/ttf")},
    )
    assert response.status_code == 405


def test_builtin_font_is_listed_first_as_one_item(client):
    """内置思源黑体在列表首位、合并成一条（两个文件在界面上是一款字体）。"""
    items = client.get("/api/settings/fonts").json()["items"]

    builtin = items[0]
    assert builtin["builtin"] is True
    assert builtin["name"] == "SourceHanSansSC-Regular.otf"
    assert builtin["display_name"] == "思源黑体"
    # 两个文件（Regular + Bold）之和：用户看到的是"这款字体占多大"。
    assert builtin["size"] == 33493260
    assert builtin["downloaded"] is False
    assert builtin["active"] is False
    # Bold 不能作为独立条目出现：它是 Regular 的粗体字面，不是另一款字体。
    assert [item["name"] for item in items] == ["SourceHanSansSC-Regular.otf"]


def test_api_roundtrip(client):
    write_font("测试字体.ttf", b"\x00\x01" * 32)

    listed = client.get("/api/settings/fonts").json()
    user_items = [item for item in listed["items"] if not item.get("builtin")]
    assert [entry["name"] for entry in user_items] == ["测试字体.ttf"]

    active = client.put("/api/settings/fonts/active", json={"name": "测试字体.ttf"})
    assert active.status_code == 200
    assert active.json()["active"] == "测试字体.ttf"

    assert client.delete("/api/settings/fonts/测试字体.ttf").status_code == 204
    assert client.get("/api/settings/fonts").json()["active"] is None


# ===== R10：把当前字体子集化内嵌进 HTML（预览 / 导出 HTML 同源）=====


def _payload_from_css(css: str) -> bytes:
    encoded = css.split("base64,", 1)[1].split(")", 1)[0]
    return base64.b64decode(encoded)


def test_embed_css_without_active_font_is_empty():
    """没选字体就什么都不输出：HTML 里不该出现孤零零的 @font-face。"""
    assert resume_font_embed.embed_css("简历张三") == ""
    assert resume_font_embed.active_web_font() is None


def test_embed_css_subset_is_base64_ttf():
    write_font("测试字体.ttf", build_test_font())
    user_fonts.set_active("测试字体.ttf")

    css = resume_font_embed.embed_css("简历张三")

    assert "@font-face" in css
    assert 'font-family:"ResumeActiveFont"' in css
    assert "data:font/ttf;base64," in css
    # 单文件字体只出一条 400 字重的 face（浏览器对 700 自行合成，与历史行为一致）。
    assert css.count("@font-face") == 1
    assert "font-weight:400" in css
    # 子集结果必须是真字体，而不是一段乱码被 base64 包起来。
    assert _payload_from_css(css).startswith(b"\x00\x01\x00\x00")
    assert len(_payload_from_css(css)) < resume_font_embed.MAX_EMBED_BYTES


def test_embed_css_falls_back_when_font_is_broken():
    """字体文件损坏只能退回系统字体：渲染失败会直接让用户打不开简历。"""
    write_font("broken.ttf", b"this is not a font")
    user_fonts.set_active("broken.ttf")

    assert resume_font_embed.active_web_font() is None
    assert resume_font_embed.embed_css("简历张三") == ""


def test_embed_css_gives_up_when_subset_is_too_big(monkeypatch):
    """体积保护：宁可退回系统字体，也不要把一份超大字塞进每个响应里。"""
    write_font("测试字体.ttf", build_test_font())
    user_fonts.set_active("测试字体.ttf")
    monkeypatch.setattr(resume_font_embed, "MAX_EMBED_BYTES", 64)

    assert resume_font_embed.embed_css("体积保护专用文本") == ""


def test_active_font_file_endpoint(client):
    assert client.get("/api/settings/fonts/active/file").status_code == 404

    font_bytes = build_test_font()
    write_font("测试字体.ttf", font_bytes)
    user_fonts.set_active("测试字体.ttf")

    response = client.get("/api/settings/fonts/active/file")

    assert response.status_code == 200
    assert response.headers["content-type"] == "font/ttf"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == font_bytes


def test_any_font_file_is_readable_for_preview(client):
    """预览不该要求"先设为当前"：任意已有字体都要能拿到字节。"""
    font_bytes = build_test_font()
    write_font("预览字体.ttf", font_bytes)
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

    write_font("思源黑体.ttf", b"\x00\x01" * 64)
    assert _user_items()[0]["display_name"] == "思源黑体"

    user_fonts.rename_font("思源黑体.ttf", "  正文宋  ")

    item = _user_items()[0]
    assert item["name"] == "思源黑体.ttf"
    assert item["display_name"] == "正文宋"

    # 改名不影响"能不能按文件名取到文件"，也不影响已选中它的简历。
    user_fonts.set_active("思源黑体.ttf")
    assert user_fonts.active_font_path().name == "思源黑体.ttf"


def test_rename_rejects_empty_and_cleans_up_on_delete():
    write_font("思源黑体.ttf", b"\x00\x01" * 64)
    with pytest.raises(user_fonts.FontError):
        user_fonts.rename_font("思源黑体.ttf", "   ")

    user_fonts.rename_font("思源黑体.ttf", "正文宋")
    user_fonts.delete_font("思源黑体.ttf")

    # 删除后展示名条目也要清掉，否则同名文件重新出现时会继承一个旧名字。
    write_font("思源黑体.ttf", b"\x00\x01" * 64)
    assert _user_items()[0]["display_name"] == "思源黑体"


# ===== 内置双字重：Regular / Bold 成对解析 =====


def test_font_pair_for_single_file_font_is_the_same_path():
    write_font("单独.ttf", build_test_font())
    regular, bold = user_fonts.font_pair("单独.ttf")
    assert regular == bold


def test_font_pair_for_builtin_uses_the_bold_file():
    """内置字体必须成对返回：PDF 的真加粗靠 Bold 字面，不是描边。"""
    write_font("SourceHanSansSC-Regular.otf", build_test_font())
    write_font("SourceHanSansSC-Bold.otf", build_test_font())

    regular, bold = user_fonts.font_pair("SourceHanSansSC-Regular.otf")

    assert regular.name == "SourceHanSansSC-Regular.otf"
    assert bold.name == "SourceHanSansSC-Bold.otf"


def test_builtin_files_are_hidden_from_the_plain_list():
    """`list_fonts()` 默认不把内置的两个文件当普通条目（界面只显示一条"思源黑体"）。"""
    write_font("SourceHanSansSC-Regular.otf", build_test_font())
    write_font("SourceHanSansSC-Bold.otf", build_test_font())

    assert user_fonts.list_fonts() == []
    names = [item["name"] for item in user_fonts.list_fonts(include_builtin=True)]
    assert set(names) == {"SourceHanSansSC-Regular.otf", "SourceHanSansSC-Bold.otf"}


def test_embed_css_emits_two_faces_for_the_builtin_pair():
    write_font("SourceHanSansSC-Regular.otf", build_test_font(family="Regular"))
    write_font("SourceHanSansSC-Bold.otf", build_test_font(family="Bold"))
    user_fonts.set_active("SourceHanSansSC-Regular.otf")

    css = resume_font_embed.embed_css("简历张三")

    assert css.count("@font-face") == 2
    assert "font-weight:400" in css
    assert "font-weight:700" in css


def test_active_font_paths_returns_none_without_choice():
    assert user_fonts.active_font_paths() is None
