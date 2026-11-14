# SPDX-License-Identifier: Apache-2.0
"""照片边框与位置（R-07 / R-10）。

三个出口各钉一条**可计算**的判据：

1. HTML：只有用户动过这五项之一才写 `.profile-photo` 规则，且默认值就是模板现值；
2. PDF：照片框按 1px 边框画出来（用像素法数边框上的强调色），偏移会真的移动框；
3. Word：`pic:spPr` 里出现 `a:ln`，几何变成 `roundRect`。
"""

from __future__ import annotations

import io
import zipfile

from app.schemas.resume import ResumeContent
from app.services.docx_exporter import build_resume_docx
from app.services.pdf_exporter.fit import build_resume_pdf
from app.services.pdf_exporter.layout import resolve_layout
from app.services.resume.resume_template_format import format_css
from resume_render_fixtures import _png

RED = "#ff0000"


def _content() -> ResumeContent:
    return ResumeContent(
        name="张三",
        job_intent="AI产品经理（Agent方向）",
        summary="负责 Agent 产品规划与体验优化。",
        photo=_png(40, 50),
    )


def test_format_css_writes_nothing_when_untouched():
    """没调过就不写规则：旧简历的 HTML 一个字节都不变。"""
    assert format_css({}) == ""
    assert ".profile-photo" not in format_css({"accent": "#123456"})


def test_format_css_uses_template_defaults_and_offsets():
    css = format_css(
        {
            "photo_border_width": 3,
            "photo_radius": 10,
            "photo_offset_x": 2.5,
            "photo_offset_y": -1,
        }
    )
    assert ".profile-photo { border: 3px solid var(--line); border-radius: 10px;" in css
    assert "transform: translate(2.5mm, -1mm)" in css
    # 0 = 明确不要边框（不是"跟随默认"）。
    assert "border: 0" in format_css({"photo_border_width": 0})
    # 设了颜色就不再回落到 var(--line)。
    assert "border: 2px solid #aabbcc" in format_css(
        {"photo_border_width": 2, "photo_border_color": "#aabbcc"}
    )


def test_layout_defaults_match_template_pixels():
    layout = resolve_layout(template="classic", base_px=16, format_config=None, margin_mm=None)
    assert layout.photo_border_width == 1
    assert layout.photo_border_color == ""
    assert layout.photo_radius == 4
    assert (layout.photo_offset_x, layout.photo_offset_y) == (0, 0)

    custom = resolve_layout(
        template="classic",
        base_px=16,
        format_config={"photo_border_width": 5, "photo_offset_x": 3},
        margin_mm=None,
    )
    assert custom.photo_border_width == 5
    assert custom.photo_offset_x == 3


def _render_pdf(**config) -> bytes:
    pdf = build_resume_pdf(_content(), template="classic", format_config=config)
    return pdf.content


def _page_pixels(data: bytes):
    import pypdfium2 as pdfium

    page = pdfium.PdfDocument(data)[0]
    bitmap = page.render(scale=2)
    return bitmap.to_pil().convert("RGB")


def _red_pixels(image) -> int:
    return sum(
        1
        for pixel in image.getdata()
        if pixel[0] > 200 and pixel[1] < 80 and pixel[2] < 80  # noqa: PLR2004 - 纯红判据
    )


def test_pdf_draws_a_colored_photo_border():
    plain = _red_pixels(_page_pixels(_render_pdf()))
    bordered = _red_pixels(_page_pixels(_render_pdf(photo_border_width=6, photo_border_color=RED)))
    assert bordered > plain + 300, f"边框没有画出来（红像素 {plain} → {bordered}）"


def test_pdf_photo_offset_moves_the_frame():
    """同一份内容，只加横向偏移：整块照片（含边框）应整体左移约 8mm。

    照片默认贴右缘，**向右**再推会被"不出版心"夹回去（这是刻意的：偏移不能把照片推到
    纸外），所以这里验的是向左 8mm。
    """
    from PIL import ImageChops

    base = _page_pixels(_render_pdf(photo_border_width=4, photo_border_color=RED))
    shifted = _page_pixels(
        _render_pdf(photo_border_width=4, photo_border_color=RED, photo_offset_x=-8)
    )

    def left_edge(image):
        width, height = image.size
        for x in range(width):
            for y in range(height):
                pixel = image.getpixel((x, y))
                if pixel[0] > 200 and pixel[1] < 80 and pixel[2] < 80:  # noqa: PLR2004
                    return x
        return None

    before, after = left_edge(base), left_edge(shifted)
    assert before is not None and after is not None
    # scale=2 时 A4 宽 210mm ≈ 1191px → 5.67px/mm，8mm ≈ 45px（允许 ±6px 取整误差）。
    assert 39 <= before - after <= 51, f"偏移没有生效：{before} → {after}"
    assert ImageChops.difference(base, shifted).getbbox() is not None


def test_docx_photo_gets_a_border_and_round_corners():
    data = build_resume_docx(
        _content(), template="classic", format_config={"photo_border_color": RED}
    ).content
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    assert "<a:ln" in xml
    assert "FF0000" in xml.upper()
    assert 'prst="roundRect"' in xml


def test_docx_default_also_draws_the_template_border():
    """产品口径：默认与模板对齐，所以不设参数时 Word 也要有 1px 边框。"""
    data = build_resume_docx(_content(), template="classic", format_config=None).content
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    assert "<a:ln" in xml
    assert 'w="9525"' in xml  # 1px = 9525 EMU
