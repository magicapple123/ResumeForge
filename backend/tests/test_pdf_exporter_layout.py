# SPDX-License-Identifier: Apache-2.0
"""PDF 版式合成与真实 PDF 几何：resolve_layout / 行距 / 页边距。

拆分自 test_pdf_exporter.py——纯逻辑的版式合成用例，与"真实 PDF 几何"里量行距、
行高覆盖、页边距起点（x origin）的 pypdf 用例收在这里。
复用主文件的 helper（needs_font / _text_runs / _body_lines / _summary_only_resume /
_filler / _MM_TO_PT）。
"""
import pytest
from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import (
    _PX_TO_MM,
    _PX_TO_PT,
    PAGE_WIDTH_MM,
    _ResumePDF,
    build_resume_pdf,
    measure_content_height,
    resolve_layout,
)
from app.services.resume.resume_templates import (
    RESUME_TEMPLATES,
    TEMPLATE_LAYOUT_DEFAULTS,
)
from test_pdf_exporter import (
    _MM_TO_PT,
    _body_lines,
    _filler,
    _summary_only_resume,
    _text_runs,
    needs_font,
)

# ===== 版式合成（纯逻辑，不依赖字体） =====


@pytest.mark.parametrize("name", sorted(RESUME_TEMPLATES))
def test_resolve_layout_uses_template_defaults(name):
    """没设过任何覆盖时，PDF 的版式必须等于模板自己的默认值。

    期望值从 `TEMPLATE_LAYOUT_DEFAULTS` 读——它又被 `test_resume_layout.py` 拿模板 CSS
    逐条核对过。于是"PDF 默认行距 == 模板 CSS 行距"是**传递成立**的，而不是在测试里
    再抄一份常量（抄一份就等于又写了一遍"跟自己比"）。
    """
    defaults = TEMPLATE_LAYOUT_DEFAULTS[name]

    layout = resolve_layout(template=name, base_px=14.0, format_config={})

    assert layout.margin_mm == defaults["padding_mm"]
    assert layout.line_height == defaults["line_height"]
    assert layout.section_gap == defaults["section_gap"]


def test_resolve_layout_applies_user_overrides():
    layout = resolve_layout(
        template="minimal",
        base_px=14.0,
        format_config={"line_height": 1.3, "page_padding": 9, "section_gap": 0.7},
    )

    assert layout.margin_mm == 9.0
    assert layout.line_height == 1.3
    assert layout.section_gap == 0.7


def test_resolve_layout_ignores_values_out_of_range():
    """越界的覆盖会被 `validated_format_config` 丢掉，于是退回模板默认值。"""
    defaults = TEMPLATE_LAYOUT_DEFAULTS["classic"]

    layout = resolve_layout(template="classic", base_px=14.0, format_config={"line_height": 9.9})

    assert layout.line_height == defaults["line_height"]


def test_fit_scale_is_gone_from_the_layout():
    """版式里**没有"缩放"这个自由度**（2026-10-21 用户要求）。

    以前 `ResumeLayout.fit_scale` 是"一页适配"的载体，把 18px 悄悄压成 9px 就是它。
    现在装不下只截断并提示，绝不动字号——所以这个字段不许回来。
    """
    layout = resolve_layout(template="classic", base_px=14.0, format_config=None)

    assert not hasattr(layout, "fit_scale")
    assert not hasattr(layout, "scaled_base_px")
    assert not hasattr(layout, "with_fit_scale")


@needs_font
def test_measure_content_height_follows_the_requested_font_size():
    """内容高度由**用户设定的字号**决定，且只作用在字号派生尺寸上。

    这条守住"参数与呈现一致"的物理前提：字号变大，内容必须真的变高（否则版式参数就是
    摆设）；页边距（mm）不随字号变化。
    """
    resume = _summary_only_resume(_filler(1200))
    small = resolve_layout(template="classic", base_px=12.0, format_config=None)
    large = resolve_layout(template="classic", base_px=18.0, format_config=None)

    small_height = measure_content_height(resume, accent=(15, 118, 110), layout=small)
    large_height = measure_content_height(resume, accent=(15, 118, 110), layout=large)

    assert 0 < small_height < large_height
    # mm 页边距不参与字号派生：同一模板、同一覆盖下两者相等。
    assert small.margin_mm == large.margin_mm


# ===== 真实 PDF 几何（直出 PDF 与预览对齐的回归防线） =====


@needs_font
@pytest.mark.parametrize("name", sorted(RESUME_TEMPLATES))
def test_pdf_body_rhythm_matches_the_template_line_height(name):
    """**核心回归防线**：给定模板与字号，PDF 的正文行距应等于"模板行高"那一条系数。

    期望值 `line_height` 从注册表读（它本身又被模板 CSS 核对），所以"PDF 行距 == 预览行距"
    是传递成立的。旧版 PDF 把正文行距写死成 1.65，于是 classic(1.7)/elegant(1.76) 都偏紧——
    正是用户看到的"比预览被压扁"。这条测试会立刻抓住"行高又被硬编码"的回归。
    """
    expected = TEMPLATE_LAYOUT_DEFAULTS[name]["line_height"]
    base_px = 14.0
    # page_limit 给 2，内容一定放得下 → fit_scale 保持 1，几何是确定值。
    result = build_resume_pdf(
        _summary_only_resume(_filler(600)),
        template=name,
        page_limit=2,
        font_scale="standard",
        format_config={},
    )

    lines = _body_lines(result.content, base_px=base_px)
    assert len(lines) >= 2, "正文至少要折出两行，否则量不出行距"

    gap_pt = lines[0][1] - lines[1][1]  # 相邻两行的基线之差
    font_pt = lines[0][2]
    assert gap_pt / font_pt == pytest.approx(expected, rel=1e-3)


@needs_font
def test_line_height_override_really_changes_the_pdf_geometry():
    """`format_config.line_height` 必须**真的**落进 PDF：行距随覆盖值变化。

    这是"直出 PDF 完全忽略 format_config"这个 bug 的回归防线——旧实现下两份 PDF 的文字
    基线逐字节相同，这条会直接失败。
    """
    resume = _summary_only_resume(_filler(600))
    base_px = 14.0

    tight = build_resume_pdf(
        resume, template="classic", page_limit=2, font_scale="standard",
        format_config={"line_height": 1.2},
    )
    loose = build_resume_pdf(
        resume, template="classic", page_limit=2, font_scale="standard",
        format_config={"line_height": 2.2},
    )

    tight_gap = (
        _body_lines(tight.content, base_px=base_px)[0][1]
        - _body_lines(tight.content, base_px=base_px)[1][1]
    )
    loose_gap = (
        _body_lines(loose.content, base_px=base_px)[0][1]
        - _body_lines(loose.content, base_px=base_px)[1][1]
    )

    assert tight_gap == pytest.approx(base_px * _PX_TO_PT * 1.2, rel=1e-3)
    assert loose_gap == pytest.approx(base_px * _PX_TO_PT * 2.2, rel=1e-3)
    assert loose_gap > tight_gap


@needs_font
def test_page_padding_override_moves_the_text_origin():
    """`format_config.page_padding` 必须改变正文的 x 起点（页边距随之变化）。"""
    resume = _summary_only_resume(_filler(300))

    narrow = build_resume_pdf(
        resume, template="classic", page_limit=2, font_scale="standard",
        format_config={"page_padding": 8},
    )
    wide = build_resume_pdf(
        resume, template="classic", page_limit=2, font_scale="standard",
        format_config={"page_padding": 18},
    )

    narrow_x = min(run[0] for run in _text_runs(narrow.content))
    wide_x = min(run[0] for run in _text_runs(wide.content))

    assert wide_x > narrow_x
    # 差值恰为 10mm（两种页边距之差）换算成磅；单元格内边距两边相同，自动抵消。
    assert (wide_x - narrow_x) == pytest.approx(10 * _MM_TO_PT, abs=0.5)


@needs_font
def test_template_page_padding_default_is_used_when_not_overridden():
    """没设覆盖时，x 起点由**模板自己的页边距**决定，而不是某个统一常数。"""
    resume = _summary_only_resume(_filler(300))

    compact_x = min(
        run[0]
        for run in _text_runs(
            build_resume_pdf(resume, template="compact", page_limit=2, font_scale="standard").content
        )
    )
    minimal_x = min(
        run[0]
        for run in _text_runs(
            build_resume_pdf(resume, template="minimal", page_limit=2, font_scale="standard").content
        )
    )

    assert minimal_x > compact_x  # minimal 18mm > compact 12mm
    assert (minimal_x - compact_x) == pytest.approx(
        (TEMPLATE_LAYOUT_DEFAULTS["minimal"]["padding_mm"] - TEMPLATE_LAYOUT_DEFAULTS["compact"]["padding_mm"])
        * _MM_TO_PT,
        abs=0.5,
    )


@needs_font
def test_modern_header_backdrop_covers_the_whole_header_text(monkeypatch):
    """modern / split 页头那块浅底色块的**高度**必须把段前留白也算进去（B1 的守卫）。

    `render.py` 里 `header_content_h` 是把三段文字高度**加上** `.header .intent` /
    `.header .contact` 的 `margin-top` 累加出来的：

        text_height += layout.gap_mm(layout.intent_gap)
        text_height += layout.gap_mm(layout.contact_gap)

    这两行删掉之后，**文字位置、页数、提取文本全都不变**（底色块只是变矮，盖不住页头下半
    部分），所以此前没有任何一条测试会红——这正是 QA 指出的覆盖缺口。这里直接抓
    `_ResumePDF.rect` 的调用，量出色块的真实高度，与"名字行 + 段前留白 + 意向行 + 段前留白
    + 联系方式行 + 上下内边距"逐项比对。

    期望值全部从 `resolve_layout` 取，不写第二份常量。受控简历里姓名 / 意向 / 联系方式
    **各占一行**，所以每段的高度就是该字号的一个行推进量——三段都折行的话（真实简历常见）
    期望式就得跟着 `multi_cell` 的折行数走，测起来反而更脆。
    """
    rects: list[tuple[float, float, float, float]] = []
    original = _ResumePDF.rect

    def recording(self, x, y, w, h, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003 - fpdf2 的签名
        rects.append((float(x), float(y), float(w), float(h)))
        return original(self, x, y, w, h, *args, **kwargs)

    monkeypatch.setattr(_ResumePDF, "rect", recording)

    layout = resolve_layout(template="modern", base_px=14.0, format_config={})
    resume = ResumeContent(name="张三", job_intent="后端", phone="13800001234")
    build_resume_pdf(resume, template="modern", page_limit=1, font_scale="standard")

    # 页头底色块是**唯一**画满正文宽度的矩形：区块标题的浅色块只有文字那么宽，标签更窄。
    content_width = PAGE_WIDTH_MM - 2 * layout.margin_mm
    backdrops = [rect for rect in rects if rect[2] == pytest.approx(content_width)]
    assert len(backdrops) == 1, f"页头底色块应当只有一个，实际 {len(backdrops)} 个"

    base = layout.base_px
    line_advance = base * _PX_TO_MM * layout.line_height
    expected = (
        layout.name_ratio * line_advance
        + layout.gap_mm(layout.intent_gap)
        + layout.intent_ratio * line_advance
        + layout.gap_mm(layout.contact_gap)
        + layout.contact_ratio * line_advance
        + 2 * layout.gap_mm(layout.header_pad_y)
    )

    assert backdrops[0][3] == pytest.approx(expected, abs=0.2), (
        "页头底色块的高度没含两段段前留白：删掉 `text_height += layout.gap_mm(...)` 那两行，"
        "色块会矮约 3mm，页头下半部分就没有底色了"
    )


# ===== 四向页边距与照片系数（2026-10-22「照片大小 + 四向页边距」）=====
#
# `ResumeLayout.margin_mm` 拆成四边之后，`usable_*` 与照片尺寸全部改读四边。这一组钉住
# 三件事：默认仍四边相等（存量简历不变）、不对称真的生效、以及"可容宽 + 左右边距 ≡ A4"
# 这条几何不变量（列几何、页数判定都建在它上面）。


def test_default_layout_keeps_four_equal_sides():
    """没设过时四边都等于模板 `padding_mm`——存量简历的 PDF 不许因为这次改动跳变。"""
    layout = resolve_layout(template="classic", base_px=14.0, format_config={})
    defaults = TEMPLATE_LAYOUT_DEFAULTS["classic"]
    expected = float(defaults["padding_mm"])

    assert layout.margin_top == pytest.approx(expected)
    assert layout.margin_right == pytest.approx(expected)
    assert layout.margin_bottom == pytest.approx(expected)
    assert layout.margin_left == pytest.approx(expected)
    assert layout.usable_width_mm == pytest.approx(PAGE_WIDTH_MM - 2 * expected)
    assert layout.usable_height_per_page == pytest.approx(297.0 - 2 * expected)
    # 两个兼容属性在读"四边相等"的旧路径上仍是那一个值。
    assert layout.margin_mm == pytest.approx(expected)
    assert layout.margin_x == pytest.approx(expected)


def test_asymmetric_sides_reach_the_layout():
    layout = resolve_layout(
        template="classic",
        base_px=14.0,
        format_config={"page_padding": 12, "page_padding_left": 8},
    )

    assert layout.margin_left == pytest.approx(8.0)
    assert layout.margin_right == pytest.approx(12.0)
    assert layout.margin_top == pytest.approx(12.0)
    assert layout.margin_bottom == pytest.approx(12.0)
    assert layout.usable_width_mm == pytest.approx(PAGE_WIDTH_MM - 8.0 - 12.0)


@pytest.mark.parametrize(
    "config",
    [
        {"page_padding": 14},
        {"page_padding": 14, "page_padding_left": 8},
        {"page_padding": 20, "page_padding_right": 26},
        {"page_padding": 8, "page_padding_top": 26, "page_padding_bottom": 26},
        {
            "page_padding_top": 8,
            "page_padding_right": 9,
            "page_padding_bottom": 10,
            "page_padding_left": 11,
        },
    ],
)
def test_usable_box_plus_margins_is_always_a4(config):
    """无论怎么不对称，``可用宽 + 左 + 右 ≡ 210mm``、``可用高 + 上 + 下 ≡ 297mm``。

    双栏模板的列几何（`columns.column_frames`）与分页判定都建在这条恒等式上：它一旦不成立，
    "第 N 页内容起点"就会与预览错开，而这在单页简历上完全看不出来。
    """
    layout = resolve_layout(template="split", base_px=14.0, format_config=config)

    assert layout.usable_width_mm + layout.margin_left + layout.margin_right == pytest.approx(
        PAGE_WIDTH_MM
    )
    assert layout.usable_height_per_page + layout.margin_top + layout.margin_bottom == (
        pytest.approx(297.0)
    )


@pytest.mark.parametrize("name", sorted(RESUME_TEMPLATES))
def test_photo_scale_multiplies_both_photo_ratios(name):
    """系数乘在模板自己的两个比例上，宽高同乘 → 宽高比不变 → 取景裁剪一像素都不变。"""
    defaults = TEMPLATE_LAYOUT_DEFAULTS[name]
    base = resolve_layout(template=name, base_px=14.0, format_config={})
    scaled = resolve_layout(template=name, base_px=14.0, format_config={"photo_scale": 1.5})

    assert scaled.photo_width_ratio == pytest.approx(float(defaults["photo_width_ratio"]) * 1.5)
    assert scaled.photo_height_ratio == pytest.approx(float(defaults["photo_height_ratio"]) * 1.5)
    assert scaled.photo_width_ratio / scaled.photo_height_ratio == pytest.approx(
        base.photo_width_ratio / base.photo_height_ratio
    )


@needs_font
def test_pdf_left_origin_follows_only_the_left_margin():
    """PDF 正文的 x 起点只由**左**边距决定（右边距只收窄折行宽度）。"""
    resume = _summary_only_resume(_filler(300))
    asymmetric = build_resume_pdf(
        resume, template="classic", page_limit=2, font_scale="standard",
        format_config={"page_padding": 12, "page_padding_left": 8},
    )
    uniform = build_resume_pdf(
        resume, template="classic", page_limit=2, font_scale="standard",
        format_config={"page_padding": 8},
    )

    left_asymmetric = min(run[0] for run in _text_runs(asymmetric.content))
    left_uniform = min(run[0] for run in _text_runs(uniform.content))
    assert left_asymmetric == pytest.approx(left_uniform, abs=0.2)


