# SPDX-License-Identifier: Apache-2.0
"""每份简历选字体（项 14）：选择要真的进入 HTML 与 PDF。

这条链路的失败方式与 R10 同款——**选了但没生效**：界面显示"用这款字"，导出的却是系统
字体或上一款，而没有任何报错。所以这里钉三件事：

1. ``format_config["font"]`` 能一路走到 HTML 的 ``@font-face``；
2. ``__system__`` 是**显式**"不用自定义字体"，不能被设备上的全局选择推翻；
3. PDF 侧的字体缓存**按字体名分键**：先解析 A 再解析 B，第二次必须拿到 B——这里最容易
   写出的 bug 是一个标量缓存（"换了字体导出没变"，且只有换个顺序才复现）。
"""

from __future__ import annotations

import pytest
from app.schemas.resume import ResumeContent
from app.services import resume_font_embed, user_fonts
from app.services.exporter import render_html
from app.services.pdf_exporter import reset_font_cache
from app.services.pdf_exporter.fonts import FONT_ENV_VAR, resolve_font_paths
from app.services.resume.resume_template_format import SYSTEM_FONT
from tests.font_fixtures import build_test_font

A_FONT = "思源黑体.ttf"
B_FONT = "霞鹜文楷.ttf"


@pytest.fixture(autouse=True)
def font_dir(tmp_path, monkeypatch):
    """字体目录换到临时目录，并清掉 PDF 侧的进程内缓存（它是模块级 dict）。"""
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    monkeypatch.delenv(FONT_ENV_VAR, raising=False)
    reset_font_cache()
    yield tmp_path
    reset_font_cache()


def _resume() -> ResumeContent:
    return ResumeContent(name="张三", job_intent="后端工程师", summary="三年后端开发经验。")


def _save_two_fonts() -> None:
    user_fonts.save_font(A_FONT, build_test_font())
    user_fonts.save_font(B_FONT, build_test_font())


# ===== HTML：@font-face 跟着这份简历的选择走 =====


def test_html_embeds_the_font_chosen_by_this_resume():
    _save_two_fonts()

    html = render_html(_resume(), format_config={"font": A_FONT})

    assert 'id="rf-font"' in html
    assert "@font-face" in html
    assert resume_font_embed.CSS_FAMILY in html


def test_html_system_font_sentinel_embeds_nothing():
    """显式"不用自定义字体"：连 ``@font-face`` 都不该有，模板自带的字体栈生效。"""
    _save_two_fonts()
    user_fonts.set_active(A_FONT)  # 设备上明明选了一个全局字体

    html = render_html(_resume(), format_config={"font": SYSTEM_FONT})

    assert 'id="rf-font"' not in html
    assert "@font-face" not in html


def test_html_without_font_follows_the_global_active_font(monkeypatch):
    """没设过（老简历）= 跟随设备上当前选中的字体，历史行为零改动。"""
    _save_two_fonts()
    user_fonts.set_active(A_FONT)
    calls: list[bool] = []
    original = user_fonts.active_font_path

    def spy():
        calls.append(True)
        return original()

    monkeypatch.setattr(user_fonts, "active_font_path", spy)

    html = render_html(_resume())

    assert calls, "没设字体时应当回落到全局当前字体"
    assert 'id="rf-font"' in html


def test_html_falls_back_when_the_chosen_font_was_deleted(monkeypatch):
    """选了字体、文件又被删：回落全局当前字体，而不是让整份简历打不开。"""
    _save_two_fonts()
    user_fonts.set_active(B_FONT)

    html = render_html(_resume(), format_config={"font": "早已删除.ttf"})

    # 名字在进渲染前就被 `validated_format_config` 丢弃了，于是走全局字体。
    assert 'id="rf-font"' in html


# ===== PDF：字体解析按名字分键 =====


def test_pdf_system_font_does_not_read_the_global_active_font(monkeypatch):
    """``__system__`` 必须真的绕开全局字体，否则这个选项等于没写。"""
    _save_two_fonts()
    user_fonts.set_active(A_FONT)
    calls: list[bool] = []

    def spy():
        calls.append(True)
        return None

    monkeypatch.setattr(user_fonts, "active_font_path", spy)

    resolve_font_paths(SYSTEM_FONT)

    assert calls == []


def test_pdf_resolves_the_named_font():
    _save_two_fonts()

    fonts = resolve_font_paths(A_FONT)

    assert fonts is not None
    regular, bold = fonts
    assert regular.endswith(A_FONT)
    assert bold.endswith(A_FONT)


def test_pdf_cache_is_keyed_by_font_name():
    """先解析 A 再解析 B，第二次必须拿到 B（C3 的核心，标量缓存会在这里说谎）。"""
    _save_two_fonts()

    first = resolve_font_paths(A_FONT)
    second = resolve_font_paths(B_FONT)

    assert first is not None and second is not None
    assert first[0].endswith(A_FONT)
    assert second[0].endswith(B_FONT)
    # 反向再来一次也不能串（缓存键是名字，不是"最后一次"）。
    assert resolve_font_paths(A_FONT)[0].endswith(A_FONT)
    assert resolve_font_paths(B_FONT)[0].endswith(B_FONT)


def test_pdf_falls_back_when_the_chosen_font_was_deleted():
    _save_two_fonts()
    user_fonts.set_active(B_FONT)

    fonts = resolve_font_paths("早已删除.ttf")

    assert fonts is not None
    # 回落到全局当前字体，而不是抛错。
    assert fonts[0].endswith(B_FONT)
