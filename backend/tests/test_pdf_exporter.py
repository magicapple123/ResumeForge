# SPDX-License-Identifier: Apache-2.0
"""服务端 PDF 导出：标签几何、折行边界、绘制行为，以及与预览口径的对齐。

这个模块此前没有任何测试，而它恰好是"预览与导出不一致"的另一个源头：技能标签在预览里是
带底色的圆角小框，导出的 PDF 里却曾是一行用「、」连起来的纯文本（用户实测反馈）。

**为什么这一版要加"从 PDF 里读回文字矩阵"的几何断言**：直出 PDF 与预览是两套独立排版引擎，
PDF 曾经**完全忽略 `format_config`**、还内置了一套与模板不一致的行距系数，而旧测试是"拿 PDF
自己的常量跟自身比"——结构性测不出这类漂移。所以这里用 `pypdf` 读回每个文字块的字号、基线
坐标与 x 起点来断言几何真的变了；并且**期望值一律从模板注册表读出来**，不再抄一份常量。

分四层验：
1. **几何**（`skill_tag_metrics`）——比例必须与 HTML 模板的 `.skill-list li` 对齐；
2. **折行**（`wrap_skill_tags`）——算错不会报错，只会让标签悄悄跑出页面，所以逐条钉边界；
3. **版式合成**（`resolve_layout`）——纯逻辑，逐条钉；
4. **真实 PDF 几何**（pypdf）——行高/页边距是否真的作用到排版上。

拆分说明：resolve/fit 与 measure/rhythm/padding 用例已迁至 test_pdf_exporter_layout.py；
绘制行为与 overflow/一页适配/强调色用例已迁至 test_pdf_exporter_overflow.py；
性别字号与照片裁剪用例已迁至 test_pdf_exporter_photo.py。
跨文件共用的 helper（_pdf_with_font / _text_runs / _body_lines / _hex_to_rgb /
needs_font / _MM_TO_PT 等）按契约留在本文件，兄弟文件单向导入。
"""

from io import BytesIO

import pytest
from app.schemas.resume import ResumeAward, ResumeContent
from app.services.pdf_exporter import (
    _PX_TO_MM,
    _PX_TO_PT,
    _resolve_font_paths,
    _ResumePDF,
    build_resume_pdf,
    font_available,
    resolve_layout,
    skill_tag_metrics,
    soft_accent,
    wrap_skill_tags,
)
from app.services.resume.resume_sample import sample_resume_content
from app.services.resume.resume_templates import TEMPLATE_LAYOUT_DEFAULTS
from pypdf import PdfReader

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")

# 1mm = 72/25.4 pt，用于把 mm 期望值换算成 PDF 里的磅坐标。
# 说明：fpdf2 在单元格里默认留 1mm 内边距，文字实际起点比页边距大 1mm；下面只做
# **差值**断言，这个常数会自动抵消，所以不把它写进期望值。
_MM_TO_PT = 72 / 25.4


def _pdf_with_font() -> _ResumePDF:
    """造一个已注册中文字体、且带"经典模板"版式的 PDF。

    `build_resume_pdf` 会自己解析版式并注册字体；这里单独用 `_ResumePDF` 测绘制行为，
    就必须显式给出两者，否则 `set_font("resume-cjk")` 会抛 "Undefined font"。
    """
    regular, bold = _resolve_font_paths()
    layout = resolve_layout(template="classic", base_px=14.0, format_config=None)
    pdf = _ResumePDF((15, 118, 110), layout)
    pdf.add_font("resume-cjk", "", regular)
    pdf.add_font("resume-cjk", "B", bold)
    pdf.add_page()
    return pdf


def _text_runs(content: bytes) -> list[tuple[float, float, float, str]]:
    """把 PDF 里每个文字块读成 ``(x_pt, 基线y_pt, 字号pt, 文本)``。

    `extract_text(visitor_text=...)` 的回调签名是 ``(text, cm, tm, font_dict, font_size)``：
    ``tm[4]`` 是 x、``tm[5]`` 是基线 y（原点在左下角）、``font_size`` 是字号（pt）。
    """
    reader = PdfReader(BytesIO(content))
    runs: list[tuple[float, float, float, str]] = []

    def visit(text: str, cm, tm, font_dict, font_size) -> None:  # noqa: ANN001 - pypdf 回调签名
        # fpdf2 >= 2.8.8 对 CID-keyed CFF 字体（如 Linux 的 NotoSansCJK）按规范以
        # raw CFF + 内嵌 /Encoding CMap 嵌入（fpdf2#1874）；pypdf 尚不解析内嵌
        # Encoding CMap，把 2 字节码按单字节读出，于是每个字形前多出一个 U+0000
        # （"\x00张\x00三"）。几何（x/y/字号）不受影响；剥掉 NUL 即还原真实文本，
        # 断言强度不变。pypdf 支持内嵌 CMap 后此清理自动变成 no-op。
        text = text.replace("\x00", "")
        if text.strip():
            runs.append(
                (round(float(tm[4]), 3), round(float(tm[5]), 3), round(float(font_size), 4), text)
            )

    for page in reader.pages:
        page.extract_text(visitor_text=visit)
    return runs


# PDF 里区块标题用的固定文字（见 `pdf_exporter._draw_resume`）。它们一般是加粗、且字号与正文
# 不同，**唯独 minimal 模板的 `section_title_ratio` 恰好是 1.0**——标题字号与正文基准字号相同，
# 于是会被下面"只留正文行"的过滤误收进来。此时量到的第一对差值其实是"标题→正文"（夹着
# section_gap 与标题下间距，比值会得到 2.2 这种假值），而不是段落内部的行距。按文字排除掉。
_SECTION_TITLES = frozenset(
    {"个人总结", "教育经历", "实习/工作经历", "校园经历", "项目经历", "专业技能", "荣誉奖项"}
)


def _body_lines(content: bytes, *, base_px: float) -> list[tuple[float, float, float, str]]:
    """只留正文行（字号等于基准字号、且不是区块标题），用于量行距。"""
    return [
        run
        for run in _text_runs(content)
        if abs(run[2] - base_px * _PX_TO_PT) < 0.01 and run[3].strip() not in _SECTION_TITLES
    ]


def _summary_only_resume(text: str) -> ResumeContent:
    """只含一段"个人总结"的简历：正文之外没有其它元素，便于逐行量行距。"""
    return ResumeContent(name="", summary=text)


def _filler(chars: int) -> str:
    """生成可折行的中文长文本；`chars` 控制长度（不依赖具体折行算法）。"""
    unit = "负责后端服务的设计与开发，保证接口稳定与性能达标。"
    return (unit * (chars // len(unit) + 1))[:chars]


# minimal 模板强调色（`TEMPLATE_LAYOUT_DEFAULTS["minimal"]["accent"]` = #17181a 的 RGB）。
# 这里只影响配色，不影响几何。
_MINIMAL_ACCENT = (23, 24, 26)


def _one_page_boundary_resume(filler_chars: int) -> ResumeContent:
    """一份"一页适配正好在边界上"的简历：`filler_chars` 决定它装得下 / 装不下。

    一段几乎填满整页的总结 + 末尾一个只有一行的奖项。最小模板（`padding_mm` 18、
    行高 1.8、`base_px` 14）下实测：1400 字 → 连续高 255.29mm、真实 1 页；
    1430 字 → 连续高 261.96mm、真实 2 页（可用高 261.00mm）。两次之间正好跨过边界。

    **2026-10-21（B3）重新取参**：此前这里用 1400 字，靠"末尾奖项的 `ensure_space`
    固定预留两行"人为制造出"连续高说装得下、真实却两页"的盲区。B3 把列表项的预留改成
    **整条实测高度**后，那个盲区（它本来就是多留出来的）不再成立——现在每一处预留都等于
    它守护的内容真实高度，页面因此只在"真的放不下"时提前换页。所以这条 helper 现在用于
    **跨边界的两个样本**（装得下 / 装不下），而不是伪造一个"连续高撒谎"的场景。
    """
    return ResumeContent(
        name="张三",
        summary=_filler(filler_chars),
        awards=[ResumeAward(name="校级奖学金", date="2023")],
    )


# ===== 几何 =====


def _classic_tag_metrics(base: float, *, line_height: float | None = None):
    """按 classic 模板的注册表值算一套标签尺寸（供下面几条用例复用）。

    比例一律从 `TEMPLATE_LAYOUT_DEFAULTS` 读——`skill_tag_metrics` 不保留任何比例副本，
    参数全由调用方传入（8 个模板的标签几何各不相同，写死一份只对 classic 成立）。
    """
    classic = TEMPLATE_LAYOUT_DEFAULTS["classic"]
    return skill_tag_metrics(
        base,
        line_height=classic["line_height"] if line_height is None else line_height,
        tag_ratio=classic["tag_font_ratio"],
        pad_x=classic["tag_pad_x"],
        gap_x=classic["tag_gap_x"],
        gap_y=classic["tag_gap_y"],
        radius=classic["tag_radius"],
        border_px=classic["tag_border_px"],
    )


def test_tag_metrics_follow_the_html_template_ratios():
    """标签尺寸的比例来自 HTML 模板；两边对不上，PDF 与预览就又开始不一样。

    模板里 `.skill-list li` 是：字号 `tag_font_ratio × --fs`、左右内边距
    `tag_pad_x × 标签字号`、行内间距 `tag_gap_x ×`、行间 `tag_gap_y ×`。期望值从注册表读
    （它本身又被模板 CSS 逐条核对过），不在这里再抄一份常量——抄一份就等于又写了一遍
    "跟自己比"。
    """
    classic = TEMPLATE_LAYOUT_DEFAULTS["classic"]
    tag_ratio = classic["tag_font_ratio"]
    base = 14.0
    metrics = _classic_tag_metrics(base)

    assert metrics.font_pt == pytest.approx(base * tag_ratio * _PX_TO_PT)
    assert metrics.padding_x == pytest.approx(base * tag_ratio * _PX_TO_MM * classic["tag_pad_x"])
    assert metrics.gap_x == pytest.approx(base * tag_ratio * _PX_TO_MM * classic["tag_gap_x"])
    assert metrics.gap_y == pytest.approx(base * tag_ratio * _PX_TO_MM * classic["tag_gap_y"])
    # classic 没有边框；classic 的圆角 CSS 是固定 4px，注册表按标准字号折成 `tag_radius`。
    assert metrics.border_mm == 0.0
    assert metrics.radius == pytest.approx(base * tag_ratio * _PX_TO_MM * classic["tag_radius"])
    # 高度要能装下字号本身，否则文字会被裁掉。
    assert metrics.height > base * tag_ratio * _PX_TO_MM


def test_pill_radius_is_half_the_tag_height():
    """胶囊（CSS `border-radius: 999px`）画成 `height / 2`：圆到短边一半，与浏览器一致。

    modern / split 的标签是胶囊，注册表里写 `"pill"` 哨兵——它不能被当成"999 倍字号"的
    比例，否则圆角会大到把标签画成两段弧。
    """
    modern = TEMPLATE_LAYOUT_DEFAULTS["modern"]
    metrics = skill_tag_metrics(
        14.0,
        line_height=modern["line_height"],
        tag_ratio=modern["tag_font_ratio"],
        pad_x=modern["tag_pad_x"],
        gap_x=modern["tag_gap_x"],
        gap_y=modern["tag_gap_y"],
        radius=modern["tag_radius"],
        border_px=modern["tag_border_px"],
    )

    assert modern["tag_radius"] == "pill"
    assert metrics.radius == pytest.approx(metrics.height / 2)
    # 1px 的描边换算成毫米（描边宽度不随字号缩放，CSS 里就是固定 px）。
    assert metrics.border_mm == pytest.approx(1 * _PX_TO_MM)


def test_tag_height_uses_the_template_line_height():
    """标签高度 = 标签字号 × **模板行高**——与预览里 `.skill-list li` 继承 body 行高同理。

    这条防止有人又把标签行高写死成某个与模板无关的常数。
    """
    classic = TEMPLATE_LAYOUT_DEFAULTS["classic"]
    tag_ratio = classic["tag_font_ratio"]
    base = 14.0
    for line_height in (1.5, 1.7, 1.8):
        metrics = _classic_tag_metrics(base, line_height=line_height)
        assert metrics.height == pytest.approx(base * tag_ratio * _PX_TO_MM * line_height)


def test_soft_accent_lightens_towards_white():
    assert soft_accent((0, 0, 0), ratio=0.5) == (128, 128, 128)
    # 强调色越深，调淡后越亮；且永远不等于纯白（否则标签在白底上看不见边界）。
    softened = soft_accent((15, 118, 110))
    assert all(channel > 200 for channel in softened)
    assert softened != (255, 255, 255)


# ===== 折行边界 =====


def test_wrap_keeps_everything_on_one_row_when_it_fits():
    assert wrap_skill_tags([20.0, 20.0, 20.0], max_width=100.0, gap=5.0) == [[0, 1, 2]]


def test_wrap_breaks_exactly_at_the_boundary():
    # 20 + 5 + 20 + 5 + 20 = 70 ≤ 70 → 三个一行；再多一个就要换行。
    assert wrap_skill_tags([20.0] * 4, max_width=70.0, gap=5.0) == [[0, 1, 2], [3]]
    assert wrap_skill_tags([20.0] * 3, max_width=70.0, gap=5.0) == [[0, 1, 2]]


def test_wrap_puts_an_oversized_tag_on_its_own_row():
    """单个标签比可用宽度还宽时，只能让它单独占一行（正文不可断行）。

    不能在这里硬切文字，也不能让它把后面的标签挤到同一行——两种都会让版式更难看。
    """
    assert wrap_skill_tags([200.0, 20.0], max_width=100.0, gap=5.0) == [[0], [1]]


def test_wrap_handles_empty_input():
    assert wrap_skill_tags([], max_width=100.0, gap=5.0) == []


def test_wrap_never_drops_a_tag():
    """任何输入都不得丢标签——算法兜底时最容易犯的错。"""
    widths = [13.0, 47.0, 5.0, 88.0, 21.0, 3.0]

    rows = wrap_skill_tags(widths, max_width=60.0, gap=4.0)

    assert sorted(index for row in rows for index in row) == list(range(len(widths)))


# ===== 强调色覆盖 =====


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    """把十六进制颜色转成 RGB（供测试从注册表读期望值，避免再抄一份常量）。"""
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(char * 2 for char in text)
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))


# ===== 端到端 =====


@needs_font
def test_pdf_with_skill_tags_builds():
    result = build_resume_pdf(sample_resume_content(), template="classic", page_limit=1)

    assert result.content.startswith(b"%PDF-")
    assert result.pages >= 1


@needs_font
def test_fitting_without_scaling_reuses_the_first_render(monkeypatch):
    """装得下的时候只排**一遍**，不是"数页数一遍 + 出图一遍"。

    2026-10-21 实测：单次渲染 0.48 秒，而精确预览在"内容 2 页、上限 1 页"时要 2.2–2.7 秒
    ——其中一半是重复渲染。`build_resume_pdf` 现在会在"第一轮就判定装得下"时直接复用
    那一版产物；这条用例把"复用"钉住，防止将来有人改回两遍（性能直接翻倍，而且没人会
    在功能测试里发现）。

    计数落在 `_draw_resume` 上：它是"真排一遍"的唯一入口，比计时稳定得多。
    """
    from app.services.pdf_exporter import fit as fit_module

    calls: list[int] = []
    original = fit_module._draw_resume

    def counting(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(fit_module, "_draw_resume", counting)

    # sample 简历在 3 页上限下本来就装得下 → 走复用分支。
    result = build_resume_pdf(sample_resume_content(), template="classic", page_limit=3)

    assert result.pages <= 3
    assert result.overflow is False
    assert result.pages_needed == result.pages
    assert len(calls) == 1, f"装得下时应当只排一遍，实际排了 {len(calls)} 遍"


# ===== 页头字段（与预览同集合）=====


@needs_font
def test_pdf_header_contact_keeps_every_field_the_preview_renders():
    """页头联系方式必须包含预览里的**全部六个**字段，一个都不能少。

    预览的 `_resume_sections.j2` 在 `.contact` 里依次渲染 phone / email / city / birth_year /
    `GitHub：…` / `个人主页：…`；PDF 侧此前只拼了前四个，GitHub 与个人主页整段从导出的文件里消失
    （用 pypdf 提取文本确认过：预览有、PDF 没有）。这里从**真实 PDF 首页**读回文本逐字段核对，
    而不是断言拼接用的那个字符串——后者只能证明"我拼对了"，不能证明"纸上真的有"。
    """
    resume = ResumeContent(
        name="张三",
        phone="139-0000-0000",
        email="zhangsan@example.com",
        city="杭州",
        birth_year="1998",
        github="github.com/zhangsan",
        personal_website="zhangsan.dev",
        summary="一句话总结，用来占住一页的下半部分。",
    )
    result = build_resume_pdf(resume, template="classic", page_limit=1, font_scale="standard")

    first_page = "".join(
        page.extract_text() or "" for page in PdfReader(BytesIO(result.content)).pages
    )
    # 提取里可能夹 NUL（见 `_text_runs`）与折行空白；联系方式会折成两行，所以整串去空白再比对。
    compact = "".join(first_page.replace("\x00", "").split())

    for value in (
        "139-0000-0000",
        "zhangsan@example.com",
        "杭州",
        "1998",
        "GitHub：github.com/zhangsan",
        "个人主页：zhangsan.dev",
    ):
        assert value in compact, f"PDF 页头缺少联系方式字段：{value!r}"


# ===== 正文 / 辅助文字颜色由模板决定 =====


@needs_font
def test_text_colors_come_from_the_template_not_from_a_module_constant(monkeypatch):
    """同一份简历用 minimal 与 technical 导出，PDF 里的文字颜色必须**不同**。

    这是"模板 `:root` 的 `--text` / `--muted` 对 PDF 完全无效"这个 bug 的回归防线：旧实现
    把正文色写死在 `layout._BODY_TEXT`，两个模板导出的 PDF 里 `set_text_color` 的调用序列
    逐项相同（都是 `#1f2937` / `#6b7280`），这条断言会直接失败。

    期望色从注册表读（minimal `#17181a`、technical `#1c2430` / `#5d6b7a`），不写字面量。
    抓 `set_text_color` 而不是解析 PDF 内容流：一个是"渲染器真的要了什么色"，另一个还要
    额外处理颜色空间的编码细节，前者更接近这条 bug 的成因。
    """
    seen: list[tuple[int, int, int]] = []
    original = _ResumePDF.set_text_color

    def recording(self, *args):  # noqa: ANN001, ANN002 - 只是记录 fpdf2 的调用
        if len(args) == 3:
            seen.append((int(args[0]), int(args[1]), int(args[2])))
        return original(self, *args)

    monkeypatch.setattr(_ResumePDF, "set_text_color", recording)

    resume = ResumeContent(
        name="张三",
        job_intent="后端开发",
        phone="13800001234",
        summary="一句话总结，用来占住一页的下半部分。",
    )
    used: dict[str, set[tuple[int, int, int]]] = {}
    for name in ("minimal", "technical"):
        seen.clear()
        build_resume_pdf(resume, template=name, page_limit=1, font_scale="standard")
        used[name] = set(seen)

    minimal_text = _hex_to_rgb(TEMPLATE_LAYOUT_DEFAULTS["minimal"]["text"])
    technical_text = _hex_to_rgb(TEMPLATE_LAYOUT_DEFAULTS["technical"]["text"])
    technical_muted = _hex_to_rgb(TEMPLATE_LAYOUT_DEFAULTS["technical"]["muted"])

    assert minimal_text in used["minimal"]
    assert technical_text in used["technical"]
    assert technical_muted in used["technical"]
    # 关键：两个模板的正文色**互不出现在对方**的绘制调用里。
    assert minimal_text not in used["technical"]
    assert technical_text not in used["minimal"]
    assert minimal_text != technical_text, "两个模板的 --text 相同就测不出这条"


@needs_font
@pytest.mark.parametrize("template", ["modern", "technical"])
def test_section_title_fill_spans_the_full_column(template):
    """区块标题的底色块必须**铺满列框**，而不是只包住文字。

    模板里 `.section-title` 是 block 元素（`background` + `padding`），浏览器画出来是一条
    通栏色带；PDF 若按 `text_width` 画，短标题（「个人总结」四个字）只得到一小块色块——
    草稿与精确预览因此"绿色背景分布不一样"（2026-10-24 用户截图：modern 模板）。
    technical 的实心底色块（`accent_box`）同理。
    """
    from app.services.pdf_exporter import resolve_layout
    from app.services.pdf_exporter.canvas import _ResumePDF
    from app.services.pdf_exporter.fonts import _resolve_font_paths
    from app.services.pdf_exporter.render import _register_fonts

    layout = resolve_layout(template=template, base_px=14.0, format_config=None)
    canvas = _ResumePDF((22, 90, 80), layout)
    _register_fonts(canvas, *_resolve_font_paths())
    canvas.add_page()

    drawn: list[tuple[float, float, float, float]] = []
    canvas.rect = lambda x, y, w, h, **kwargs: drawn.append((x, y, w, h))

    canvas.section_title("个人总结", 14.0, leading_gap=0.0)

    assert drawn, "标题没有画底色块"
    left, _top, width, _height = drawn[0]
    assert left == pytest.approx(layout.margin_x)
    assert width == pytest.approx(layout.usable_width_mm)
