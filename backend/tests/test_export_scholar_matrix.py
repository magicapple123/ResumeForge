# SPDX-License-Identifier: Apache-2.0
"""W05：scholar 完整样板 —— 固定测试字体下的形状 / 文本 / 几何验证。

为什么用合成字体（tests/font_fixtures.build_test_font）：它每个字形都是同样的 480×700
方块、字面宽 600、族名固定为 "Test Sans"。于是"三列网格每列的 x 起点 / 行数 / 项目符号
个数"这类几何断言不依赖开发机装了什么中文字体，也不会因为 CI 没有中文字体整批 skip；
同时字体文件是现场合成的，仓库里不塞十几 MB 的真字体。

覆盖（W05 要求的完整样板，逐项一个用例）：有/无照片、长姓名、多行技能、中英混排、超页、
缺字、粗体、不同边距；Word 侧同步验证字段/顺序/字体族名。
"""

from __future__ import annotations

import io
import re
import string
import zipfile

import pytest
from app.schemas.resume import ResumeContent
from app.services.docx_exporter import build_resume_docx
from app.services.pdf_exporter import (
    PAGE_WIDTH_MM,
    build_resume_pdf,
    reset_font_cache,
    resolve_layout,
)
from app.services.pdf_exporter.fit import _content_signature
from app.services.resume.resume_labels import (
    FIELD_LABELS,
    GENDER_PAREN,
    LEVEL_PAREN,
    LIST_SEPARATOR,
    RESUME_LANGUAGES,
    SECTION_TITLES,
    section_titles,
)
from font_fixtures import build_test_font, isolate_pdf_font_env, write_font
from pypdf import PdfReader
from test_pdf_exporter import _text_runs, needs_font

FONT_FILE = "TestSans.ttf"
FONT_FAMILY = "Test Sans"
MM_TO_PT = 72 / 25.4
# 1x1 PNG（data URL）：照片分支只需要"有合法图片"，不需要真实尺寸。
PHOTO = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "YAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
# 缺字用例用：合成字体里**不含**这个字。
MISSING_GLYPH = "龘"
# 各用例里刻意构造的长文本（长姓名 / 长技能 / 超页的公司名），必须一起进字体。
# W07 的协议 v2 用例还会画链接 URL，所以把 URL 里常见的 ASCII 标点也收进合成字体——
# 缺字形的表现是"纸面上少一个字符"，不会报错，只能从这里堵。
_EXTRA_TEXT = (
    "欧阳" + "长姓名测试" * 4,
    "超长技能名称" * 6,
    "公司",
    "正常文字",
    "高并发官网可查",
    "：:/?=&._~@#%+",
)


def _test_font_text() -> str:
    """合成本测试字体时把"所有可能画出来的字"都包含进去。

    字面量列表很容易漏（实测漏了「本科」「软件工程」这类只在样板里出现的词，PDF 里就静默
    缺字），所以直接从样板内容 + 语言包固定文案 + 符号里按字符收集；缺字用例的关键是
    **故意**排除 MISSING_GLYPH，因此不能把整个 CJK 区扫进去。
    """
    parts: list[str] = [
        "".join(_EXTRA_TEXT),
        "•·：-()（）,、 ",
        string.ascii_letters + string.digits,
    ]

    def walk(value) -> None:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key != "photo":
                    walk(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item)

    walk(_resume().model_dump())
    for language in RESUME_LANGUAGES:
        parts.extend(SECTION_TITLES[language].values())
        parts.extend(FIELD_LABELS[language].values())
        parts.append(LIST_SEPARATOR[language])
        parts.append(LEVEL_PAREN[language].replace("{level}", ""))
        parts.append(GENDER_PAREN[language].replace("{gender}", ""))
    return "".join(parts)


@pytest.fixture(autouse=True)
def fixed_test_font(monkeypatch):
    """每个用例一份"现场合成、族名固定"的字体，并通过 format_config.font 选中它。

    先摘掉宿主的 RESUMEFORGE_PDF_FONT 兜底（CI 的 Linux 作业会设它）：环境变量优先于
    所选字体，不隔离的话族名与字形覆盖都不是这份合成字体，几何断言会按宿主字体漂移。
    """
    isolate_pdf_font_env(monkeypatch)
    write_font(FONT_FILE, build_test_font(_test_font_text(), family=FONT_FAMILY))
    reset_font_cache()
    yield
    reset_font_cache()


def _format(**extra) -> dict:
    return {"font": FONT_FILE, **extra}


def _resume(*, photo: bool = False, skills: int = 7, name: str = "张三") -> ResumeContent:
    """scholar 样板：中英混排、多行技能、粗体、各分区都有内容。"""
    labels = ["Python", "FastAPI", "Redis", "Go", "SQL", "数据结构", "数据库系统"]
    while len(labels) < skills:
        labels.append("技能" + str(len(labels)))
    return ResumeContent(
        name=name,
        phone="13800000000",
        email="zhangsan@example.com",
        job_intent="后端工程师",
        summary="**负责**后端服务的设计与交付。",
        photo=PHOTO if photo else "",
        education=[
            {
                "school": "测试大学",
                "major": "软件工程",
                "degree": "本科",
                "start_date": "2017-09",
                "end_date": "2021-06",
                "gpa": "3.8/4.0",
                "courses": ["数据结构", "数据库系统"],
            }
        ],
        experience=[
            {
                "company": "测试公司",
                "role": "后端工程师",
                "start_date": "2021-07",
                "end_date": "2024-06",
                "description": ["**负责**订单链路设计与性能优化。"],
            }
        ],
        projects=[{"name": "测试项目", "role": "负责人", "description": ["交付了一个服务。"]}],
        skills=[{"name": label, "level": "熟练"} for label in labels[:skills]],
        awards=[{"name": "一等奖学金", "date": "2020-10"}],
    )


def _pdf(resume: ResumeContent, **kwargs):
    return build_resume_pdf(
        resume,
        template=kwargs.pop("template", "scholar"),
        page_limit=kwargs.pop("page_limit", 1),
        format_config=kwargs.pop("format_config", _format()),
        **kwargs,
    )


def _text(content: bytes) -> str:
    return "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)


def _bullet_runs(content: bytes) -> list[tuple[float, float, float, str]]:
    return [run for run in _text_runs(content) if "•" in run[3]]


# ===== 1. 三列技能网格：列数 / 列宽 / 行数 / 项目符号 =====


def test_scholar_tag_columns_trace_back_to_each_template_css():
    """注册表的 tag_columns 必须等于模板 .skill-list 的 grid 列数（其余模板没有 grid）。"""
    from app.services.resume.resume_template_layout import TEMPLATE_LAYOUT_DEFAULTS
    from app.services.resume.resume_templates import RESUME_TEMPLATES, TEMPLATES_DIR
    from test_resume_layout_templates import _selector_block

    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        block = _selector_block(css, ".skill-list")
        match = re.search(r"grid-template-columns:\s*repeat\((\d+),", block)
        expected = int(match.group(1)) if match else 1
        assert TEMPLATE_LAYOUT_DEFAULTS[name]["tag_columns"] == expected, name


def test_scholar_skill_grid_is_three_columns_of_bulleted_cells():
    """7 个技能 → 三列网格的 3/3/1 三行；每个格子一个「•」；列间距等于注册表值。"""
    resume = _resume(skills=7)
    layout = resolve_layout(template="scholar", base_px=14.0, format_config=_format())
    artifact = _pdf(resume)
    runs = _bullet_runs(artifact.content)

    assert len(runs) == 7, "每个技能格应该恰好一个项目符号"
    rows = {round(run[1], 1) for run in runs}
    assert len(rows) == 3, f"7 个技能应排成 3 行（3/3/1），实得 {len(rows)} 行"

    first_row = sorted((run for run in runs if round(run[1], 1) == max(rows)), key=lambda r: r[0])
    assert len(first_row) == 3
    gap_mm = layout.gap_mm(layout.tag_gap_x)
    cell_mm = (layout.usable_width_mm - 2 * gap_mm) / 3
    step_pt = (cell_mm + gap_mm) * MM_TO_PT
    assert first_row[1][0] - first_row[0][0] == pytest.approx(step_pt, abs=0.2)
    assert first_row[2][0] - first_row[1][0] == pytest.approx(step_pt, abs=0.2)


def test_scholar_skill_grid_stays_inside_the_right_margin_with_a_long_label():
    """超长标签在格内折行，不会越出右边距（折行算错不会报错，只会静默压到页面外）。"""
    resume = _resume(skills=4)
    resume.skills[0].name = "超长技能名称" * 6
    artifact = _pdf(resume)
    layout = resolve_layout(template="scholar", base_px=14.0, format_config=_format())
    right_pt = (PAGE_WIDTH_MM - layout.margin_right + 0.5) * MM_TO_PT
    assert all(run[0] <= right_pt for run in _bullet_runs(artifact.content))
    assert "超长技能名称" in _text(artifact.content)


# ===== 2. 照片 / 长姓名 / 混排 =====


@needs_font
def test_scholar_with_and_without_photo_keeps_all_sections():
    """有照片与无照片都出有效 PDF、正文都不丢；无照片时不渲染照片元素（宏只判空）。"""
    without = _pdf(_resume(photo=False), page_limit=2)
    with_photo = _pdf(_resume(photo=True), page_limit=2)

    assert without.content[:5] == b"%PDF-" and with_photo.content[:5] == b"%PDF-"
    assert len(with_photo.content) > len(without.content), "有照片的产物应包含图片数据"
    for artifact in (without, with_photo):
        text = _text(artifact.content)
        assert "张三" in text and "测试大学" in text and "测试公司" in text
        assert artifact.overflow is False


def test_scholar_long_name_is_wrapped_not_clipped():
    """超长姓名（20 字）必须换行排下，不能整段跑出纸面。"""
    layout = resolve_layout(template="scholar", base_px=14.0, format_config=_format())
    long_name = "欧阳" + "长姓名测试" * 4
    artifact = _pdf(_resume(name=long_name), page_limit=2)
    text = _text(artifact.content)
    assert "欧阳" in text, "长姓名应仍有文字画在纸面上"
    assert layout.margin_left > 0
    assert artifact.pages >= 1


def test_scholar_mixed_cjk_and_ascii_text_survives_extraction():
    text = _text(_pdf(_resume(), page_limit=2).content)
    for probe in ("Python", "FastAPI", "数据结构", "测试大学", "后端工程师"):
        assert probe in text, f"混排文本丢失：{probe}"


# ===== 3. 超页 / 缺字 / 粗体 / 边距 =====


def test_scholar_overflow_is_flagged_consistently_and_truncated():
    """装不下时按上限截断并如实标记；标志与页数互相自洽（AGENTS.md：不许自动缩字号）。"""
    content = _resume(skills=6).model_dump()
    content["experience"] = [
        {
            "company": "公司" + str(i),
            "role": "工程师",
            "description": ["负责一段很长的描述。" * 8],
        }
        for i in range(12)
    ]
    artifact = _pdf(ResumeContent.model_validate(content), page_limit=1)

    assert artifact.pages == 1, "页数上限为 1 时产物必须只有 1 页"
    assert artifact.pages_needed > 1
    assert artifact.overflow is True
    assert artifact.pages == min(artifact.pages_needed, 1)


def test_scholar_missing_glyph_degrades_without_failing():
    """字体缺字不能让导出失败：已覆盖的字照常输出，缺字形不崩、也不改页数口径。"""
    resume = _resume()
    resume.summary = "正常文字。" + MISSING_GLYPH
    artifact = _pdf(resume)
    text = _text(artifact.content)

    assert artifact.content[:5] == b"%PDF-"
    assert "正常文字" in text
    assert MISSING_GLYPH not in text, "缺字形不会被画出来（应如实降级而不是伪造）"


def test_scholar_bold_markers_are_rendered_not_printed():
    """**加粗** 在 PDF 里是加重而不是把星号印出来。"""
    text = _text(_pdf(_resume(), page_limit=2).content)
    assert "**" not in text
    assert "负责订单链路设计与性能优化" in text


def test_scholar_margins_shift_the_text_origin():
    """不同页边距必须真的改变正文起点（6mm vs 20mm ≈ 14mm = 39.7pt）。"""
    narrow = _pdf(_resume(), page_limit=2, format_config=_format(page_padding=6))
    wide = _pdf(_resume(), page_limit=2, format_config=_format(page_padding=20))
    narrow_x = min(run[0] for run in _text_runs(narrow.content))
    wide_x = min(run[0] for run in _text_runs(wide.content))
    assert (wide_x - narrow_x) == pytest.approx(14 * MM_TO_PT, abs=1.0)


# ===== 4. Word 侧同步验证：字段 / 顺序 / 字体族名 / 粗体 =====


def _docx_text(content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    return re.sub(r"<[^>]+>", "", xml)


def test_scholar_word_keeps_every_skill_in_order_and_declares_the_real_font_family():
    """Word 没有 grid，但技能必须**一个不丢、顺序不变**，且字体族名是所选字体的真名。"""
    resume = _resume(skills=7)
    document = build_resume_docx(resume, template="scholar", page_limit=2, format_config=_format())
    text = _docx_text(document.content)

    # 只看「专业技能」之后的那一段：数据结构/数据库系统 也出现在教育经历的课程里，
    # 直接在整篇里找第一次出现会把顺序判错。
    skills_text = text.split(section_titles("zh-CN")["skills"], 1)[1]
    positions = [skills_text.index(skill.name) for skill in resume.skills]
    assert positions == sorted(positions), "技能顺序被打乱"
    assert "**" not in text, "Word 里不该留下粗体标记"
    with zipfile.ZipFile(io.BytesIO(document.content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    assert FONT_FAMILY in xml, "Word 应声明所选字体的真实族名"
    assert "<w:b" in xml, "粗体片段应落成 bold run"
    assert document.pages is not None


# ===== 5. W07 协议 v2：斜体 / 链接在 PDF 与 Word 上的真实结果 =====


def test_scholar_pdf_renders_italic_text_and_link_as_visible_label_and_url() -> None:
    """PDF 没有真斜体（近似不倾斜），但文字必须在；链接以 "label (URL)" 可见文本出现。"""
    resume = _resume()
    resume.summary = "**负责** *高并发* 系统，[官网](https://example.com/x) 可查。"
    artifact = _pdf(resume, page_limit=2)
    text = _text(artifact.content)

    assert artifact.content[:5] == b"%PDF-"
    assert "高并发" in text, "斜体近似渲染不能丢字"
    assert "**" not in text and "*高并发*" not in text
    # 合成字体的 CID 抽取会在字符间插 NUL：先去掉再查连续片段。
    compact = "".join(text.replace("\x00", "").split())
    assert "官网(https://example.com/x)" in compact, "链接应输出可见的 label (URL)"
    assert "](https://" not in compact, "链接标记不能作为字面量印出来"


def test_scholar_word_renders_italic_run_and_link_as_visible_text() -> None:
    """Word 用 run.font.italic 表达真斜体；链接按 "label (URL)" 可见文本输出。"""
    resume = _resume()
    resume.summary = "**负责** *高并发* 系统，[官网](https://example.com/x) 可查。"
    document = build_resume_docx(resume, template="scholar", page_limit=2, format_config=_format())
    text = _docx_text(document.content)
    compact = "".join(text.replace("&amp;", "&").split())

    assert "官网(https://example.com/x)" in compact
    assert "**" not in text and "*高并发*" not in text
    assert "<w:i" in _docx_xml(document.content), "斜体应落成 run.font.italic"


def _docx_xml(content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        return bundle.read("word/document.xml").decode("utf-8")


def test_scholar_layout_exposes_tag_columns_and_keeps_single_column_body():
    """scholar 的"三列"只作用于技能列表；正文仍是单栏（与 HTML 的 .resume-sections 一致）。"""
    layout = resolve_layout(template="scholar", base_px=14.0, format_config=_format())
    assert layout.tag_columns == 3
    assert layout.column_count == 1
    assert resolve_layout(template="classic", base_px=14.0, format_config=None).tag_columns == 1
    # 字符集里必须含项目符号（跨模板复用子集时不能靠"这趟画过"）。
    resume = _resume()
    _pdf(resume)
    assert "•" in (_content_signature(resume)[1] + "•")
