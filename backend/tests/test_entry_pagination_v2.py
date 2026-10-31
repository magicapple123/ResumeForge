# SPDX-License-Identifier: Apache-2.0
"""条目级分页（计划 §6.2）：EntryLayout.start_on_new_page / keep_together 的生效与四出口。

数据层：EntryLayout 新增两个布尔（默认 False）；planner 把**条目自己的**开关带进
EntryPlan.layout（分区级「另起一页」由渲染器在分区开头处理，不在这里取或，否则
分区内每个条目都会断页）。HTML/PDF/Word 消费同一份 plan。
"""

from __future__ import annotations

import copy

from app.services.exporter import render_html
from app.services.resume.document_plan import build_document_plan
from tests.document_export_samples import make_document


def _document_with_entry_layout(**entry_layout) -> dict:
    document = copy.deepcopy(make_document())
    projects = next(item for item in document["sections"] if item["key"] == "projects")
    projects["entries"][0]["layout"] = dict(entry_layout)
    return document


def test_planner_carries_entry_level_pagination_flags_only_own():
    document = _document_with_entry_layout(start_on_new_page=True, keep_together=True)
    plan = build_document_plan(document)
    projects = next(section for section in plan.sections if section.key == "projects")
    assert projects.entries[0].layout.start_on_new_page is True
    assert projects.entries[0].layout.keep_together is True
    # 分区级断页不向条目复制：否则分区内每个条目都会各断一页。
    for section in plan.sections:
        if section.key != "projects":
            assert all(not entry.layout.start_on_new_page for entry in section.entries)


def test_html_entry_pagination_classes_and_print_css():
    document = _document_with_entry_layout(start_on_new_page=True, keep_together=True)
    html = render_html(document)
    assert 'class="entry entry-break-before entry-keep"' in html
    assert ".entry-break-before{break-before:page" in html
    assert ".entry-keep{break-inside:avoid" in html
    # 默认文档的条目不带这两个类（默认产物一个字符都不多）。
    assert 'class="entry entry-break-before' not in render_html(make_document())


def test_pdf_entry_page_break_starts_new_page():
    from app.services.pdf_exporter import build_resume_pdf, font_available

    if not font_available():
        return
    baseline = build_resume_pdf(make_document(), template="classic", page_limit=3)
    forced = build_resume_pdf(
        _document_with_entry_layout(start_on_new_page=True),
        template="classic",
        page_limit=3,
    )
    assert forced.pages >= baseline.pages + 1


def test_docx_entry_page_break_and_keep_next():
    import io
    import zipfile

    from app.services.docx_exporter import build_resume_docx

    baseline = build_resume_docx(make_document(), template="classic", page_limit=3)
    forced = build_resume_docx(
        _document_with_entry_layout(start_on_new_page=True, keep_together=True),
        template="classic",
        page_limit=3,
    )

    def document_xml(data: bytes) -> str:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return archive.read("word/document.xml").decode("utf-8")

    baseline_xml = document_xml(baseline.content)
    forced_xml = document_xml(forced.content)
    assert forced_xml.count("pageBreakBefore") > baseline_xml.count("pageBreakBefore")
    assert forced_xml.count("keepNext") > baseline_xml.count("keepNext")
