"""PDF 版式合成与真实 PDF 几何：resolve_layout / decide_fit_scale / 行距 / 页边距。

拆分自 test_pdf_exporter.py——纯逻辑的版式合成用例，与"真实 PDF 几何"里量行距、
行高覆盖、页边距起点（x origin）的 pypdf 用例收在这里。
复用主文件的 helper（needs_font / _text_runs / _body_lines / _summary_only_resume /
_filler / _MM_TO_PT）。
"""
import pytest

from app.services.pdf_exporter import (
    MIN_FIT_SCALE,
    _PX_TO_PT,
    build_resume_pdf,
    decide_fit_scale,
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


def test_fit_scale_is_not_used_when_content_fits():
    # 真实页数 1 页（≤ 上限）、连续高也低于可用高 → 不缩、不溢出。
    assert decide_fit_scale(
        lambda _scale: 1, lambda _scale: 50.0, page_limit=1, usable_height=100.0
    ) == (1.0, False)


def test_fit_scale_shrinks_proportionally_and_marks_no_overflow():
    # 连续高 190×scale、可用 100 → 缩到 ~0.52 才装得下；一旦**真实页数**降到 1 就停。
    def pages(scale: float) -> int:
        return 2 if 190.0 * scale > 100.0 else 1

    scale, overflow = decide_fit_scale(
        pages, lambda s: 190.0 * s, page_limit=1, usable_height=100.0
    )

    assert 0.5 < scale < 1.0
    assert overflow is False


def test_fit_scale_respects_the_floor_and_reports_overflow():
    """缩到下限（`MIN_FIT_SCALE`）仍放不下时，如实标记 overflow，绝不继续缩或裁内容。"""
    scale, overflow = decide_fit_scale(
        lambda _scale: 2, lambda s: 400.0 * s, page_limit=1, usable_height=100.0
    )

    assert scale == MIN_FIT_SCALE
    assert overflow is True


def test_fit_scale_shrinks_until_the_real_page_count_fits_not_just_the_height():
    """**直接钉 `decide_fit_scale` 的决策行为**——本次修复最关键、又最难被端到端测试守住的一部分。

    用 mock 控制 ``pages(scale)``，绕开真实渲染的边界：构造"连续高**一直在说装得下**（恒低于
    可用高）、但真实页数要到 ``scale <= 0.99`` 才降到 1 页"的坏情况。旧口径（只看连续高）会
    **立刻**判定装得下、``scale`` 停在 1.0、真实仍 2 页——把 `decide_fit_scale` 改回按连续高
    判定，这条必红。

    断言看的是**决策后的真实页数**（``pages(scale) <= page_limit``），**不是** `overflow`：后者
    可能被 `build_resume_pdf` 末端的硬闸兜成真，单看它就区分不出"真的缩进去了"还是"没缩但标志
    诚实"——而"按真实页数决定收缩量"才是这次修复的价值所在。这条不依赖字体，纯逻辑。
    """

    def pages(scale: float) -> int:
        return 2 if scale > 0.99 else 1

    def height(_scale: float) -> float:
        # 恒低于可用高：模拟"连续高一直在说装得下"的坏情况（比例跳档失效，只能靠离散档）。
        return 50.0

    scale, overflow = decide_fit_scale(pages, height, page_limit=1, usable_height=100.0)

    assert pages(scale) <= 1, (
        f"决策后真实页数仍为 {pages(scale)}（scale={scale}）——没有按真实页数收缩"
    )
    assert scale < 1.0
    assert overflow is False

@needs_font
def test_measure_content_height_is_linear_in_fit_scale():
    """内容高度随 fit-scale 单调下降，且缩放只作用在字号派生尺寸上。

    这条守住"缩放只缩字号派生尺寸、mm 边距不动"的口径：scale 变小，内容必须**真的变矮**，
    否则一页适配就是在做无用功。
    """
    resume = _summary_only_resume(_filler(1200))
    layout = resolve_layout(template="classic", base_px=14.0, format_config=None)

    tall = measure_content_height(resume, accent=(15, 118, 110), layout=layout.with_fit_scale(1.0))
    short = measure_content_height(resume, accent=(15, 118, 110), layout=layout.with_fit_scale(0.6))

    assert 0 < short < tall


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

    tight_gap = _body_lines(tight.content, base_px=base_px)[0][1] - _body_lines(tight.content, base_px=base_px)[1][1]
    loose_gap = _body_lines(loose.content, base_px=base_px)[0][1] - _body_lines(loose.content, base_px=base_px)[1][1]

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

