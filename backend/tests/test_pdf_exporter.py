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
3. **版式合成**（`resolve_layout` / `decide_fit_scale`）——纯逻辑，逐条钉；
4. **真实 PDF 几何**（pypdf）——行高/页边距/一页适配是否真的作用到排版上。

拆分说明：resolve/fit 与 measure/rhythm/padding 用例已迁至 test_pdf_exporter_layout.py；
绘制行为与 overflow/一页适配/强调色用例已迁至 test_pdf_exporter_overflow.py；
性别字号与照片裁剪用例已迁至 test_pdf_exporter_photo.py。
跨文件共用的 helper（_pdf_with_font / _text_runs / _body_lines / _hex_to_rgb /
needs_font / _MM_TO_PT 等）按契约留在本文件，兄弟文件单向导入。
"""
import re
from io import BytesIO

import pytest
from app.schemas.resume import ResumeAward, ResumeContent
from app.services.pdf_exporter import (
    _FIT_MAX_PASSES,
    _FIT_MIN_STEP,
    _FIT_RATIO_MARGIN,
    _FIT_TOLERANCE_MM,
    _PX_TO_MM,
    _PX_TO_PT,
    MIN_FIT_SCALE,
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
from app.services.resume.resume_templates import (
    TEMPLATE_LAYOUT_DEFAULTS,
    TEMPLATES_DIR,
)
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
            runs.append((round(float(tm[4]), 3), round(float(tm[5]), 3), round(float(font_size), 4), text))

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


def _blind_spot_resume() -> ResumeContent:
    """一份"**连续高说装得下、真实分页却两页**"的简历——一页适配会在此说谎的场景。

    一段几乎填满整页的总结 + 末尾一个只有一行的奖项：结尾区块的 `ensure_space`
    会为它**预留两行**高度，于是即便只剩一行多一点的空间也会提前换页，在第一页尾部
    留出一段空隙。结果：连续高约 255.3mm（< 可用 261mm）却真实排成 2 页。只按连续高
    判定的旧实现会返回 ``(scale=1.0, overflow=False)``——请求 1 页、给了 2 页、还说装得下。

    备注：补齐"垂直间距"（页头 / 条目 / 副行 / 列表项 / 标题下间距）后几何整体变高，原先的
    `_filler(1450)` 已让连续高越过了可用高、不再是盲区。这里按新几何把填充长度收到 1400
    （连续高 255.3mm），让"连续高 ≤ 可用高但真实 2 页"的盲区重新成立。
    """
    return ResumeContent(
        name="张三",
        summary=_filler(1400),
        awards=[ResumeAward(name="校级奖学金", date="2023")],
    )


# ===== 几何 =====


def test_tag_metrics_follow_the_html_template_ratios():
    """标签尺寸的比例来自 HTML 模板；两边对不上，PDF 与预览就又开始不一样。

    模板里 `.skill-list li` 是：字号 `tag_font_ratio × --fs`、左右内边距 `0.71 × 标签字号`。
    期望值从注册表读（它本身又被 `test_resume_layout.py` 拿模板 CSS 逐条核对过），
    不在这里再抄一份常量——抄一份就等于又写了一遍"跟自己比"。
    """
    classic = TEMPLATE_LAYOUT_DEFAULTS["classic"]
    tag_ratio = classic["tag_font_ratio"]
    base = 14.0
    metrics = skill_tag_metrics(base, line_height=classic["line_height"], tag_ratio=tag_ratio)

    assert metrics.font_pt == pytest.approx(base * tag_ratio * _PX_TO_PT)
    assert metrics.padding_x == pytest.approx(base * tag_ratio * _PX_TO_MM * 0.71)
    # 高度要能装下字号本身，否则文字会被裁掉。
    assert metrics.height > base * tag_ratio * _PX_TO_MM


def test_tag_height_uses_the_template_line_height():
    """标签高度 = 标签字号 × **模板行高**——与预览里 `.skill-list li` 继承 body 行高同理。

    这条防止有人又把标签行高写死成某个与模板无关的常数。
    """
    classic = TEMPLATE_LAYOUT_DEFAULTS["classic"]
    tag_ratio = classic["tag_font_ratio"]
    base = 14.0
    for line_height in (1.5, 1.7, 1.8):
        metrics = skill_tag_metrics(base, line_height=line_height, tag_ratio=tag_ratio)
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


# ===== 与预览脚本的跨侧漂移守卫 =====


_FIT_SCRIPT = TEMPLATES_DIR / "_resume_fit_script.j2"


def test_fit_scale_constants_match_the_preview_script():
    """PDF 与预览的 `--fit-scale` 是两套引擎里的两份实现，只能靠测试钉住同步。

    预览脚本是 JS（`_resume_fit_script.j2`），PDF 是本模块的 Python 常量，两者无法共享
    同一份代码——所以有人只改一边时，另一边不会跟着变，就会让"预览装得下、PDF 却溢出
    （或反过来）"悄悄发生。这条测试直接读脚本文本、把几个魔法数逐个解析出来，与 PDF
    侧常量做**数值比对**：期望值不是在本测试里再抄一遍，而是把两边的字面量拿来对。
    """
    script = _FIT_SCRIPT.read_text(encoding="utf-8")

    min_scale = re.search(r"const minScale = ([\d.]+)", script)
    max_passes = re.search(r"const maxPasses = (\d+)", script)
    ratio_margin = re.search(r"Math\.min\([^)]*\)\s*\*\s*([\d.]+)", script)
    min_step = re.search(r"scale - ([\d.]+)", script)
    tolerance = re.search(r"referenceHeight \+ (\d+)", script)

    assert min_scale, "脚本里没找到 minScale"
    assert max_passes, "脚本里没找到 maxPasses"
    assert ratio_margin, "脚本里没找到 0.995 的比例余量"
    assert min_step, "脚本里没找到最小步长"
    assert tolerance, "脚本里没找到 +1px 容差"

    assert float(min_scale.group(1)) == MIN_FIT_SCALE
    assert int(max_passes.group(1)) == _FIT_MAX_PASSES
    assert float(ratio_margin.group(1)) == _FIT_RATIO_MARGIN
    assert float(min_step.group(1)) == _FIT_MIN_STEP
    # 容差两侧单位不同：脚本里是 1px，PDF 里是 mm。1px = _PX_TO_MM mm，换算后必须一致。
    assert float(tolerance.group(1)) * _PX_TO_MM == pytest.approx(_FIT_TOLERANCE_MM)

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
