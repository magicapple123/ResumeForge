"""PDF 绘制行为与一页适配：技能标签绘制、overflow/一页适配不变量、强调色覆盖。

拆分自 test_pdf_exporter.py——「框丢了」回归防线（spy rect）、overflow 如实标记、
"标志不许说谎"端到端守卫、format_config.accent 覆盖（patch@_ResumePDF.__init__ 随行）。
复用主文件的 helper（needs_font / _body_lines / _summary_only_resume / _filler /
_hex_to_rgb）。
"""
import pytest

from app.services.pdf_exporter import (
    MIN_FIT_SCALE,
    _ResumePDF,
    build_resume_pdf,
    measure_content_height,
    rendered_page_count,
    resolve_layout,
)
from app.services.resume.resume_sample import sample_resume_content
from app.services.resume.resume_templates import TEMPLATE_LAYOUT_DEFAULTS

from test_pdf_exporter import (
    _MINIMAL_ACCENT,
    _blind_spot_resume,
    _body_lines,
    _filler,
    _hex_to_rgb,
    _pdf_with_font,
    _summary_only_resume,
    needs_font,
)


# ===== 绘制行为 =====


@needs_font
def test_every_skill_gets_a_filled_rounded_box():
    """**"框丢了"的回归防线**：每个技能都要真的画出一个带底色的圆角框。

    只断言"没报错"是不够的——以前那版就是"没报错"地把标签画成了一行纯文本。
    """
    pdf = _pdf_with_font()
    drawn: list[tuple[tuple, dict]] = []
    original = pdf.rect

    def spy(*args, **kwargs):
        drawn.append((args, kwargs))
        return original(*args, **kwargs)

    pdf.rect = spy  # type: ignore[method-assign]
    pdf.skill_tags(["Python", "Rust（熟练）", "Go"], 14.0)

    assert len(drawn) == 3
    for args, kwargs in drawn:
        width, height = args[2], args[3]
        assert width > 0 and height > 0
        # 填色 + 圆角，才叫"小框"；只描边或不加圆角都不是预览里的样子。
        assert kwargs.get("style") == "F"
        assert kwargs.get("round_corners") is True
        assert kwargs.get("corner_radius", 0) > 0


@needs_font
def test_skill_tags_restores_the_body_text_colour():
    """画完标签必须把文字颜色还原，否则后面的正文会一起变成强调色。"""
    pdf = _pdf_with_font()

    pdf.skill_tags(["Python"], 14.0)

    # fpdf2 把颜色存成 0~1 的 DeviceRGB，不是 0~255 的元组。
    colour = pdf.text_color
    assert (colour.r, colour.g, colour.b) == pytest.approx((31 / 255, 41 / 255, 55 / 255))


@needs_font
def test_skill_tags_with_no_labels_draws_nothing():
    pdf = _pdf_with_font()
    drawn: list[tuple] = []
    pdf.rect = lambda *args, **kwargs: drawn.append(args)  # type: ignore[method-assign]

    pdf.skill_tags(["", "   "], 14.0)

    assert drawn == []
@needs_font
def test_overflowing_content_is_scaled_down_to_fit_one_page():
    """内容超出所选页数时，按预览的 `--fit-scale` 口径缩字号装进一页。"""
    resume = _summary_only_resume(_filler(3000))  # 一页装不下，但缩一档就能塞进去

    result = build_resume_pdf(resume, template="classic", page_limit=1, font_scale="standard")

    assert result.pages == 1
    assert MIN_FIT_SCALE < result.scale < 1.0
    assert result.overflow is False


@needs_font
def test_content_that_cannot_fit_is_flagged_but_not_truncated():
    """缩到下限仍放不下：如实标记 overflow，且**一个字的正文都不能丢**。"""
    resume = _summary_only_resume(_filler(12_000))

    result = build_resume_pdf(resume, template="classic", page_limit=1, font_scale="standard")

    assert result.scale == MIN_FIT_SCALE
    assert result.overflow is True
    # 内容没有被裁掉：读回来的正文行数应明显多于一页能容纳的量。
    assert len(_body_lines(result.content, base_px=14.0 * MIN_FIT_SCALE)) > 40


@needs_font
def test_one_page_fit_flag_never_lies_about_the_page_count():
    """**"一页适配说谎"的端到端不变量**：请求 1 页时，绝不能既不缩、又不标 overflow 地排出 2 页。

    这是 QA 报告的原始复现场景（minimal + 示例内容 + page_limit=1）。说明：在字号层级比例
    结构化的修复之后，示例内容在 minimal 下已能**直接装进一页**（连续高 253mm < 可用 261mm），
    所以本场景现在只作为端到端不变量守卫存在——真正处在"连续高盲区"里的尖牙回归由下面
    `test_one_page_fit_trusts_the_real_page_count_not_the_continuous_height` 承担。
    """
    result = build_resume_pdf(
        sample_resume_content(), template="minimal", page_limit=1, font_scale="standard"
    )

    assert result.pages <= 1 or result.overflow is True, (
        f"请求 1 页却排出 {result.pages} 页且 overflow={result.overflow}（标志说谎）"
    )


@needs_font
def test_one_page_fit_trusts_the_real_page_count_not_the_continuous_height():
    """**端到端"标志不许说谎"守卫**：连续高说装得下、真实分页却两页时，必须缩进一页或标 overflow。

    用 `_blind_spot_resume()` 复现"连续高 ≠ 实际分页高"的边界：只按连续高判定的旧实现会返回
    ``(scale=1.0, overflow=False)``，而真实分页是 2 页——正是那条会撒谎的路径。

    先自检"场景确实还在盲区里"（几何或字体漂移导致它不再复现时，这里直接变红提醒重新取参），
    再断言 `pages <= 1 或 overflow`。

    注意这条守的是**标志诚实性**：末断言 `pages<=1 or overflow` 单靠 `build_resume_pdf` 末端的
    硬闸（`pages>limit ⇒ overflow`）就能成立，所以它**证明不了"该按真实页数缩多少"**。那部分决策
    逻辑由纯函数用例 `test_fit_scale_shrinks_until_the_real_page_count_fits_not_just_the_height`
    直接钉住。
    """
    resume = _blind_spot_resume()
    layout = resolve_layout(template="minimal", base_px=14.0, format_config=None)
    usable = layout.usable_height_per_page

    continuous = measure_content_height(resume, accent=_MINIMAL_ACCENT, layout=layout)
    real_pages = rendered_page_count(resume, accent=_MINIMAL_ACCENT, layout=layout)

    # 场景自检：必须"连续高 ≤ 可用高、真实却 ≥ 2 页"，否则这条测试不再复现盲区。
    assert continuous <= usable, (
        f"复现场景漂移：连续高 {continuous:.2f}mm 已超过可用高 {usable:.2f}mm，不再是盲区"
    )
    assert real_pages >= 2, f"复现场景漂移：真实分页只有 {real_pages} 页，请重新取参"

    result = build_resume_pdf(resume, template="minimal", page_limit=1, font_scale="standard")

    assert result.pages <= 1 or result.overflow is True, (
        f"连续高 {continuous:.2f}mm ≤ 可用 {usable:.2f}mm，却产出 {result.pages} 页"
        f"且 overflow={result.overflow}（标志说谎）"
    )
@needs_font
def test_format_config_accent_overrides_the_template_default(monkeypatch):
    """`format_config.accent` 必须仍能覆盖模板默认强调色——颜色收敛到注册表后不能把它吞掉。

    用 spy 抓住 `build_resume_pdf` 真正交给画布的 accent：设了覆盖就必须是覆盖值，没设就必须
    是模板默认值（默认值从注册表读，而注册表又被 `test_resume_layout.py` 拿模板 CSS 核对过，
    所以这里的期望不是"跟自己比"）。
    """
    captured: list[tuple[int, int, int]] = []
    original_init = _ResumePDF.__init__

    def spy_init(self, accent, layout, *, line=(217, 222, 231), measuring=False):  # noqa: ANN001
        captured.append(accent)
        original_init(self, accent, layout, line=line, measuring=measuring)

    monkeypatch.setattr(_ResumePDF, "__init__", spy_init)

    build_resume_pdf(
        sample_resume_content(), template="classic", page_limit=1, format_config={"accent": "#ff0000"}
    )
    assert captured, "没有构造任何 PDF 画布"
    assert all(item == (255, 0, 0) for item in captured)

    captured.clear()
    build_resume_pdf(sample_resume_content(), template="modern", page_limit=1, format_config={})
    expected_default = _hex_to_rgb(str(TEMPLATE_LAYOUT_DEFAULTS["modern"]["accent"]))
    assert all(item == expected_default for item in captured)
