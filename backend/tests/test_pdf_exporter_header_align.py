# SPDX-License-Identifier: Apache-2.0
"""页头对齐 / 照片侧 / 模板默认左右页边距：PDF 与模板 CSS 的声明对齐（T03）。

**用户实测的分歧**：优雅模板在草稿里"姓名居中、照片在左"，导出的 PDF 却"姓名靠左、照片在右"。
两条链路读的是同一个模板名，所以不是"选错模板"，而是 PDF 侧**从来没有读过**模板 `.header` 的
`text-align` 与 `flex-direction` 这两条声明；页边距则卡在注册表只有一个 `padding_mm`，
而模板 CSS 允许 `padding: 16mm 18mm` 这种"上下 / 左右"两值简写。

本文件钉住三件事，**期望值一律从注册表/模板 CSS 读，不在这里抄常量**：

1. `header_align="center"` 时姓名块真的居中（在纸面中线上，不是"往右挪了一点"）；
2. `header_photo_side` 决定照片落在纸面哪一侧，且照片与文字块不重叠；
3. `padding_sides_mm` 决定零覆盖时的左右页边距，**且用户设过 `page_padding` 时四边仍以
   用户的值为准**（这是"已设过页边距的简历 PDF 不变"的回滚安全线）。

复用 `test_pdf_exporter.py` 的 helper（`needs_font` / `_text_runs` / `_pdf_with_font` /
`_MM_TO_PT`），兄弟文件单向导入是既有约定。
"""

from __future__ import annotations

import base64
from io import BytesIO

import pytest
from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import (
    _PX_TO_PT,
    _ResumePDF,
    build_resume_pdf,
    resolve_layout,
)
from app.services.pdf_exporter.layout import PAGE_WIDTH_MM
from app.services.resume.resume_layout_overrides import resolve_page_margins
from app.services.resume.resume_template_catalog import RESUME_TEMPLATES
from app.services.resume.resume_template_layout import TEMPLATE_LAYOUT_DEFAULTS
from app.services.resume.resume_templates import FONT_SCALES
from PIL import Image
from test_pdf_exporter import (
    _MM_TO_PT,
    _pdf_with_font,
    _text_runs,
    needs_font,
)

# 页宽（mm）与"标准"字号档的基准字号（px）：页头居中的判据是"姓名块中心落在 105mm 附近"，
# 字号要用**默认档位**那一档，否则量出来的姓名宽度与实际渲染的差一截。
BASE_PX = float(FONT_SCALES["standard"]["base_px"])

# 一眼就能分辨的两个模板：elegant 是**唯一**居中 + 照片在左；classic 是"左对齐 + 照片在右"
# 的代表（7 个模板同款，改动前 PDF 恒为这一档）。
CENTERED_TEMPLATE = "elegant"
LEFT_TEMPLATE = "classic"

# 允许声明"左右边距 ≠ padding_mm"的模板：模板 CSS 用了两值简写 `padding: top/bottom  left/right`。
# 其余模板若也声明了分边，PDF 版面就会在"对齐模板"的名义下被悄悄改掉——本文件最后一条用例守住它。
# scholar（2026-10 新增）同样是两值简写 `padding: 12mm 13mm`。
TWO_VALUE_PADDING_TEMPLATES = {"elegant", "compact", "scholar"}


def _png_data_url(size: tuple[int, int] = (300, 400)) -> str:
    """纯色 PNG 的 data URL（`ResumeContent.photo` 接受的形式）。"""
    buffer = BytesIO()
    Image.new("RGB", size, (0, 128, 200)).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _header_resume(*, with_photo: bool = True) -> ResumeContent:
    """只关心页头的一份简历：姓名 + 意向 + 联系方式，不需要正文来抢版面。"""
    return ResumeContent(
        name="张三",
        phone="13800000000",
        email="zhangsan@example.com",
        job_intent="后端开发工程师",
        photo=_png_data_url() if with_photo else "",
        summary="三年后端开发经验。",
    )


def _run_x_mm(content: bytes, needle: str) -> float:
    """页头里含 ``needle`` 的那个文字块起笔 x（mm，PDF 原点在左下角）。"""
    runs = [run for run in _text_runs(content) if needle in run[3]]
    assert runs, f"PDF 里没找到 {needle!r}"
    return runs[0][0] / _MM_TO_PT


def _name_width_mm(template: str, name: str = "张三") -> float:
    """姓名字形的宽度（mm）：用与渲染同一套字体/字号现量，不写死毫米数。

    走 `test_pdf_exporter._pdf_with_font()` 造一个已注册字体的画布（它自带的 classic 版式
    与"量宽度"无关——宽度只由字体 + 字号决定），避免在这里再抄一遍字体解析。
    """
    pdf = _pdf_with_font()
    ratio = float(TEMPLATE_LAYOUT_DEFAULTS[template]["name_ratio"])
    pdf.set_font("resume-cjk", "B", BASE_PX * ratio * _PX_TO_PT)
    return float(pdf.get_string_width(name))


def _record_photo_x(monkeypatch, template: str) -> tuple[float, float]:
    """抓 `pdf.image()` 的 ``(x, w)``：照片真正落到纸面上的位置与宽度。

    照片是 PDF 里唯一不是文字的图形元素，只能从绘制调用上读；`test_pdf_exporter_photo.py`
    量照片尺寸用的是同一个手法（monkeypatch `_ResumePDF.image`）。
    """
    recorded: list[tuple[float, float]] = []
    original = _ResumePDF.image

    def recording(self, name, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003 - fpdf2 的签名
        recorded.append((float(kwargs["x"]), float(kwargs["w"])))
        return original(self, name, *args, **kwargs)

    monkeypatch.setattr(_ResumePDF, "image", recording)
    build_resume_pdf(_header_resume(), template=template, page_limit=1, include_photo=True)
    assert recorded, f"{template} 的页头没有画出照片"
    return recorded[0]


# ===== 1. 页头对齐 =====


@needs_font
def test_elegant_name_is_centered_on_the_page():
    """elegant 的姓名块必须**落在纸面中线上**——这是 `.header { text-align: center }` 的定义。

    判据不看"相对左边距右移了多少"（那只能证明"动了"，不能证明"居中了"）：无照片时文字块
    就是整页正文宽度，姓名块的中心点应当≈页宽的一半。左边距 18mm + 姓名宽的一半在
    130mm 左右，与 105mm 的中线相差 25mm 以上，所以这条断言不可能被"只挪了 2mm"蒙过去。
    """
    content = build_resume_pdf(
        _header_resume(with_photo=False), template=CENTERED_TEMPLATE, page_limit=1
    ).content
    name_x = _run_x_mm(content, "张三")
    center = name_x + _name_width_mm(CENTERED_TEMPLATE) / 2
    assert center == pytest.approx(PAGE_WIDTH_MM / 2, abs=2.0), (
        f"姓名块中心在 {center:.2f}mm，纸面中线是 {PAGE_WIDTH_MM / 2}mm"
    )


@needs_font
def test_classic_name_stays_left_aligned():
    """classic（以及其余 6 个模板）的姓名仍从左页边距起笔——原行为，一个像素都不该动。

    `c_margin` 是 fpdf2 单元格的内边距（默认 1mm），所以文字 x = 页边距 + 1mm；这里断的是
    "落在左边距附近"，不是"落在中线附近"，与上一条互为对照。
    """
    content = build_resume_pdf(
        _header_resume(with_photo=False), template=LEFT_TEMPLATE, page_limit=1
    ).content
    layout = resolve_layout(template=LEFT_TEMPLATE, base_px=BASE_PX, format_config=None)
    name_x = _run_x_mm(content, "张三")
    assert name_x == pytest.approx(layout.margin_left + 1.0, abs=1.0)
    assert name_x < PAGE_WIDTH_MM * 0.3, f"左对齐的姓名跑到了 {name_x:.2f}mm"


@needs_font
def test_elegant_intent_and_contact_are_centered_too():
    """`.header { text-align: center }` 管的是**整块**文字：意向与联系方式同样居中。

    只居中姓名是最容易犯的"半个修复"：姓名在中间、下面两行贴着左边距，看起来更歪。
    """
    content = build_resume_pdf(
        _header_resume(with_photo=False), template=CENTERED_TEMPLATE, page_limit=1
    ).content
    intent_x = _run_x_mm(content, "求职意向")
    contact_x = _run_x_mm(content, "13800000000")
    # 归一化：多长的文字都不该让起笔点回到左边距那一侧。
    assert intent_x > PAGE_WIDTH_MM * 0.3, f"求职意向起笔在 {intent_x:.2f}mm"
    assert contact_x > PAGE_WIDTH_MM * 0.3, f"联系方式起笔在 {contact_x:.2f}mm"


# ===== 2. 照片在哪一侧 =====


@needs_font
def test_elegant_photo_sits_on_the_left(monkeypatch):
    """elegant 的 `.header { flex-direction: row-reverse }` ⇒ 照片在**左**（贴左页边距）。"""
    x, width = _record_photo_x(monkeypatch, CENTERED_TEMPLATE)
    layout = resolve_layout(template=CENTERED_TEMPLATE, base_px=BASE_PX, format_config=None)
    assert x == pytest.approx(layout.margin_left, abs=0.5), f"照片画在 {x:.2f}mm"
    assert x + width < PAGE_WIDTH_MM / 2, "照片应当整块落在纸面左半"


@needs_font
def test_classic_photo_sits_on_the_right(monkeypatch):
    """classic 的照片仍贴右页边距（原行为），未被 elegant 的新分支带走。"""
    x, width = _record_photo_x(monkeypatch, LEFT_TEMPLATE)
    layout = resolve_layout(template=LEFT_TEMPLATE, base_px=BASE_PX, format_config=None)
    assert x > PAGE_WIDTH_MM / 2, f"照片画在 {x:.2f}mm"
    assert x + width == pytest.approx(PAGE_WIDTH_MM - layout.margin_right, abs=0.5)


@needs_font
def test_photo_never_overlaps_the_text_block(monkeypatch):
    """照片与文字块**不重叠**：文字起笔必须越过照片的右沿（留出模板的间隙）。

    照片换到左侧时最容易出的错是"只挪了图、没挪字"——照片压在姓名上，或者姓名跑进照片
    框里。这条断言用两个真实绘制位置对账，不依赖任何公式。
    """
    x, width = _record_photo_x(monkeypatch, CENTERED_TEMPLATE)
    content = build_resume_pdf(
        _header_resume(), template=CENTERED_TEMPLATE, page_limit=1, include_photo=True
    ).content
    name_x = _run_x_mm(content, "张三")
    assert name_x > x + width, f"姓名起笔 {name_x:.2f}mm 没越过照片右沿 {x + width:.2f}mm"


# ===== 3. 模板默认的四边页边距 =====


@pytest.mark.parametrize(
    ("template", "expected_left", "expected_right"),
    [
        # 模板 CSS 是两值简写 `padding: 16mm 18mm` / `12mm 14mm`：上下取第一个数（进
        # `padding_mm`，滑杆默认值仍在读它），左右取第二个数（进 `padding_sides_mm`）。
        ("elegant", 18.0, 18.0),
        ("compact", 14.0, 14.0),
        # 单值简写 `padding: 14mm` 的模板没有分边声明，四边仍是 `padding_mm`。
        ("classic", 14.0, 14.0),
        ("minimal", 18.0, 18.0),
    ],
)
def test_template_side_paddings_apply_when_nothing_is_set(template, expected_left, expected_right):
    """零覆盖时左右页边距来自模板声明（`padding_sides_mm`），上下仍是 `padding_mm`。"""
    layout = resolve_layout(template=template, base_px=BASE_PX, format_config=None)
    assert layout.margin_left == pytest.approx(expected_left)
    assert layout.margin_right == pytest.approx(expected_right)
    assert layout.margin_top == pytest.approx(
        float(TEMPLATE_LAYOUT_DEFAULTS[template]["padding_mm"])
    )
    assert layout.margin_bottom == pytest.approx(layout.margin_top)


@pytest.mark.parametrize("template", sorted(RESUME_TEMPLATES))
def test_user_page_padding_always_wins_over_template_sides(template):
    """用户设过 `page_padding` 时四边一律等于它——这是"已设过页边距的简历 PDF 不变"的线。

    `padding_sides_mm` 只允许在**零覆盖**状态下生效：只要 `page_padding` 存在，
    左右两道模板边距就必须完全退场，否则存量简历的 PDF 会因为一次"模板对齐"而无端改版。
    """
    layout = resolve_layout(template=template, base_px=BASE_PX, format_config={"page_padding": 9})
    assert (layout.margin_top, layout.margin_right, layout.margin_bottom, layout.margin_left) == (
        9.0,
        9.0,
        9.0,
        9.0,
    )


@pytest.mark.parametrize("template", sorted(RESUME_TEMPLATES))
def test_legacy_margin_mm_also_disables_template_sides(template):
    """只给 `margin_mm`（旧客户端的形状）时同样四边相等：兼容分支不被新键插队。"""
    layout = resolve_layout(template=template, base_px=BASE_PX, format_config=None, margin_mm=20)
    assert (layout.margin_top, layout.margin_right, layout.margin_bottom, layout.margin_left) == (
        20.0,
        20.0,
        20.0,
        20.0,
    )


def test_resolve_page_margins_ignores_template_sides_on_partial_branches():
    """只有一条分边支路、没有"总"时整组作废（既有规则），此时也**不**回落到模板分边。"""
    assert resolve_page_margins({"page_padding_left": 9}, 14.0, None, (18.0, 18.0)) == (
        14.0,
        14.0,
        14.0,
        14.0,
    )


def test_resolve_page_margins_tolerates_a_malformed_template_sides_value():
    """畸形/缺失的 `padding_sides_mm` 按"这个模板没有分边声明"处理，四边相等。"""
    for malformed in (None, (), (18.0,), ("a", "b"), "18mm"):
        assert resolve_page_margins(None, 16.0, None, malformed) == (16.0, 16.0, 16.0, 16.0)


# ===== 4. 三个新键的缺省值（非 elegant 走原分支的机械保证）=====


@pytest.mark.parametrize("template", sorted(RESUME_TEMPLATES))
def test_new_registry_keys_default_to_the_previous_behaviour(template):
    """除 elegant 外，每个模板的三个新键都必须等于**改动前的行为**。

    `header_align="left"` / `header_photo_side="right"` / `padding_sides_mm` 缺键或等于
    `padding_mm`——三条同时成立，非 elegant 模板才可能逐字节不变（对拍见交付说明）。
    """
    defaults = TEMPLATE_LAYOUT_DEFAULTS[template]
    if template == CENTERED_TEMPLATE:
        assert defaults["header_align"] == "center"
        assert defaults["header_photo_side"] == "left"
        assert defaults["padding_sides_mm"] == (18.0, 18.0)
        return
    assert defaults["header_align"] == "left", template
    assert defaults["header_photo_side"] == "right", template
    sides = defaults.get("padding_sides_mm")
    if template not in TWO_VALUE_PADDING_TEMPLATES:
        padding_mm = float(defaults["padding_mm"])
        assert sides is None or sides == (padding_mm, padding_mm), (
            f"{template} 声明了与 padding_mm 不同的左右边距，PDF 版面会跟着变：{sides}"
        )
    else:
        # 两值简写模板（compact）的左右边距必须与 `padding_mm` **不同**，否则等于白声明；
        # 具体数值由 `test_resume_layout_templates.py` 拿模板 CSS 核对。
        assert sides is not None and sides[0] == sides[1], template
        assert sides[0] > float(defaults["padding_mm"]), template
