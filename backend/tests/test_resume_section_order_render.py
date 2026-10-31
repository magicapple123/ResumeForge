# SPDX-License-Identifier: Apache-2.0
"""分区顺序落到四个渲染器：HTML / Markdown+TXT / Word / PDF（从 test_resume_section_order 拆出）。

拆出原因：主文件到 500 行测试文件预算。主文件管"顺序定义与归一化"（纯函数 + 资料顺序物化），
本文件只回答"同一份顺序是否真的被四个出口照做"——顺序一旦在某个渲染器里写死，用户拖好的
顺序就只在预览生效，导出还是老顺序（不报错，但用户会发现"导出的和看到的不一样"）。
"""

from __future__ import annotations

import io
import re

from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_markdown, render_html
from app.services.txt_exporter import export_txt
from test_resume_section_order import (
    CUSTOM_CONFIG,
    CUSTOM_ORDER,
    _assert_follows_order,
    _sample_resume,
)
from tests.document_test_support import as_document, item_path


def test_html_preview_follows_the_custom_order():
    # 先按自定义顺序转换一次，再用**同一份文档**渲染：路径里的对象 id 才能对上。
    document = as_document(_sample_resume(), format_config=CUSTOM_CONFIG)
    html = render_html(document, format_config=CUSTOM_CONFIG)
    _assert_follows_order({"html": html})
    # data-resume-path 是「点击纸面字段定位编辑」的锚点（v2：section.entry_id.item_id），重排不能动它。
    for section, field_key in (
        ("projects", "name"),
        ("experience", "company"),
        ("education", "school"),
    ):
        path = item_path(document, section, field_key)
        assert f'data-resume-path="{path}"' in html, path


def test_markdown_and_txt_follow_the_custom_order():
    order = CUSTOM_ORDER
    # v2：分区顺序在文档 sections 里，由 converter 从 format_config.section_order 迁入；
    # export_markdown/export_txt 的 section_order 形参仅为兼容旧调用方保留。
    format_config = {"section_order": order}
    markdown = export_markdown(_sample_resume(), format_config=format_config)
    plain = export_txt(_sample_resume(), format_config=format_config)
    _assert_follows_order({"markdown": markdown, "txt": plain})
    # txt 是从 markdown 剥出来的，两者天然同源。
    marker = re.compile(r"[#*\x60\-\s]")
    assert marker.sub("", markdown) == marker.sub("", plain)


def test_word_document_follows_the_custom_order():
    from docx import Document

    document = build_resume_docx(_sample_resume(), format_config=CUSTOM_CONFIG)
    doc = Document(io.BytesIO(document.content))
    _assert_follows_order({"docx": "\n".join(p.text for p in doc.paragraphs)})


def test_pdf_renders_with_the_custom_order_without_changing_page_count_semantics():
    """服务端 PDF 用同一份顺序渲染；这里只验证它不报错、仍是合法 PDF。

    PDF 的分区顺序藏在绘制调用里，抽文本会受字体子集化影响，所以不在字节层面断言顺序
    （HTML / Word / Markdown 三处已经钉住了同一个顺序定义）。这里要守住的是：
    带顺序渲染不会让「一页适配」的决策与渲染分家。
    """
    from app.services.pdf_exporter import (
        build_resume_pdf,
        measure_content_height,
        resolve_layout,
    )
    from app.services.resume.resume_templates import validated_format_config

    overrides = validated_format_config(CUSTOM_CONFIG)
    layout = resolve_layout(template="classic", base_px=14, format_config=overrides)
    document = build_resume_pdf(_sample_resume(), format_config=CUSTOM_CONFIG)
    assert document.content.startswith(b"%PDF-")
    assert document.pages >= 1
    height = measure_content_height(
        _sample_resume(), accent=(22, 54, 92), layout=layout, format_config=overrides
    )
    assert height > 0


def test_section_order_survives_template_validation():
    """格式模板校验要保留 section_order，而不是把它当成未知键丢掉。"""
    from app.services.resume.resume_templates import validated_format_config

    validated = validated_format_config(CUSTOM_CONFIG)
    assert validated["section_order"] == CUSTOM_ORDER
    # 没给就不出现：让「没设过」与「设成默认」可以区分。
    assert "section_order" not in validated_format_config({"accent": "#16365c"})
    # 非法输入（空列表 / 字符串以外的东西）不会炸掉整份配置。
    assert "section_order" not in validated_format_config({"section_order": []})
    assert "section_order" not in validated_format_config({"section_order": "projects"})
