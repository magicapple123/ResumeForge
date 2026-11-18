# SPDX-License-Identifier: Apache-2.0
"""I-41：姓名字距（`letter_spacing`）必须在 PDF 与 Word 上真的生效。

从 `test_resume_header_style.py` 单独成文件：那里的六条用例钉的是"取哪一份样式"，
这里钉的是"取到的字距怎么变成纸面上的宽度"。两者失败时的症状完全不同——取值错了是
"设了没反应"，宽度错了是"设了但折行/页头高度对不上"，混在一个文件里会互相掩盖。

三件事必须同时成立，否则三出口宽度对不上（清单 I-41 验收 1/2/6）：

1. **量宽与画宽同源**：`plan_name_gender` 与 `draw_name_gender` 只能通过
   `name_gender.name_text_width` 得到姓名宽度——各自 `get_string_width` 一次就会
   "量的不含字距、画的含"，表现为文字画出去被裁或性别被挤到下一行，且不报错。
2. **报告口径是 `(len - 1)`**：`set_char_spacing` 不加在最后一个字符之后。
3. **负字距夹到 -0.1em**：HTML / PDF / Word 共用 `resume_style.clamp_letter_spacing`。
"""

from __future__ import annotations

import pytest
from app.services.pdf_exporter import _PX_TO_MM, _PX_TO_PT, _ResumePDF, build_resume_pdf
from app.services.pdf_exporter.name_gender import plan_name_gender
from app.services.resume.resume_header_style import name_block_styles
from app.services.resume.resume_style import (
    MIN_LETTER_SPACING,
    RoleStyle,
    _declarations,
    clamp_letter_spacing,
)
from app.services.resume.resume_templates import FONT_SCALES
from docx.oxml.ns import qn
from test_pdf_exporter import _pdf_with_font, needs_font
from test_resume_header_style import (
    NAME_FIELD,
    _document,
    _docx_name_paragraph,
    _docx_run,
    _header,
    _style_factory,
)

#: 默认字号档的基准字号（px）。字距是"× 基准字号"，与 HTML 的 `var(--fs)` 同口径。
BASE_PX = float(FONT_SCALES["standard"]["base_px"])


def _name_spacing_config(value: float) -> dict:
    """只设姓名字距的 format_config（角色级 `name`，字段级没有这个属性）。"""
    return {"roles": {"version": 1, "name": {"letter_spacing": value}}}


def test_name_block_styles_carries_letter_spacing_from_the_name_role() -> None:
    """I-41 方案 1：`letter_spacing` 只从 `name` 角色取，性别段不受影响。"""
    name_style, gender_style = name_block_styles(
        _header(), _style_factory({"name": RoleStyle(letter_spacing=0.5)}, {})
    )

    assert name_style is not None
    assert name_style.letter_spacing == 0.5
    assert gender_style is None  # 角色级 name 不泄漏到性别段


def test_negative_letter_spacing_is_clamped_at_minus_tenth_em() -> None:
    """三端共用的下限夹取（HTML 这一份；PDF / Word 断言见下面两条）。"""
    assert clamp_letter_spacing(-0.3) == MIN_LETTER_SPACING == -0.1
    assert clamp_letter_spacing(0.4) == 0.4
    assert clamp_letter_spacing(None) is None

    css = " ".join(_declarations(RoleStyle(letter_spacing=-0.3), ratio=1.0))
    assert "letter-spacing: calc(var(--fs) * -0.1);" in css


@needs_font
def test_pdf_applies_char_spacing_to_the_name_and_resets_it(monkeypatch) -> None:
    """I-41 方案 3：姓名前后成对 `set_char_spacing`，且实参 = 基准字号 × 系数（mm）。"""
    from app.services.pdf_exporter import header as header_module

    calls: list[float] = []
    original = _ResumePDF.set_char_spacing

    def spy(self, spacing):
        calls.append(spacing)
        return original(self, spacing)

    monkeypatch.setattr(_ResumePDF, "set_char_spacing", spy)

    captured: dict = {}
    draw_original = header_module.draw_name_gender

    def draw_spy(pdf, name, plan, **kwargs):
        captured.update(kwargs)
        return draw_original(pdf, name, plan, **kwargs)

    monkeypatch.setattr(header_module, "draw_name_gender", draw_spy)

    build_resume_pdf(_document(), page_limit=2, format_config=_name_spacing_config(0.5))

    assert captured["name_letter_spacing"] == pytest.approx(BASE_PX * 0.5)
    # 画完必须归零，否则后续正文会继承姓名的字距。
    assert calls == pytest.approx([BASE_PX * 0.5 * _PX_TO_MM, 0.0])


@needs_font
def test_pdf_negative_letter_spacing_reaches_the_canvas_clamped(monkeypatch) -> None:
    """`-0.3` 在纸面上按 `-0.1em` 画（夹取发生在取值处，画布只收到合法值）。"""
    from app.services.pdf_exporter import header as header_module

    captured: dict = {}
    draw_original = header_module.draw_name_gender

    def draw_spy(pdf, name, plan, **kwargs):
        captured.update(kwargs)
        return draw_original(pdf, name, plan, **kwargs)

    monkeypatch.setattr(header_module, "draw_name_gender", draw_spy)
    build_resume_pdf(_document(), page_limit=2, format_config=_name_spacing_config(-0.3))

    assert captured["name_letter_spacing"] == pytest.approx(BASE_PX * MIN_LETTER_SPACING)


@needs_font
def test_no_letter_spacing_never_touches_char_spacing(monkeypatch) -> None:
    """回归主判据：没设字距时一次 `set_char_spacing` 都不调（旧产物零变化）。"""
    calls: list[float] = []
    original = _ResumePDF.set_char_spacing

    def spy(self, spacing):
        calls.append(spacing)
        return original(self, spacing)

    monkeypatch.setattr(_ResumePDF, "set_char_spacing", spy)
    build_resume_pdf(_document(), page_limit=2)
    assert calls == []


@needs_font
def test_plan_wraps_the_name_when_letter_spacing_widens_it() -> None:
    """验收 2 的量侧：字距把姓名撑出可用宽度时，**量出来的块高必须跟着变大**。

    宽度不写死中文单字宽（字体一换就假红）：先用 `name_text_width` 量出姓名的实际
    宽度，取 1.6 倍作可用宽度——不加字距时必然一行，加 `+1.0em`（每段约一个字宽）后
    姓名宽度翻倍、超过 1.6 倍，必然折行。
    """
    from app.services.pdf_exporter.name_gender import name_text_width

    pdf = _pdf_with_font()
    name_size = 16.0
    name = "陈可陈可陈"
    width = name_text_width(pdf, name, name_size=name_size) * 1.6

    plain = plan_name_gender(
        pdf, name, "", width=width, name_size=name_size, extra_size=name_size * 0.55
    )
    spaced = plan_name_gender(
        pdf,
        name,
        "",
        width=width,
        name_size=name_size,
        extra_size=name_size * 0.55,
        name_letter_spacing=name_size,
    )

    assert spaced.height > plain.height
    assert plain.height == pytest.approx(pdf.line_advance(name_size))  # 未加字距：一行


@needs_font
def test_plan_accounts_for_one_gap_fewer_than_the_character_count() -> None:
    """`(len - 1)` 而不是 `len`：多算一个字距会让四字姓名平白宽 1 个字距。"""
    from app.services.pdf_exporter.name_gender import name_text_width

    pdf = _pdf_with_font()
    name = "陈可陈可"
    name_size = 16.0
    spacing_px = name_size * 0.5
    pdf.set_font("resume-cjk", "B", name_size * _PX_TO_PT)
    bare = pdf.get_string_width(name)

    assert name_text_width(
        pdf, name, name_size=name_size, letter_spacing_px=spacing_px
    ) == pytest.approx(bare + spacing_px * _PX_TO_MM * (len(name) - 1))


def test_docx_name_run_gets_letter_spacing() -> None:
    """Word：姓名 run 写 `w:spacing`（twips = 磅 × 20），单位与 PDF 同源（× 基准字号）。"""
    from app.services.docx_exporter import build_resume_docx

    result = build_resume_docx(_document(), format_config=_name_spacing_config(0.5))
    run = _docx_run(_docx_name_paragraph(result.content), "陈可")
    node = run._element.rPr.find(qn("w:spacing"))

    assert node is not None
    assert int(node.get(qn("w:val"))) == round(BASE_PX * 0.5 * _PX_TO_PT * 20)


def test_docx_negative_letter_spacing_is_clamped_too() -> None:
    """Word 侧同一份夹取：`-0.3` 写成 `-0.1em`，与 HTML/PDF 一致。"""
    from app.services.docx_exporter import build_resume_docx

    result = build_resume_docx(_document(), format_config=_name_spacing_config(-0.3))
    run = _docx_run(_docx_name_paragraph(result.content), "陈可")
    node = run._element.rPr.find(qn("w:spacing"))

    assert int(node.get(qn("w:val"))) == round(BASE_PX * MIN_LETTER_SPACING * _PX_TO_PT * 20)


def test_docx_name_run_without_spacing_has_no_spacing_markup() -> None:
    """没设字距时 run 的 rPr 里不出现 `w:spacing`（旧产物零变化）。"""
    from app.services.docx_exporter import build_resume_docx

    run = _docx_run(_docx_name_paragraph(build_resume_docx(_document()).content), "陈可")
    assert run._element.rPr.find(qn("w:spacing")) is None


def test_field_level_has_no_letter_spacing_property() -> None:
    """字段级 `meta` 的白名单里没有字距——所以它只能来自 `name` 角色（方案 1 的前提）。"""
    from app.services.resume.resume_style_schema import FIELD_ROLE_PROPS, ROLE_PROPS

    assert "letter_spacing" in ROLE_PROPS["name"]
    assert "letter_spacing" not in FIELD_ROLE_PROPS["meta"]
    assert NAME_FIELD.startswith("header.")
