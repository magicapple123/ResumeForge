# SPDX-License-Identifier: Apache-2.0
"""字段级颜色/段距在真实 PDF 与 Word 产物里只作用于目标字段。

为什么要读真实产物：字段级覆盖最容易在"投影"这一步漏掉某个出口（HTML 对了、PDF 没生效），
或者反过来漏到兄弟字段上。这里解析真实 docx/PDF 的段落属性与颜色，断言"目标变了、
邻居没变、条目继承还在"。
"""

from io import BytesIO

import pytest
from app.services.docx_exporter import build_resume_docx
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.resume_style import resolve_style
from docx import Document
from pypdf import PdfReader

ENTRY = "ob_entry0001"
IDS = [
    "ob_title0001",
    "ob_title0002",
    "ob_body00001",
    "ob_body00002",
    "ob_meta00001",
    "ob_meta00002",
]
VALUES = ["FirstTitle", "SecondTitle", "ScopeFirst", "ScopeSecond", "MetaFirst", "MetaSecond"]
PATHS = [f"projects.{ENTRY}.{ident}" for ident in IDS]


def document(*, bullet=False, flow=False):
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {"items": []},
        "sections": [
            {
                "key": "projects",
                "title": "Projects",
                "kind": "entries",
                "layout": {"lead": {"columns": 2, "align": "flow" if flow else "equal"}},
                "entries": [
                    {
                        "id": ENTRY,
                        "items": [
                            {
                                "kind": "field",
                                "id": ident,
                                "key": f"custom{index}",
                                "label": "",
                                "value": value,
                                "show_label": False,
                                "placement": ["title", "title", "body", "body", "lead", "lead"][
                                    index
                                ],
                                "body_style": "bullet" if bullet else "paragraph",
                            }
                            for index, (ident, value) in enumerate(zip(IDS, VALUES, strict=True))
                        ],
                    }
                ],
            }
        ],
    }


def config():
    return {
        "object_roles": {
            f"{PATHS[index]}:{role}": {"color": "#ff0000", "space_before": 6 / 14}
            for index, role in [(0, "entry_title"), (2, "body"), (4, "meta")]
        }
    }


def runs_from_pdf(data):
    result = []
    color = (0, 0, 0)

    def operand(op, args, _cm, _tm):
        nonlocal color
        if op == b"rg":
            color = tuple(float(arg) for arg in args)

    def text(value, _cm, matrix, _font, _size):
        if value.strip():
            result.append((value.strip(), color, float(matrix[5])))

    for page in PdfReader(BytesIO(data)).pages:
        page.extract_text(visitor_operand_before=operand, visitor_text=text)
    return result


@pytest.mark.skipif(not font_available(), reason="No configured CJK font")
@pytest.mark.parametrize("bullet", [False, True])
@pytest.mark.parametrize("flow", [False, True])
def test_pdf_exact_field_colors_and_sibling_isolation(bullet, flow):
    result = build_resume_pdf(
        document(bullet=bullet, flow=flow), format_config=config(), page_limit=2
    )
    runs = runs_from_pdf(result.content)
    text = "".join(text for text, _color, _y in runs)
    colors = [color for text, color, _y in runs for _char in text]
    for index, value in enumerate(VALUES):
        start = text.index(value)
        actual = colors[start : start + len(value)]
        assert all((color == (1.0, 0.0, 0.0)) is (index % 2 == 0) for color in actual)


@pytest.mark.skipif(not font_available(), reason="No configured CJK font")
def test_pdf_field_spacing_applies_to_target_block_only():
    baseline = runs_from_pdf(build_resume_pdf(document(), format_config={}, page_limit=2).content)
    spaced = runs_from_pdf(
        build_resume_pdf(
            document(),
            format_config={"object_roles": {f"{PATHS[2]}:body": {"space_before": 6 / 14}}},
            page_limit=2,
        ).content
    )

    def y_for(runs, value):
        return next(y for text, _color, y in runs if value in text)

    baseline_first = y_for(baseline, "ScopeFirst")
    baseline_second = y_for(baseline, "ScopeSecond")
    spaced_first = y_for(spaced, "ScopeFirst")
    spaced_second = y_for(spaced, "ScopeSecond")
    expected_pt = 6 * 0.75
    assert baseline_first - spaced_first == pytest.approx(expected_pt, abs=0.02)
    assert baseline_second - spaced_second == pytest.approx(expected_pt, abs=0.02)
    assert spaced_first - spaced_second == pytest.approx(baseline_first - baseline_second, abs=0.02)


@pytest.mark.parametrize("bullet", [False, True])
@pytest.mark.parametrize("flow", [False, True])
def test_word_exact_field_colors_and_paragraph_spacing(bullet, flow):
    result = build_resume_docx(
        document(bullet=bullet, flow=flow), format_config=config(), page_limit=2
    )
    doc = Document(BytesIO(result.content))
    paragraphs = [
        *doc.paragraphs,
        *(
            p
            for table in doc.tables
            for row in table.rows
            for cell in row.cells
            for p in cell.paragraphs
        ),
    ]
    for index, value in enumerate(VALUES):
        run = next(run for p in paragraphs for run in p.runs if value in run.text)
        assert (str(run.font.color.rgb) == "FF0000") is (index % 2 == 0)
    first = next(p for p in paragraphs if "ScopeFirst" in p.text)
    second = next(p for p in paragraphs if "ScopeSecond" in p.text)
    assert first.paragraph_format.space_before.pt == pytest.approx(4.5, abs=0.03)
    assert not second.paragraph_format.space_before


def test_field_style_queries_preserve_entry_inheritance():
    style = resolve_style(
        template="classic", format_config={"objects": {ENTRY: {"color": "#123456"}}}
    )
    assert style.effective("body", object_id=PATHS[2]) == style.effective("body", object_id=ENTRY)
