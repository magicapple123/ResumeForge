# SPDX-License-Identifier: Apache-2.0
"""双栏正文（``column_count == 2``）的版式守卫，外加两个标签排版开关的注册表核对。

**为什么要有这个文件**：草稿侧的 `split` 模板把七个分区包进一个两栏网格
（`_resume_sections.j2` 的 ``<div class="resume-sections" data-columns="2">``），分区**两两
一行**并排；而 PDF 侧此前完全没有分栏，七个分区顺序单栏排下来。同一份简历实测：草稿
227.5mm / 1 页，PDF 270.75mm / 1 页——页数一致，版式不同。这个文件把"并排"这件事的
每一条语义都钉住，因为分栏错了**不会报错**，只会让整份简历悄悄变高或变矮：

1. **并排而不是顺序**：同一行的两个分区标题必须落在**同一 y、不同 x**；
2. **行高取两格较高者**（草稿 ``align-items: start`` + 网格行高 = max）：下一行的起点
   必须等于行首 + 两者较大者，少了这条，较矮的那格会让下一行提前开始、两栏错位；
3. **落单的最后一格只占左列**（奇数个分区时右列留空）；
4. **空分区不占格位**：草稿里空分区不产生节点（`campus_block` 什么都不输出），若 PDF 按
   "七个键全在"配对，`项目经历` 会和空格子并排、`专业技能`/`荣誉奖项` 被拆到两行，
   整份简历凭空高出 40mm；
5. **单分区高于一页时降级为顺序渲染**，且内容一个字都不能丢（pypdf 逐页核对）；
6. **单栏模板不碰列框**（`set_frame` 一次都不该被调用）；
7. **注册表 ↔ 模板 CSS**：`column_count` / `column_gap` / `tag_align` / `tag_mono` 逐模板核对，
   CSS 解析 helper 沿用 `tests/test_resume_layout_templates.py`。

前半段的单元用例用**假 drawer**（直接推进 y 的桩）驱动 `columns.render_sections`，这样行高
是精确已知的；后半段用真渲染 + pypdf 读回坐标做端到端断言。
"""

from __future__ import annotations

import re
from io import BytesIO

import pytest
from app.schemas.resume import (
    ResumeContent,
    ResumeEducation,
    ResumeExperience,
    ResumeProject,
)
from app.services.pdf_exporter import (
    _resolve_font_paths,
    _ResumePDF,
    build_resume_pdf,
    columns,
    resolve_layout,
)
from app.services.pdf_exporter.fonts import FONT_FAMILY
from app.services.resume.resume_templates import (
    RESUME_TEMPLATES,
    TEMPLATE_LAYOUT_DEFAULTS,
    TEMPLATES_DIR,
)
from pypdf import PdfReader
from test_pdf_exporter import _text_runs, needs_font
from test_resume_layout_templates import _selector_block

_SPLIT = "split"
_BASE_PX = 14.0
# 区块标题在 PDF 里的固定文案（与 `render._draw_resume` 一致），用来在 pypdf 读回的文字里定位。
TITLES = {
    "summary": "个人总结",
    "education": "教育经历",
    "experience": "实习/工作经历",
    "projects": "项目经历",
    "skills": "专业技能",
    "awards": "荣誉奖项",
}


def _layout(template: str = _SPLIT):
    return resolve_layout(template=template, base_px=_BASE_PX, format_config=None)


def _pdf(template: str = _SPLIT, *, measuring: bool = True) -> _ResumePDF:
    """造一个已注册中文字体、用指定模板版式的画布（默认"只量不画"，便于逐条断言 y）。"""
    regular, bold = _resolve_font_paths()
    pdf = _ResumePDF((107, 79, 42), _layout(template), measuring=measuring)
    pdf.add_font(FONT_FAMILY, "", regular)
    pdf.add_font(FONT_FAMILY, "B", bold)
    pdf.add_page()
    return pdf


def _stub_drawer(height: float, *, canvas: _ResumePDF, log: list | None = None, tag: str = ""):
    """一个"高 ``height`` 毫米"的假分区：只推进 y，不画任何东西。

    行高、下一行起点这些断言因此可以精确到 0.01mm——真渲染的高度随字体度量浮动，只能
    断言"大概"。``log`` 只记**正式画布**上的调用：量高那一趟跑在 `measuring_twin()` 的
    孪生画布上（同一个函数、另一个实例），记进来会把每条断言翻倍。
    """

    def draw(pdf: _ResumePDF, leading: float) -> bool:
        if log is not None and pdf is canvas:
            log.append((tag, pdf.frame_left, pdf.frame_width, pdf.get_y()))
        # `leading` 是"× 基准字号"的系数（与 `section_title` 的 `leading_gap` 同口径），
        # 不是毫米——真 drawer 也是交给 `gap_mm()` 换算的。
        pdf.ln(pdf.layout.gap_mm(leading))
        pdf.set_y(pdf.get_y() + height)
        return True

    return draw


def _drawers(spec: dict[str, float], *, canvas: _ResumePDF, log: list | None = None) -> dict:
    return {
        key: _stub_drawer(height, canvas=canvas, log=log, tag=key) for key, height in spec.items()
    }


# ===== 1. 并排而不是顺序 =====


def test_two_sections_of_a_row_start_at_the_same_y_on_different_frames():
    """同一行的两个分区必须在**同一个 y、不同 x** 上开画——这就是"并排"的定义。"""
    seen: list = []
    pdf = _pdf()
    drawers = _drawers({"a": 20.0, "b": 12.0}, canvas=pdf, log=seen)
    columns.render_sections(pdf, ["a", "b"], drawers)

    frames = columns.column_frames(_layout())
    (tag_a, left_a, width_a, y_a), (tag_b, left_b, width_b, y_b) = seen
    assert (tag_a, tag_b) == ("a", "b")
    # 同一行首：两条都从 `margin_top` 起画（`align-items: start` 的等价物）。
    assert y_a == pytest.approx(y_b, abs=0.01)
    assert (left_a, width_a) == pytest.approx(frames[0])
    assert (left_b, width_b) == pytest.approx(frames[1])
    # 右栏严格在左栏右侧，且两栏不重叠。
    assert left_b > left_a + width_a


def test_row_breaks_after_two_sections():
    """两两一行：第 3 个分区必须落到新的一行（y 比第 1 行大）。"""
    seen: list = []
    pdf = _pdf()
    drawers = _drawers({"a": 10.0, "b": 10.0, "c": 10.0}, canvas=pdf, log=seen)
    columns.render_sections(pdf, ["a", "b", "c"], drawers)
    first_row_y = seen[0][3]
    assert [entry[0] for entry in seen] == ["a", "b", "c"]
    assert seen[2][3] > first_row_y


# ===== 2. 行高取两格较高者 =====


def test_the_row_advances_by_the_taller_of_the_two_cells(monkeypatch):
    """左 30mm、右 10mm → 下一行起点 = 行首 + 30mm（而不是 10、也不是 40）。"""
    layout = _layout()
    rows_seen: list[dict] = []
    real_draw_row = columns._draw_row

    def spy(pdf, row, drawers, frames, *, row_height, leading):  # noqa: ANN001 - 与实现同签名
        rows_seen.append({"row": list(row), "height": row_height, "top": pdf.get_y()})
        return real_draw_row(pdf, row, drawers, frames, row_height=row_height, leading=leading)

    monkeypatch.setattr(columns, "_draw_row", spy)
    pdf = _pdf()
    drawers = _drawers({"a": 30.0, "b": 10.0, "c": 5.0}, canvas=pdf)
    columns.render_sections(pdf, ["a", "b", "c"], drawers)

    assert [entry["row"] for entry in rows_seen] == [["a", "b"], ["c"]]
    # 行高 = 前导留白 + 较高那格（假 drawer 的 y 增量同样包含前导留白）。
    assert rows_seen[0]["height"] == pytest.approx(
        30.0 + layout.gap_mm(layout.header_gap), abs=0.01
    )
    assert rows_seen[1]["top"] == pytest.approx(
        rows_seen[0]["top"] + rows_seen[0]["height"], abs=0.01
    )


def test_the_taller_cell_does_not_shift_the_shorter_one():
    """较矮的那格顶部对齐：它自己看到的 y 仍是行首（不是接在别人下面）。"""
    seen: list = []
    pdf = _pdf()
    drawers = _drawers({"tall": 40.0, "short": 4.0}, canvas=pdf, log=seen)
    columns.render_sections(pdf, ["tall", "short"], drawers)
    assert seen[0][3] == pytest.approx(seen[1][3], abs=0.01)


# ===== 3. 落单的最后一格只占左列 =====


def test_a_lone_last_cell_is_drawn_in_the_left_column_only(monkeypatch):
    """奇数个分区时，最后一行只有一个分区，且它必须落在**左**列（右列留空）。"""
    layout = _layout()
    frames = columns.column_frames(layout)
    pdf = _pdf()
    frames_seen: list[tuple[float, float]] = []
    real_set_frame = _ResumePDF.set_frame

    def spy(self, left, width):  # noqa: ANN001 - 与实现同签名
        if self is pdf:  # 只记正式画布（量高那趟跑在孪生画布上）
            frames_seen.append((left, width))
        return real_set_frame(self, left, width)

    monkeypatch.setattr(_ResumePDF, "set_frame", spy)
    columns.render_sections(
        pdf, ["a", "b", "c"], _drawers({"a": 8.0, "b": 8.0, "c": 8.0}, canvas=pdf)
    )

    # 两次并排 + 最后一次落单（只设左列框）。
    assert len(frames_seen) == 3
    assert frames_seen[-1] == pytest.approx(frames[0])


def test_plan_rows_pairs_in_order_and_keeps_a_lone_tail():
    assert columns.plan_rows(["a", "b", "c", "d"]) == [["a", "b"], ["c", "d"]]
    assert columns.plan_rows(["a", "b", "c"]) == [["a", "b"], ["c"]]
    assert columns.plan_rows([]) == []
    # 空键（未设置的分区）不该占格位。
    assert columns.plan_rows(["a", "", "b"]) == [["a", "b"]]


# ===== 4. 空分区不占格位（草稿里它根本不产生节点）=====


@needs_font
def test_an_empty_section_does_not_take_a_grid_cell():
    """没有校园经历时，配对不该出现空洞——第一行仍是 `教育经历` + `实习/工作经历` 并排。

    这正是分栏第一版的真实 bug：按"注册表里七个键"配对，空分区占掉一格，后面全错位，
    同一份简历从 218mm 涨到 314mm。

    默认分区顺序是 教育 → 实习 → 项目 → 技能 → 校园 → 荣誉 → 总结，所以去掉校园之后
    的正确配对是 (教育, 实习) / (项目, 技能) / (荣誉, 总结)：空分区被跳过，后面的格子
    只往前补，不会整行错位。
    """
    resume = _resume(campus=[])
    runs = _text_runs(build_resume_pdf(resume, template=_SPLIT, page_limit=1).content)
    education = _title_run(runs, TITLES["education"])
    experience = _title_run(runs, TITLES["experience"])
    assert experience[1] == pytest.approx(education[1], abs=0.5), "第一行没有并排"
    assert experience[0] > education[0], "两个分区没有并排（x 相同）"

    # 第二行从「项目经历」开始：空分区没有把后面的格子挤错位。
    # 注意 PDF 的 y 轴朝上：下一行的 y **更小**。
    projects = _title_run(runs, TITLES["projects"])
    assert projects[1] < experience[1], "项目经历没有落到第二行"


# ===== 5. 高于一页的分区降级为顺序渲染 =====


def test_a_section_taller_than_a_page_falls_back_to_sequential_rendering(monkeypatch):
    """单分区高于一页时并排没有意义（半栏更窄只会溢出），该行改走整页宽度的顺序渲染。"""
    layout = _layout()
    pdf = _pdf()
    frames_seen: list[tuple[float, float]] = []
    real_set_frame = _ResumePDF.set_frame

    def spy(self, left, width):  # noqa: ANN001
        if self is pdf:
            frames_seen.append((left, width))
        return real_set_frame(self, left, width)

    monkeypatch.setattr(_ResumePDF, "set_frame", spy)
    seen: list = []
    # 比一页还高（usable = 297 − 2×12 = 273mm）。
    drawers = _drawers(
        {"huge": layout.usable_height_per_page + 60.0, "small": 10.0}, canvas=pdf, log=seen
    )
    columns.render_sections(pdf, ["huge", "small"], drawers)

    assert frames_seen == [], "降级路径不该用列框（那是双栏才有的东西）"
    assert [entry[0] for entry in seen] == ["huge", "small"]
    # 顺序渲染：两者都拿整页正文宽度，且第二个接在第一个下面（不是同一个 y）。
    assert all(entry[2] == pytest.approx(layout.usable_width_mm) for entry in seen)
    assert seen[1][3] > seen[0][3]


@needs_font
def test_the_fallback_keeps_every_line_of_a_tall_section():
    """降级之后内容必须**一字不少**，而且整份简历仍然排得下（这正是降级的意义）。"""
    marks = [f"第{index:02d}条标记" for index in range(1, 19)]
    resume = ResumeContent(
        name="张三",
        summary="一句话总结。",
        experience=[
            ResumeExperience(
                company="某公司",
                role="工程师",
                start_date="2023-01",
                end_date="至今",
                description=[
                    f"{mark}：负责后端服务的设计与开发，保证接口稳定与性能达标。" for mark in marks
                ],
            )
        ],
    )
    built = build_resume_pdf(resume, template=_SPLIT, page_limit=1)
    text = _all_text(built.content)
    missing = [mark for mark in marks if mark not in text]
    assert not missing, f"降级渲染丢了内容：{missing}"
    assert built.pages == 1, "降级之后仍然应该排得进一页"


# ===== 6. 单栏模板不碰列框 =====


@needs_font
def test_single_column_templates_never_narrow_the_frame(monkeypatch):
    """7 个单栏模板：`column_count == 1`，且渲染时 `set_frame` 一次都不该被调用。"""
    calls: list[tuple[float, float]] = []
    real_set_frame = _ResumePDF.set_frame

    def spy(self, left, width):  # noqa: ANN001
        calls.append((left, width))
        return real_set_frame(self, left, width)

    monkeypatch.setattr(_ResumePDF, "set_frame", spy)
    for name in RESUME_TEMPLATES:
        expected = 2 if name == _SPLIT else 1
        assert (
            resolve_layout(template=name, base_px=_BASE_PX, format_config=None).column_count
            == expected
        ), name
        if name == _SPLIT:
            continue
        calls.clear()
        build_resume_pdf(_resume(), template=name, page_limit=1)
        assert calls == [], f"{name} 是单栏模板，不该收窄列框：{calls}"


# ===== 7. 注册表 ↔ 模板 CSS =====


def test_registry_matches_the_template_css_for_columns_and_tag_flags():
    """`column_count` / `column_gap` / `tag_align` / `tag_mono` 必须与模板 CSS 一致。

    期望值一律从注册表读、拿模板 CSS 反推后比对——不在这里再抄一份取值，否则就成了
    "跟自己比"。这几个键决定"分不分栏""栏多宽""标签居不居中""用不用等宽"，模板改了而
    注册表没跟上，PDF 与预览又会各排各的。
    """
    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        defaults = TEMPLATE_LAYOUT_DEFAULTS[name]

        # 分栏：只有写了 `.resume-sections` 网格的模板才是两栏。
        grid = re.search(r"\.resume-sections\s*\{([^}]*)\}", css)
        columns_decl = grid.group(1) if grid else ""
        two_columns = bool(
            re.search(r"grid-template-columns:\s*minmax\(0,\s*\.9fr\)", columns_decl)
        )
        assert (2 if two_columns else 1) == defaults["column_count"], name
        gap = re.search(r"column-gap:\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)\)", columns_decl)
        assert (float(gap.group(1)) if gap else 0.0) == defaults["column_gap"], name

        # 标签整段居中：`.skill-list { text-align: center }`。
        skill_list = _selector_block(css, ".skill-list")
        assert ("center" if "text-align: center" in skill_list else "left") == defaults[
            "tag_align"
        ], name

        # 标签等宽字族：`.skill-list li { font-family: ... monospace }`。
        tag_item = _selector_block(css, ".skill-list li")
        assert ("monospace" in tag_item) == defaults["tag_mono"], name


# ===== 辅助 =====


def _resume(*, campus: list | None = None) -> ResumeContent:
    """一份"四个分区都有内容"的小简历（默认没有校园经历，与技术说明里的实测样本同形）。"""
    return ResumeContent(
        name="陈亦然",
        gender="女",
        phone="138-0000-0000",
        email="chenyiran@example.com",
        city="上海",
        job_intent="后端开发工程师",
        summary="三年 Python 后端经验，主导过订单服务重构，平均响应时间从 240ms 压到 62ms。",
        education=[
            ResumeEducation(
                school="华东师范大学",
                major="软件工程",
                degree="本科",
                start_date="2017-09",
                end_date="2021-06",
                gpa="3.7/4.0",
                courses=["数据结构", "数据库系统"],
                achievements=["连续三年获校级一等奖学金"],
            )
        ],
        experience=[
            ResumeExperience(
                company="上海携程商务有限公司",
                role="后端开发工程师",
                start_date="2023-03",
                end_date="至今",
                description=["主导订单查询服务重构，P99 延迟从 240ms 降到 62ms。"],
            )
        ],
        campus_experience=list(campus or []),
        projects=[
            ResumeProject(
                name="分布式任务调度平台",
                role="核心开发",
                start_date="2022-03",
                end_date="2022-11",
                tech_stack=["Python", "Redis"],
                description=["从零实现基于租约的任务抢占与故障转移。"],
            )
        ],
    )


def _title_run(runs: list[tuple[float, float, float, str]], title: str) -> tuple[float, float, str]:
    """在 pypdf 读回的文字块里找出某个区块标题的 ``(x, y, 文本)``。"""
    matched = [run for run in runs if run[3].strip() == title]
    assert matched, f"PDF 里没找到区块标题 {title!r}"
    return matched[0][0], matched[0][1], matched[0][3]


def _all_text(content: bytes) -> str:
    reader = PdfReader(BytesIO(content))
    return "".join(page.extract_text() or "" for page in reader.pages)
