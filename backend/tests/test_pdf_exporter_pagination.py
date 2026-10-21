# SPDX-License-Identifier: Apache-2.0
"""分页语义回归：PDF 的换页规则必须与草稿的 CSS 分页语义一致（B3）。

草稿预览用 CSS 多列分页，`frontend/src/components/resume-preview/config.ts::columnsCss` 里
写了 ``body .item,body li,body table,body tr { break-inside: avoid }`` 与
``body .section-title,body h1..h4 { break-after: avoid }``——也就是草稿**永远不会把一条 li
劈开**，也**不会让标题单独留在页尾**。PDF 侧此前是：`bullets()` 只按两行预留、随后由
`multi_cell` 按行自动换页，于是任何超过两行的 li 都被劈到两页；`section_title()` 只预留标题
自身高度，标题可能落在页底而正文全在下一页。

后果不是"难看"，而是**两边口径无法对照**：同一份简历，草稿第 1 页显示到某处，PDF 第 1 页会
多显示半条 li，"末页显示到哪"因此对不上——这正是"精确预览与草稿预览不一致"里最难自查的
一类，因为它不报错、也不改变总高度。

分三层验：

1. **端到端**（pypdf 逐页读文本）：一条刚好跨页边界的 li，首句与末句必须在同一页；
2. **兜底**：单条 li 高于一页时不能死循环、不能崩、不能留整页空白（浏览器对
   `break-inside: avoid` 放不下的元素也是照常劈开）；
3. **预留量精确钉住**（spy `ensure_space`）：预留多少毫米是这条规则的全部实现，
   交给端到端用例只能测出"某一页刚好对"，测不出"将来某次改动又少留一行"。

**为什么单独一个文件而不是追加到 `test_pdf_exporter.py`**：本仓库的测试文件同样受
`tests/test_file_size_budget.py` 的 500 行预算约束，`test_pdf_exporter.py` 已有 411 行。
这也是既有惯例——`test_pdf_exporter_layout.py` / `_overflow.py` / `_photo.py` 都是同一原因
拆出来的兄弟文件，helper 由主文件单向导出。
"""

from __future__ import annotations

import threading
from io import BytesIO

import pytest
from app.schemas.resume import MAX_RESUME_PAGES, ResumeContent, ResumeExperience
from app.services.pdf_exporter import _PX_TO_MM, _PX_TO_PT, build_resume_pdf, resolve_layout
from app.services.pdf_exporter.fonts import FONT_FAMILY
from pypdf import PdfReader
from test_pdf_exporter import _MM_TO_PT, _filler, _pdf_with_font, _text_runs, needs_font

# 标记必须是**整条 li 的首句 / 末句**：li 一旦被劈开，标记就会分处两页（或被折断在行尾），
# 于是"同一页里找得到首句也找得到末句"这个断言直接失效。用纯中文、避免长英文串被折行。
MARK_START = "起始标记甲乙丙"
MARK_END = "结束标记丁戊己"

# 一条会折成 3~4 行的 li（160 字）。低于两行时旧实现也能放下，测不出问题。
_BULLET_BODY_CHARS = 160


def _straddle_resume(filler_chars: int) -> ResumeContent:
    """把"某条 li"推到页底的简历：`summary` 的长度决定那条 li 落在页面的哪个位置。

    参数化成一组 `filler_chars`，是为了让那条 li 在不同样本里分别落在"页尾前""刚好跨页"
    "下一页开头"——只在某一页对上不算修好，换一个填充长度又会劈开。
    """
    bullet = f"{MARK_START}{_filler(_BULLET_BODY_CHARS)}{MARK_END}"
    return ResumeContent(
        name="张三",
        summary=_filler(filler_chars),
        experience=[
            ResumeExperience(
                company="某某科技有限公司",
                role="后端开发工程师",
                start_date="2023-03",
                end_date="至今",
                description=[bullet, "第二条简短的列表项。"],
            )
        ],
    )


def _page_texts(content: bytes) -> list[str]:
    """逐页提取文字并去掉所有空白（含 pypdf 对 CID 字体的 NUL，见 `_text_runs` 注释）。

    去掉空白之后，"跨行"就不再影响查找，只剩"跨页"会影响——正是要测的那件事。
    """
    return [
        "".join((page.extract_text() or "").replace("\x00", "").split())
        for page in PdfReader(BytesIO(content)).pages
    ]


def _marker_pages(pages: list[str]) -> tuple[int | None, int | None]:
    """首句 / 末句各自出现在第几页（0 基）；找不到时为 None。"""
    start = next((index for index, text in enumerate(pages) if MARK_START in text), None)
    end = next((index for index, text in enumerate(pages) if MARK_END in text), None)
    return start, end


# 覆盖 1300~1700 这段"刚好跨页"的窗口，并前后各留几个样本：窗口会随版式参数漂移，
# 钉死单个值等于把测试绑在今天的毫米数上。
_STRADDLE_FILLERS = [1000, 1200, 1300, 1350, 1400, 1450, 1500, 1600, 1700]


@needs_font
@pytest.mark.parametrize("filler_chars", _STRADDLE_FILLERS)
def test_a_long_bullet_is_never_split_across_pages(filler_chars):
    """一条 li 的首句与末句必须在**同一页**（草稿的 `li { break-inside: avoid }`）。

    `page_limit=9` 而不是 1：1 页会把后面几页裁掉，标记随之消失，测试就变成"什么都没测"。
    这里要的是自然分页的结果。
    """
    result = build_resume_pdf(
        _straddle_resume(filler_chars),
        template="classic",
        page_limit=9,
        font_scale="standard",
    )
    pages = _page_texts(result.content)
    start, end = _marker_pages(pages)

    assert start is not None, f"filler={filler_chars}：首句标记在 PDF 里找不到（被折断或丢失）"
    assert end is not None, f"filler={filler_chars}：末句标记在 PDF 里找不到（被折断或丢失）"
    assert start == end, (
        f"filler={filler_chars}：同一条 li 被劈到了两页"
        f"（首句在第 {start + 1} 页、末句在第 {end + 1} 页，共 {len(pages)} 页）"
        f"—草稿的 `body li {{ break-inside: avoid }}` 不会这样"
    )


@needs_font
def test_the_straddle_samples_do_reach_a_page_break():
    """上面那批样本里必须有真的排成两页的——否则断言是空转。

    这是一条"守卫的守卫"：如果将来版式整体变松、所有样本都挤进一页，
    `test_a_long_bullet_is_never_split_across_pages` 会全绿但什么都没证明。
    """
    page_counts = [
        build_resume_pdf(
            _straddle_resume(filler_chars),
            template="classic",
            page_limit=9,
            font_scale="standard",
        ).pages
        for filler_chars in _STRADDLE_FILLERS
    ]

    assert max(page_counts) >= 2, f"样本没有跨页，守卫空转：{page_counts}"


@needs_font
def test_a_bullet_taller_than_a_page_still_renders():
    """单条 li 高于一页时必须**照常劈开**，不能死循环、不能崩、不能留整页空白。

    这是"避免劈开"最容易踩的坑：无条件 `ensure_space(整条高度)` 在条目比一页还高时，每次
    换页后仍然放不下，于是要么无限换页（死循环、页数爆炸），要么留出整页空白。浏览器对
    `break-inside: avoid` 放不下的元素同样是"照常劈开"，PDF 侧必须一致。

    用守护线程 + `join(timeout=...)` 做超时保护：Windows 上没有 `signal.alarm`，而一个真的
    死循环会挂住整个测试进程。daemon 线程保证即使超时，进程也能正常退出。
    """
    bullet = f"{MARK_START}{_filler(8000)}{MARK_END}"
    resume = ResumeContent(
        name="张三",
        experience=[
            ResumeExperience(
                company="某某科技有限公司",
                role="后端开发工程师",
                start_date="2023-03",
                end_date="至今",
                description=[bullet],
            )
        ],
    )
    # `build_resume_pdf` 会把页数上限收到 `MAX_RESUME_PAGES`（见 fit.py 的 `limit`），
    # 所以这里不假设"上限 9 页就不会裁"——超长内容一定会被截断，那正是产品口径。
    limit = MAX_RESUME_PAGES

    box: dict[str, object] = {}

    def render() -> None:
        try:
            box["result"] = build_resume_pdf(
                resume, template="classic", page_limit=limit, font_scale="standard"
            )
        except BaseException as exc:  # noqa: BLE001 - 渲染里的任何异常都要带回主线程
            box["error"] = exc

    worker = threading.Thread(target=render, daemon=True)
    worker.start()
    worker.join(timeout=90)

    assert not worker.is_alive(), "渲染超时（疑似死循环）"
    assert "error" not in box, f"单条超长 li 渲染抛异常：{box.get('error')!r}"
    result = box["result"]
    assert result.content.startswith(b"%PDF-")
    # 8000 字 ≈ 160 行 ≈ 4 页；页数爆炸（每次换页都不够、换完还换）会远超这个上界。
    assert result.pages == limit, f"应当排满页数上限后被截断，实际 {result.pages} 页"
    assert result.pages_needed <= limit + 10, f"自然页数异常膨胀：{result.pages_needed}"
    assert result.overflow is True, "超长内容必须如实标记 overflow"

    pages = _page_texts(result.content)
    assert all(text for text in pages), "超长 li 渲染出了空白页（换页后仍放不下就继续换页）"
    # 兜底行为本身要被验证到：这条 li 横跨了多页（照常劈开），而不是被整条丢弃或死循环。
    holding = [index for index, text in enumerate(pages) if "负责后端服务的设计与开发" in text]
    assert len(holding) >= 2, f"超长 li 没有跨页铺开，只出现在第 {holding} 页"
    assert any(MARK_START in text for text in pages), "首句不见了"


def _record_ensure_space(pdf) -> list[float]:  # noqa: ANN001 - 被测画布实例
    """把 `ensure_space` 换成"只记录不换页"。

    FPDF 没有 `__slots__`，实例属性可以直接遮蔽同名方法；`self.ensure_space(h)` 于是调用到
    列表的 `append`。这样就能在不真的换页的前提下，读出**每次预留了多少毫米**。
    """
    seen: list[float] = []
    pdf.ensure_space = seen.append
    return seen


# 列表项符号（与 `canvas._BULLET_MARK` 同值）。这里写字面量而不是导入私有常量：它同时是
# "正文起点"这个断言的契约的一部分——符号拼在正文前面，所以文字块起点比正文起点左一个符号宽。
_BULLET = "· "


def _bullet_box(pdf, base: float = 14.0) -> tuple[float, float, float]:  # noqa: ANN001 - 被测画布
    """列表正文的「文字块起点 x」「`multi_cell` 宽度」「符号宽」——期望值一律从注册表推。

    缩进来自 `layout.li_indent`（模板 `ul { padding-left }` 的结构化映射），符号宽度来自当前
    字体的实际度量（`get_string_width`）。**不抄 `canvas.bullets` 里的算式结果**，否则就是
    "拿实现跟自身比"，缩进改错也不会红。
    """
    layout = pdf.layout
    pdf.set_font(FONT_FAMILY, "", base * _PX_TO_PT)
    marker = float(pdf.get_string_width(_BULLET))
    indent_mm = layout.gap_mm(layout.li_indent)
    return pdf.frame_left + indent_mm - marker, pdf.frame_width - indent_mm, marker


@needs_font
def test_bullets_reserve_the_whole_item_height():
    """每条 li 的预留量 = 该条**实测整条高度**（+ 项间 gap），不是固定两行。

    这条钉住 B3 的核心：旧实现 `ensure_space(line_height * 2)` 对一条 4 行的 li 只留两行，
    必然被 `multi_cell` 劈开；对一条 1 行的 li 又多留了一行，把本来放得下的条目推到下一页
    （同一份简历因此比草稿更早换页）。
    """
    pdf = _pdf_with_font()
    layout = pdf.layout
    base = 14.0
    # 起点/宽度从注册表的 `li_indent` 推（helper 里已把字体设好）。
    _, width, _ = _bullet_box(pdf, base)
    line_height = pdf.line_advance(base)
    li_gap = layout.gap_mm(layout.li_gap)

    short = "只有一行。"
    long = _filler(_BULLET_BODY_CHARS)
    # 预留值 = **纯文本**的整条高度（符号是单独一次 cell，画在首行的行盒里、不占正文宽度，
    # 所以它不会让这一条更高）。`dry_run` 也要先把字体设好，宽度与绘制时完全相同（helper 已设）。
    short_height = float(pdf.multi_cell(width, line_height, short, dry_run=True, output="HEIGHT"))
    long_height = float(pdf.multi_cell(width, line_height, long, dry_run=True, output="HEIGHT"))
    # 前提检查：样本确实一个是单行、一个是多行，否则下面两条断言互相矛盾却都成立。
    assert short_height == pytest.approx(line_height)
    assert long_height > line_height * 2.5, "长样本没有折成多行，测不出问题"

    seen = _record_ensure_space(pdf)
    pdf.bullets([short, long], base)

    assert len(seen) == 2, f"每个 item 应当各自预留一次，实际 {len(seen)} 次"
    # 第一项没有 gap 分摊。
    assert seen[0] == pytest.approx(short_height)
    # 第二项的 gap 必须**并进预留量**：先换页再补 gap，gap 会落在新页顶端。
    assert seen[1] == pytest.approx(li_gap + long_height)
    # 反向确认：旧实现的两行常量对长样本是不够的。
    assert line_height * 2 < long_height


@needs_font
def test_a_bullet_taller_than_a_page_skips_the_reservation():
    """单条 li 高于一页时**不预留整条**（直接交给 `multi_cell` 劈开），只留一行。

    无条件预留会让 `ensure_space` 每一轮都发现放不下——这正是死循环 / 整页空白的来源。
    但仍要预留**一行**：符号是单独一次 `cell` 画的，不跟着正文流走，页底不足一行时圆点会
    孤零零留在上一页。预留一行既不会死循环（远小于一页），也保证"圆点 + 首行"同页。
    """
    pdf = _pdf_with_font()
    layout = pdf.layout
    base = 14.0
    height_hint = layout.usable_height_per_page - 2 * pdf.line_advance(base)

    seen = _record_ensure_space(pdf)
    huge = _filler(6000)  # 远超一页（classic 标准字号下一行约 49 字）
    pdf.bullets([huge], base)

    assert seen == pytest.approx([pdf.line_advance(base)]), (
        f"单条高于一页时只该预留一行（符号与首行同页），实际预留了 {seen}"
    )
    # 反证：它确实比"可用高度"高，否则上面那条断言是空转。
    _, width, _ = _bullet_box(pdf, base)
    measured = float(
        pdf.multi_cell(
            width,
            pdf.line_advance(base),
            f"{_BULLET}{huge}",
            dry_run=True,
            output="HEIGHT",
        )
    )
    assert measured > height_hint


_ENTRY_TITLE = "某公司 · 工程师"
# 折成多行用的长 li。classic 正文宽 176.7mm ≈ 47 字/行、split 半栏 77mm ≈ 20 字/行，
# 130 字在两个模板下都能稳定折成 3 行以上。
_LONG_BULLET = (
    "负责订单查询服务的重构与稳定性治理，把单体接口拆成三个可以按流量独立扩容的服务，"
    "P99 延迟从两百四十毫秒降到六十二毫秒，机器成本同时下降百分之十八，"
    "并把重复下单类线上事故压到零，相关方案随后被复用到了支付回调链路上。"
)


def _resume_with_one_bullet(text: str) -> ResumeContent:
    """只含一条 li 的简历：PDF 里除页头/区块标题/条目头之外，就只有这一条列表项。"""
    return ResumeContent(
        name="张三",
        experience=[
            ResumeExperience(
                company="某公司",
                role="工程师",
                start_date="2023-01",
                end_date="至今",
                description=[text],
            )
        ],
    )


def _bullet_runs(content: bytes) -> tuple[list, list]:
    """把 PDF 里那条 li 的「符号 run」与「正文 run」分开返回。

    以条目头的 y 为分界（PDF 坐标原点在左下角，条目头下方的 run 的 y 更小）：符号现在是
    **单独一次 `cell`** 画的，所以它在文字流里也是一个独立的 run（文本就是「·」）。
    """
    runs = _text_runs(content)
    entry = [run for run in runs if run[3].strip() == _ENTRY_TITLE]
    assert entry, f"PDF 里没读到条目头：{runs}"
    below = [run for run in runs if run[1] < entry[0][1] - 1]
    marker = [run for run in below if run[3].strip() == _BULLET.strip()]
    lines = [run for run in below if run[3].strip() != _BULLET.strip()]
    return marker, lines


@needs_font
@pytest.mark.parametrize(("template", "indent_ratio"), [("classic", 1.43), ("split", 1.25)])
def test_list_text_starts_at_the_template_indent(template: str, indent_ratio: float):
    """列表**正文**的起点 x = `frame_left` + `ul{padding-left}` × 字号（±0.1mm）。

    缩进此前在 PDF 里写死 3.0mm（与字号无关），而模板是
    `ul { padding-left: calc(var(--fs) * N) }`：classic 1.43（14px → 5.30mm）、split 1.25
    （→ 4.63mm）。行宽因此比草稿宽 1.6~2.3mm，窄栏里少折一行——split 比草稿矮 9.2mm、
    单栏 A_default 矮 3.0mm 主要都来自这一项。
    """
    marker, lines = _bullet_runs(
        build_resume_pdf(
            _resume_with_one_bullet("只有一行。"), template=template, page_limit=1
        ).content
    )
    assert len(lines) == 1, f"样本应当只有一行正文：{lines}"
    assert marker, "符号没有单独画出来（它必须是一个独立的 run）"
    layout = _layout_of(template)
    probe = _pdf_with_font()
    # 只有一个分区时它落在左栏；两个模板的左沿都是页边距（split 的左栏就是整页正文的左沿）。
    # 再加 fpdf2 在每个单元格内部留的那 1mm 内边距（`c_margin`）：页头 / 区块标题 / 正文段落
    # 全都有这 1mm，是**全局既有偏移**，不是列表缩进的偏差——所以这里显式加回去，
    # 而不是在 `bullets()` 里对列表单独补偿（那会让列表比同段正文左移 1mm）。
    expected = layout.margin_x + indent_ratio * layout.base_px * _PX_TO_MM + float(probe.c_margin)
    assert lines[0][0] / _MM_TO_PT == pytest.approx(expected, abs=0.1)
    # 符号在正文左侧的留白里（`list-style-position: outside`），不占正文的行宽。
    assert marker[0][0] < lines[0][0]


@needs_font
@pytest.mark.parametrize("template", ["classic", "split"])
def test_every_wrapped_line_of_a_bullet_starts_at_the_indent(template: str):
    """同一条 li 折成多行时，**每一行**正文的 x 都等于 `frame_left + li_indent × 字号`。

    这是"符号单独画一次"要守住的那条线：符号拼进同一个 `multi_cell` 时只能做到**首行**对齐
    （整块左移一个符号宽，续行跟着左移），而 CSS 的 `li` 是所有行都对齐内容盒左沿。顺带
    也钉住另一个副作用：fpdf2 的 WORD 断行会把「· 」当成一个词，正文贴着行宽时会留下一整行
    只有圆点的怪行——符号独立之后不可能再出现。
    """
    marker, lines = _bullet_runs(
        build_resume_pdf(
            _resume_with_one_bullet(_LONG_BULLET), template=template, page_limit=1
        ).content
    )
    assert len(marker) == 1, f"符号不该跟着折行重复或独占一行：{marker}"
    assert len(lines) >= 3, f"样本没有折成多行，测不出续行：{[run[3] for run in lines]}"
    xs = {round(run[0], 2) for run in lines}
    assert len(xs) == 1, f"续行缩回去了（各行的 x）：{[(run[0], run[1]) for run in lines]}"
    # 符号与**首行**同一个 y（同一行盒），且落在正文左侧：拼进 `multi_cell` 的旧写法会在
    # 正文贴着行宽时把整段挤到下一行，留下一整行只有圆点。
    assert marker[0][1] == pytest.approx(lines[0][1], abs=0.5)
    assert marker[0][0] < lines[0][0]

    layout = _layout_of(template)
    expected = (
        layout.margin_x
        + layout.li_indent * layout.base_px * _PX_TO_MM
        + float(_pdf_with_font().c_margin)
    )
    assert lines[0][0] / _MM_TO_PT == pytest.approx(expected, abs=0.1)


def _layout_of(template: str):
    """某模板在标准字号下的版式（`li_indent` 等期望值的来源）。"""
    return resolve_layout(template=template, base_px=14.0, format_config=None)


@needs_font
def test_section_title_reserves_one_body_line_after_itself():
    """区块标题之后至少再留**一行正文**（草稿的 `.section-title { break-after: avoid }`）。

    只留标题自身高度时，标题可以落在页底、正文全在下一页——读者看到的是一个"空标题"。
    classic 的 `section_title_style` 是 `left_bar`，块高就是标题行高，所以期望值可以直接
    写成"前导间距 + 标题行高 + 标题下间距 + 一行正文"。
    """
    pdf = _pdf_with_font()
    layout = pdf.layout
    base = 14.0
    assert layout.section_title_style == "left_bar", "classic 的块高不再是纯标题行高，请重算期望值"

    seen = _record_ensure_space(pdf)
    pdf.section_title("教育经历", base, leading_gap=layout.header_gap)

    expected = (
        layout.gap_mm(layout.header_gap)  # 标题之前的留白（页头 margin-bottom）
        + pdf.line_advance(base * layout.section_title_ratio)  # 标题块自身
        + layout.gap_mm(layout.section_title_gap)  # 标题与正文之间
        + pdf.line_advance(base)  # 至少一行正文（B3）
    )
    assert seen == pytest.approx([expected])
    # 没有这一行时就是旧行为——差值必须正好是一行正文。
    without_body_line = expected - pdf.line_advance(base)
    assert seen[0] - without_body_line == pytest.approx(pdf.line_advance(base))


@needs_font
def test_entry_head_reserves_one_body_line_after_itself():
    """条目头之后至少再留**一行正文**，否则条目头会和它的正文分处两页。

    注意这里预留的是 `标题行高 + 一行正文`，而旧实现是 `标题行高 × 2`。因为 8 个模板的
    `entry_title_ratio` 都 ≥ 1，两者**数值上接近或旧值略大**（classic 1.07、
    compact 恰好 1.0）——本条用例钉的是公式的语义，不是"预留变多"。真正会让条目被劈开的
    是 `bullets()`（见上面的用例），这里只是把口径写清楚。
    """
    pdf = _pdf_with_font()
    layout = pdf.layout
    base = 14.0
    title_size = base * layout.entry_title_ratio

    seen = _record_ensure_space(pdf)
    pdf.entry_head("某某科技有限公司", "2023-03 - 至今", base)

    assert seen == pytest.approx([pdf.line_advance(title_size) + pdf.line_advance(base)])
