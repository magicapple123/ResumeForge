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

from pathlib import Path

import pytest
from app.schemas.resume import ResumeContent
from app.services import resume_font_builtin, resume_font_embed, user_fonts
from app.services.exporter import render_html
from app.services.pdf_exporter import fonts as pdf_fonts
from app.services.pdf_exporter import reset_font_cache
from app.services.pdf_exporter.fonts import FONT_ENV_VAR, resolve_font_paths
from app.services.resume.resume_template_format import SYSTEM_FONT
from tests.font_fixtures import build_test_font, write_font

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
    write_font(A_FONT, build_test_font())
    write_font(B_FONT, build_test_font())


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


# ===== PDF：系统候选全缺失时，用"已下载的内置字体"兜底 =====


def _install_builtin_fonts(monkeypatch, tmp_path: Path) -> tuple[Path, Path]:
    """造一份"已下载的内置思源黑体"。

    真字体两个合计 32MB，测试里造不出来（也不该造）：``downloaded_names()`` 只认
    "文件在 + 体积与清单对得上"，所以把清单换成几十字节的假条目、写同体积的文件，
    对探测函数而言与真下载完全等价。
    """
    # 文件必须落在 `DATA_DIR/fonts`（`resume_font_builtin.fonts_dir()` 就多拼这一层）。
    directory = tmp_path / "fonts"
    directory.mkdir(parents=True, exist_ok=True)
    regular = directory / "Fake-Builtin-Regular.otf"
    bold = directory / "Fake-Builtin-Bold.otf"
    regular.write_bytes(b"R" * 1024)
    bold.write_bytes(b"B" * 512)
    # 清单必须跟着换：`downloaded_names()` 正是按清单里的 name/bytes 对号入座的。
    monkeypatch.setattr(
        resume_font_builtin,
        "BUILTIN_FILES",
        (
            {"role": "regular", "name": regular.name, "bytes": 1024, "sha256": "0" * 64},
            {"role": "bold", "name": bold.name, "bytes": 512, "sha256": "0" * 64},
        ),
    )
    monkeypatch.setattr(resume_font_builtin, "DATA_DIR", str(tmp_path))
    reset_font_cache()
    return regular, bold


def test_pdf_falls_back_to_the_downloaded_builtin_font(monkeypatch, tmp_path):
    """系统候选一个都不在时，已下载的内置思源黑体是最后一级兜底。

    ``_FONT_CANDIDATES`` 里的 Linux 条目（Noto CJK / 文泉驿 / arphic）任何主流发行版
    都不默认安装，于是 Linux 上探测必然返回 None → 导出 409 → 用户被推回浏览器打印；
    而内置字体是他已经下到本机的 32MB。这里钉死"返回哪一对路径"：内置字体带独立的
    Bold 字面，必须**成对**返回（描边伪造的粗体在中文上会糊成一团）。
    """
    regular, bold = _install_builtin_fonts(monkeypatch, tmp_path)
    monkeypatch.setattr(pdf_fonts, "_FONT_CANDIDATES", ())

    assert resolve_font_paths(None) == (str(regular), str(bold))


def test_pdf_system_font_beats_the_downloaded_builtin_font(monkeypatch, tmp_path):
    """系统字体存在时**不得**被内置字体顶掉（优先级断言）。

    反过来的顺序会悄悄改掉 Windows/macOS 上「系统字体」的语义：用户选了"用系统字体"，
    导出的却成了下载来的思源黑体，而界面上没有任何提示。
    """
    system_regular = tmp_path / "System-Regular.ttc"
    system_bold = tmp_path / "System-Bold.ttc"
    system_regular.write_bytes(b"S" * 256)
    system_bold.write_bytes(b"T" * 256)
    _install_builtin_fonts(monkeypatch, tmp_path)
    monkeypatch.setattr(
        pdf_fonts, "_FONT_CANDIDATES", ((str(system_regular), str(system_bold)),)
    )

    assert resolve_font_paths(None) == (str(system_regular), str(system_bold))


def test_pdf_builtin_fallback_requires_the_files_on_disk(monkeypatch, tmp_path):
    """兜底只在**确实已下载**时成立：文件不在仍是 None，探测绝不触发下载。

    探测函数会在每次导出、每次模板列表时被调用；在这里发起 32MB 下载是灾难
    （用户只是打开了一下模板页）。
    """
    not_downloaded = tmp_path / "not-downloaded"
    monkeypatch.setattr(resume_font_builtin, "DATA_DIR", str(not_downloaded))
    monkeypatch.setattr(pdf_fonts, "_FONT_CANDIDATES", ())

    assert resolve_font_paths(None) is None
    assert not not_downloaded.exists()
