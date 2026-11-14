# SPDX-License-Identifier: Apache-2.0
"""字段标签（field_label）与字段值是两个角色：标签可单独设样式/隐藏，值必须不受影响。

守两类事故：隐藏标签时把值一起藏了；标签样式漏到值上（PDF / Word 各验一遍）。
顺带钉住"标签隐藏后不留一个孤零零的冒号"。
"""

from io import BytesIO

import pytest
from app.schemas.resume_document import ResumeDocument
from app.services.docx_exporter import build_resume_docx
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.document_plan import build_document_plan
from app.services.resume.resume_style_schema import validate_roles_domain
from docx import Document
from tests.test_resume_field_style_exports import runs_from_pdf


def document(*, shown=True, placement="body", bullet=False):
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {
            "items": [
                {
                    "id": "ob_intent001",
                    "key": "job_intent",
                    "value": "IntentValue",
                    "placement": "subtitle",
                    "show_label": shown,
                },
            ],
        },
        "sections": [
            {
                "key": "projects",
                "title": "Projects",
                "kind": "entries",
                "entries": [
                    {
                        "id": "ob_entry0001",
                        "items": [
                            {
                                "kind": "field",
                                "id": "ob_field0001",
                                "key": "custom_label",
                                "label": "FieldLabel",
                                "value": "FieldValue",
                                "show_label": shown,
                                "placement": placement,
                                "body_style": "bullet" if bullet else "paragraph",
                            }
                        ],
                    }
                ],
            }
        ],
    }


CONFIG = {
    "roles": {
        "field_label": {
            "color": "#123456",
            "bold": True,
            "font_scale": 1.1,
            "letter_spacing": 0.03,
        }
    }
}


def test_label_role_validates_its_four_inline_properties():
    assert validate_roles_domain(CONFIG["roles"]) == {"version": 1, **CONFIG["roles"]}


def test_header_label_can_be_hidden_without_hiding_value_or_leaving_colon():
    plan = build_document_plan(ResumeDocument.model_validate(document(shown=False)))
    assert "".join(seg.text for seg in plan.header.subtitle) == "IntentValue"
    assert all(seg.role != "field_label" for seg in plan.header.subtitle)


def test_labels_have_own_role_and_target_while_values_keep_existing_role():
    plan = build_document_plan(ResumeDocument.model_validate(document()))
    assert plan.header.subtitle[0].role == "field_label"
    label, value = plan.sections[0].entries[0].body[0].segments
    assert (label.role, value.role) == ("field_label", "body")
    assert label.path == value.path == "projects.ob_entry0001.ob_field0001"


def test_hidden_labels_leave_no_colon_in_word_and_pdf():
    data = document(shown=False)
    word = Document(BytesIO(build_resume_docx(data, format_config=CONFIG).content))
    text = "".join(p.text for p in word.paragraphs)
    assert "IntentValue" in text and "FieldValue" in text
    assert "：" not in text and "FieldLabel" not in text
    if font_available():
        runs = runs_from_pdf(build_resume_pdf(data, format_config=CONFIG).content)
        text = "".join(value for value, _color, _y in runs)
        assert "IntentValue" in text and "FieldValue" in text
        assert "：" not in text and "FieldLabel" not in text


@pytest.mark.parametrize("placement", ["body", "lead", "trail"])
@pytest.mark.parametrize("bullet", [False, True])
def test_word_label_style_never_leaks_into_its_value(placement, bullet):
    content = build_resume_docx(
        document(placement=placement, bullet=bullet), format_config=CONFIG
    ).content
    word = Document(BytesIO(content))
    paragraphs = [
        *word.paragraphs,
        *(
            p
            for table in word.tables
            for row in table.rows
            for cell in row.cells
            for p in cell.paragraphs
        ),
    ]
    runs = [run for p in paragraphs for run in p.runs]
    for label, value in [("求职意向：", "IntentValue"), ("FieldLabel：", "FieldValue")]:
        label_run = next(run for run in runs if label in run.text)
        value_run = next(run for run in runs if value in run.text)
        assert str(label_run.font.color.rgb) == "123456"
        assert label_run.bold is True
        assert str(value_run.font.color.rgb) != "123456"
        assert label not in value_run.text


@pytest.mark.skipif(not font_available(), reason="No configured CJK font")
@pytest.mark.parametrize("placement", ["body", "lead", "trail"])
@pytest.mark.parametrize("bullet", [False, True])
def test_pdf_label_style_never_leaks_into_its_value(placement, bullet):
    content = build_resume_pdf(
        document(placement=placement, bullet=bullet), format_config=CONFIG
    ).content
    runs = runs_from_pdf(content)
    text = "".join(value for value, _color, _y in runs)
    colors = [color for value, color, _y in runs for _char in value]
    blue = tuple(component / 255 for component in (0x12, 0x34, 0x56))
    for label, value in [("求职意向：", "IntentValue"), ("FieldLabel：", "FieldValue")]:
        start = text.index(label)
        for color in colors[start : start + len(label)]:
            assert color == pytest.approx(blue, abs=0.001)
        start = text.index(value)
        assert all(
            color != pytest.approx(blue, abs=0.001) for color in colors[start : start + len(value)]
        )
