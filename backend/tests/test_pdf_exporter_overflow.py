# SPDX-License-Identifier: Apache-2.0
"""PDF 绘制行为与一页适配：技能标签绘制、overflow/一页适配不变量、强调色覆盖。

拆分自 test_pdf_exporter.py——「框丢了」回归防线（spy rect）、overflow 如实标记、
"标志不许说谎"端到端守卫、format_config.accent 覆盖（patch@_ResumePDF.__init__ 随行）。
复用主文件的 helper（needs_font / _body_lines / _summary_only_resume / _filler /
_hex_to_rgb）。
"""

import io

import pytest
from app.services.pdf_exporter import (
    _ResumePDF,
    build_resume_pdf,
    measure_content_height,
    rendered_page_count,
    resolve_layout,
)
from app.services.pdf_exporter.truncate import truncate_pdf
from app.services.resume.resume_sample import sample_resume_content
from app.services.resume.resume_templates import TEMPLATE_LAYOUT_DEFAULTS
from pypdf import PdfReader
from test_pdf_exporter import (
    _MINIMAL_ACCENT,
    _body_lines,
    _filler,
    _hex_to_rgb,
    _one_page_boundary_resume,
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
def test_overflowing_content_is_not_shrunk_to_fit_one_page():
    """内容超出所选页数时**不许缩字号**（2026-10-21 用户要求），只截断 + 标记。

    这是本次语义变更的核心红线：以前的实现会把字号乘一个 0.5~1.0 的系数硬塞进一页，
    于是滑杆上的 18px 在纸面上可能是 9px。现在按用户设定的字号原样排——正文文字块的
    字号必须仍然是基准字号（14px → 10.5pt），而不是某个更小的值。
    """
    resume = _summary_only_resume(_filler(3000))  # 一页装不下

    result = build_resume_pdf(resume, template="classic", page_limit=1, font_scale="standard")

    assert result.pages == 1
    assert result.overflow is True
    assert result.pages_needed is not None and result.pages_needed > 1
    # 关键：正文仍按 14px 绘制（有足够多的行），没有被压小。
    assert len(_body_lines(result.content, base_px=14.0)) > 20


@needs_font
def test_content_that_cannot_fit_is_flagged_and_truncated():
    """装不下：如实标记 overflow，并**在第 N 页截断**。

    2026-10-21 语义变更（用户要求）：此前是"缩字号硬塞 + 缩到下限仍放不下就标记"，
    现在与草稿画布同一口径——只排用户设定的页数，多出来的不显示，想看就自己把篇幅调大。
    ``overflow`` 仍然为真，``pages_needed`` 说明真实需要几页，界面据此提示"约需 N 页"。

    行数门槛从 >40 调到 >30（2026-10-21）：截断改为"渲染后裁页"之后，末页不再把余下内容
    继续画进下边距——旧实现那一版在页底多出几行"渗出去"的文字（`max_pages` 到上限后
    只是不再换页，笔并没有停）。现在是干净的一页（实测 37 行正文）。
    """
    resume = _summary_only_resume(_filler(12_000))

    result = build_resume_pdf(resume, template="classic", page_limit=1, font_scale="standard")

    assert result.overflow is True
    assert result.pages_needed is not None and result.pages_needed >= 3
    # 关键：**不再顺延出第 2 页**。
    assert result.pages == 1
    # 仍然有内容（裁掉的是尾部，不是整份）：一页该有的行数还在，且字号没被压小。
    assert len(_body_lines(result.content, base_px=14.0)) > 30


@needs_font
def test_pdf_never_exceeds_the_requested_page_limit():
    """任何内容、任何上限，产出的页数都不超过上限（截断是全局不变量，不是边界特例）。"""
    for limit in (1, 2, 3):
        result = build_resume_pdf(
            sample_resume_content(), template="classic", page_limit=limit, font_scale="standard"
        )
        assert result.pages <= limit, f"上限 {limit} 页，却排出了 {result.pages} 页"


@needs_font
def test_one_page_fit_flag_never_lies_about_the_page_count():
    """**"装不下却不说"的端到端不变量**：请求 1 页时，绝不能既不标 overflow 又偷偷多排一页。

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
    """**端到端"标志不许说谎"守卫**：一页适配只看真实渲染出的页数，不看连续高。

    两个样本正好跨在一页边界两侧（见 `_one_page_boundary_resume` 的实测数字）：装得下的
    那个必须 ``overflow=False``，装不下的那个必须 ``overflow=True``。任何一侧说谎都会红，
    所以这条用例两个方向都钉住了——"明明超了却说没超"和"明明没超却报溢出"都算失败。

    **2026-10-21（B3）语义变更**：此前这条用例守的是"连续高 ≤ 可用高、真实却 2 页"的盲区，
    而那个盲区是 `bullets()` 对单行奖项**固定预留两行**多留出来的假象。B3 把列表项的预留
    改成整条实测高度后，每一处预留都等于它守护内容的真实高度，"提前换页"只可能在真的放不下
    时发生——盲区随之消失。于是这里改为**跨边界的正反两个样本**：它同样是"标志不许说谎"的
    守卫，但不再依赖一个已被修掉的伪造场景。
    """
    layout = resolve_layout(template="minimal", base_px=14.0, format_config=None)
    usable = layout.usable_height_per_page

    # (填充字数, 是否应当溢出)。数字取自实测：W08 让"摘要+标题"整段不跨页后，真实分页
    # 边界提前到 1400 附近（连续高边界仍在 1430+），取 1350 / 1440 让两组样本同时满足
    # "真实分页"与"连续高"两个对照条件（否则本用例的自检会先红）。
    cases = ((1350, False), (1440, True))
    for filler_chars, expect_overflow in cases:
        resume = _one_page_boundary_resume(filler_chars)
        continuous = measure_content_height(resume, accent=_MINIMAL_ACCENT, layout=layout)
        real_pages = rendered_page_count(resume, accent=_MINIMAL_ACCENT, layout=layout)
        result = build_resume_pdf(resume, template="minimal", page_limit=1, font_scale="standard")

        where = (
            f"filler={filler_chars}：连续高 {continuous:.2f}mm / 可用 {usable:.2f}mm、"
            f"真实分页 {real_pages} 页、产出 {result.pages} 页、overflow={result.overflow}"
        )
        # 全局不变量：任何情况下都不得超过页数上限。
        assert result.pages <= 1, where
        # 自检：这一组样本确实跨在边界两侧，否则下面的期望值就是在测空气。
        assert (real_pages >= 2) is expect_overflow, f"边界漂移，请重新取参 —— {where}"
        assert (continuous <= usable) is not expect_overflow, f"边界漂移，请重新取参 —— {where}"
        # 核心断言：overflow 标志必须与真实分页一致，不能凭连续高判断。
        assert result.overflow is expect_overflow, f"标志说谎 —— {where}"


@needs_font
def test_overflowing_draft_is_truncated_in_a_single_render_pass(monkeypatch):
    """溢出时**只排一趟**：第二趟（"带页数上限再画一遍"）已被 pypdf 裁剪取代。

    这条守的是性能本身：一次单趟渲染本机实测 ~450ms（字体解析 ~310ms 占大头），
    旧实现为了截断会把这整套再走一遍（实测 ~830ms）。谁把"再排一遍"加回来，这里立刻红。
    """
    from app.services.pdf_exporter import fit as fit_module

    calls: list[int] = []
    original = fit_module.render_resume_pdf

    def counting(*args, **kwargs):  # noqa: ANN002, ANN003 - 只数次数，不关心签名
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(fit_module, "render_resume_pdf", counting)

    result = build_resume_pdf(
        _summary_only_resume(_filler(12_000)), template="classic", page_limit=1
    )

    assert result.overflow is True
    assert len(calls) == 1, f"溢出场景渲染了 {len(calls)} 趟，应当只有 1 趟"


@needs_font
def test_truncate_pdf_keeps_the_leading_pages_byte_for_byte():
    """裁剪保留的是**同一份排版的前 N 页**，不是"重排出来的相似结果"。

    只比页数是不够的：重排一遍也能得到 N 页，但那是另一次排版。这里逐页比文字内容，
    确认裁出来的就是原来那几页。
    """
    resume = _summary_only_resume(_filler(12_000))
    # 不限页数 → 自然排出全部（3 页以上）。
    natural = build_resume_pdf(resume, template="classic", page_limit=9)
    assert natural.pages >= 3

    cropped = truncate_pdf(natural.content, 2)

    kept = PdfReader(io.BytesIO(cropped))
    original = PdfReader(io.BytesIO(natural.content))
    assert len(kept.pages) == 2
    for index in range(2):
        assert kept.pages[index].extract_text() == original.pages[index].extract_text()


def test_truncate_pdf_returns_the_input_when_nothing_is_cut():
    """没超上限就原样返回：不重写字节，避免给"本来就好"的文件平白换一份编码。"""
    from app.services.pdf_exporter.truncate import truncate_pdf as truncate

    natural = build_resume_pdf(sample_resume_content(), template="classic", page_limit=9)
    assert truncate(natural.content, natural.pages) is natural.content


@needs_font
def test_format_config_accent_overrides_the_template_default(monkeypatch):
    """`format_config.accent` 必须仍能覆盖模板默认强调色——颜色收敛到注册表后不能把它吞掉。

    用 spy 抓住 `build_resume_pdf` 真正交给画布的 accent：设了覆盖就必须是覆盖值，没设就必须
    是模板默认值（默认值从注册表读，而注册表又被 `test_resume_layout.py` 拿模板 CSS 核对过，
    所以这里的期望不是"跟自己比"）。
    """
    captured: list[tuple[int, int, int]] = []
    original_init = _ResumePDF.__init__

    # `**kwargs` 而不是逐个列出 `line` / `measuring`：画布的构造参数还会随模板能力增长
    # （B2 加了 `body_text` / `muted_text` / `accent_soft`），这条用例只关心 accent，
    # 多一个参数就红一次纯属噪音。
    def spy_init(self, accent, layout, **kwargs):  # noqa: ANN001, ANN003
        captured.append(accent)
        original_init(self, accent, layout, **kwargs)

    monkeypatch.setattr(_ResumePDF, "__init__", spy_init)

    build_resume_pdf(
        sample_resume_content(),
        template="classic",
        page_limit=1,
        format_config={"accent": "#ff0000"},
    )
    assert captured, "没有构造任何 PDF 画布"
    assert all(item == (255, 0, 0) for item in captured)

    captured.clear()
    build_resume_pdf(sample_resume_content(), template="modern", page_limit=1, format_config={})
    expected_default = _hex_to_rgb(str(TEMPLATE_LAYOUT_DEFAULTS["modern"]["accent"]))
    assert all(item == expected_default for item in captured)
