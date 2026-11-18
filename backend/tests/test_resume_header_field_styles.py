# SPDX-License-Identifier: Apache-2.0
"""QW-6：页眉字段（字段名 / 字段值）的逐字段样式在四个出口的行为。

三条断言对应三种事故：

1. 白名单漏了 `header.{id}` → 保存时样式被静默剪掉（面板显示"已调整"、纸面没变）；
2. 拆段只改 HTML → PDF/Word 仍按整串画，导出与预览不一致；
3. 没有字段覆盖时 PDF/Word 换了绘制路径 → 存量简历的导出产物发生无意义变化。
"""

from app.services.docx_document_parts import _has_header_field_style as docx_has_field_style
from app.services.pdf_exporter.header import _has_header_field_style as pdf_has_field_style
from app.services.resume.document_plan import build_document_plan
from app.services.resume.resume_contact import contact_field_texts
from app.services.resume.resume_style import resolve_style

HEADER_ID = "hd_00000001"
HEADER_PATH = f"header.{HEADER_ID}"


def _header_plan():
    document = {
        "version": 2,
        "language": "zh-CN",
        "header": {
            "items": [
                {
                    "kind": "field",
                    "id": HEADER_ID,
                    "key": "phone",
                    "value": "13800000000",
                    "placement": "contact",
                    "label_mode": "show",
                }
            ]
        },
        "sections": [],
    }
    return build_document_plan(document).header


def _query(format_config: dict):
    style = resolve_style(template="classic", format_config=format_config)
    return lambda role, object_id=None: style.effective(role, object_id=object_id)


def test_label_and_value_merge_back_into_one_contact_field():
    """装行与分隔的最小单元仍是"字段"：标签段 + 值段拼回一整串。"""
    line = _header_plan().contact_lines[0]
    assert contact_field_texts(line) == ["电话：13800000000"]


def test_role_level_style_keeps_the_byte_identical_pdf_and_word_path():
    """只在角色层调（meta）时，PDF/Word 继续走整行绘制——存量产物零变化。"""
    query = _query({"roles": {"version": 1, "meta": {"color": "#333333"}}})
    plan = _header_plan()
    assert pdf_has_field_style(plan, query) is False
    assert docx_has_field_style(plan, query) is False


def test_header_field_style_switches_pdf_and_word_to_segment_rendering():
    """字段级覆盖（标签段加粗）时，两个导出都必须按段渲染，否则标签样式会被丢掉。"""
    query = _query({"object_roles": {"version": 1, f"{HEADER_PATH}:field_label": {"bold": True}}})
    plan = _header_plan()
    assert pdf_has_field_style(plan, query) is True
    assert docx_has_field_style(plan, query) is True
