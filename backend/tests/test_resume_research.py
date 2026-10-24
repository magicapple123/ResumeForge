# SPDX-License-Identifier: Apache-2.0
"""W14-BE 科研三栏目：序列化不变性、往返、六格式输出、脱敏/完整性/ATS 消费。

**硬要求**（契约 §5.2）：旧记录没有三个字段 → 序列化后也**不出现键**（空列表不输出），
否则所有已有交付记录的 source_content_sha256 都会变。本文件第一组用例钉这一条。
"""

from __future__ import annotations

import json

import pytest
from app.schemas.resume import ResumeContent
from app.schemas.resume_research import ResumePatent, ResumePublication
from app.services.resume.document_identity import DocumentIdentityError, validate_document_ids
from app.services.resume.resume_completeness import find_incomplete
from app.services.resume.resume_delivery import canonical_content_sha256
from app.services.resume.resume_labels import patent_status_text, publication_status_text
from app.services.resume.resume_visibility import visible_resume
from pydantic import ValidationError
from test_pdf_exporter import needs_font

PUB_TITLE = "高并发交易链路稳定性实践"
RESEARCH_NAME = "分布式交易一致性研究"
PATENT_TITLE = "一种交易幂等补偿方法"
LEGACY = {"name": "张三", "job_intent": "后端工程师", "experience": [{"company": "甲公司"}]}


def _content() -> dict:
    return {
        **LEGACY,
        "publications": [
            {
                "title": PUB_TITLE,
                "authors": [
                    {"name": "张三", "is_self": True, "corresponding": True},
                    {"name": "李四"},
                ],
                "venue": "软件工程实践",
                "year": "2024",
                "status": "under_review",
                "doi": "10.1000/example",
                "url": "https://doi.example.org/10.1000/example",
                "id": "pub_12345678",
            }
        ],
        "research_projects": [
            {
                "name": RESEARCH_NAME,
                "role": "负责人",
                "organization": "示例实验室",
                "funding": "国家自然科学基金",
                "description": ["研究跨库事务一致性。"],
                "outcomes": ["形成补偿框架。"],
                "id": "rsp_12345678",
            }
        ],
        "patents": [
            {
                "title": PATENT_TITLE,
                "inventors": [{"name": "张三", "is_self": True}],
                "patent_number": "CN202310000001",
                "country": "中国",
                "status": "granted",
                "id": "pat_12345678",
            }
        ],
    }


# ===== 1. 序列化不变性（D11：空列表不进内容指纹）=====


def test_empty_research_lists_are_not_serialized():
    dumped = ResumeContent(name="张三").model_dump()
    assert "publications" not in dumped
    assert "research_projects" not in dumped
    assert "patents" not in dumped
    # 有内容时照常输出。
    with_research = ResumeContent.model_validate(_content()).model_dump()
    assert len(with_research["publications"]) == 1


def test_legacy_content_dump_has_no_research_keys():
    """旧内容 dump 的键集合必须与 W14 之前**完全一致**（内容指纹不变的前提）。

    这个键集合是旧行为的刻度：新增字段只要漏进默认 dump，交付快照的
    source_content_sha256 就会整体漂移，与历史交付不可比。
    """
    dumped = ResumeContent.model_validate(LEGACY).model_dump()
    assert set(dumped) == {
        "name",
        "photo",
        "gender",
        "birth_year",
        "phone",
        "email",
        "city",
        "personal_website",
        "github",
        "job_intent",
        "summary",
        "education",
        "experience",
        "campus_experience",
        "projects",
        "skills",
        "awards",
    }
    assert canonical_content_sha256(dumped) == canonical_content_sha256(
        json.loads(json.dumps(dumped, ensure_ascii=False))
    )


def test_research_ids_hidden_and_lock_fields_roundtrip():
    resume = ResumeContent.model_validate(_content())
    publication = resume.publications[0]
    assert publication.id == "pub_12345678"
    assert publication.authors[0].is_self is True
    assert publication.authors[0].corresponding is True
    assert publication.authors[1].name == "李四"
    assert publication.hidden is None
    dumped = publication.model_dump()
    assert "hidden" not in dumped and "lock_content" not in dumped


# ===== 2. 保存往返 =====


def test_save_and_read_back_preserves_research_fields(client):
    created = client.post(
        "/api/resumes/manual",
        json={"title": "科研简历", "content": _content(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    detail = client.get(f"/api/resumes/{created.json()['id']}").json()["content"]
    publication = detail["publications"][0]
    assert publication["title"] == PUB_TITLE
    assert [author["name"] for author in publication["authors"]] == ["张三", "李四"]
    assert publication["authors"][0]["is_self"] is True
    assert publication["status"] == "under_review"
    assert publication["id"] == "pub_12345678"
    assert detail["research_projects"][0]["funding"] == "国家自然科学基金"
    assert detail["patents"][0]["patent_number"] == "CN202310000001"


def test_research_ids_participate_in_identity_validation():
    validate_document_ids(_content())
    broken = _content()
    broken["publications"][0]["id"] = "bad id"
    with pytest.raises(DocumentIdentityError):
        validate_document_ids(broken)


def test_research_urls_are_http_only():
    assert ResumePublication(url="").url == ""
    with pytest.raises(ValidationError):
        ResumePublication(url="javascript:alert(1)")
    with pytest.raises(ValidationError):
        ResumePatent(url="file:///etc/passwd")


# ===== 3. 状态正名（事实锁）=====


def test_status_text_never_promotes_under_review():
    assert publication_status_text("under_review", "zh-CN") == "在投"
    assert publication_status_text("under_review", "en-US") == "Under Review"
    assert patent_status_text("granted", "zh-CN") == "已授权"
    # 未知状态回落「其他」，绝不猜成已发表。
    assert publication_status_text("unknown-status", "zh-CN") == "其他"


def test_rendered_output_uses_the_canonical_status_word():
    from app.services.exporter import export_markdown, render_html

    resume = ResumeContent.model_validate(_content())
    for text in (render_html(resume), export_markdown(resume)):
        assert "在投" in text
        assert PUB_TITLE in text
        assert "已发表" not in text


# ===== 4. 六种导出格式 =====


def test_all_six_formats_include_the_research_sections():
    from app.services.export_pipeline import ExportRequest, RenderContext, build_export

    resume = ResumeContent.model_validate(_content())
    context = RenderContext(template="classic", page_limit=3)
    expected = (PUB_TITLE, RESEARCH_NAME, PATENT_TITLE, "CN202310000001")
    for fmt in ("html", "md", "txt", "json"):
        text = build_export(ExportRequest(format=fmt), resume, context).content.decode("utf-8")
        for probe in expected[:3]:
            assert probe in text, f"{fmt} 缺少科研内容：{probe}"
    json_payload = json.loads(build_export(ExportRequest(format="json"), resume, context).content)
    assert json_payload["publications"][0]["status"] == "under_review"


def test_html_research_sections_have_resume_paths():
    from app.services.exporter import render_html

    html = render_html(ResumeContent.model_validate(_content()))
    for path in (
        "publications.0.title",
        "publications.0.authors.0.name",
        "research_projects.0.name",
        "patents.0.title",
    ):
        assert f'data-resume-path="{path}"' in html, path


def test_hidden_research_entries_are_excluded_from_delivery_formats():
    from app.services.exporter import export_markdown, render_html

    data = _content()
    data["publications"][0]["hidden"] = True
    resume = visible_resume(ResumeContent.model_validate(data))
    assert resume.publications == []
    for text in (
        render_html(ResumeContent.model_validate(data)),
        export_markdown(ResumeContent.model_validate(data)),
    ):
        assert PUB_TITLE not in text


# ===== 5. 脱敏 / 完整性 / ATS =====


def test_redact_masks_research_identity_fields():
    from app.services.privacy import RedactionOptions, redact

    resume = ResumeContent.model_validate(_content())
    masked = redact(
        resume,
        RedactionOptions(mask_name=True, mask_school=True, mask_project=True),
    )
    publication = masked.publications[0]
    assert publication.authors[0].name != "张三"
    assert publication.venue != "软件工程实践"
    assert publication.title != PUB_TITLE
    assert masked.patents[0].title != PATENT_TITLE
    # 原文不被改动（redact 返回新对象）。
    source = ResumeContent.model_validate(_content())
    assert source.publications[0].title == PUB_TITLE


def test_completeness_flags_unfinished_research_fields():
    data = _content()
    data["publications"][0]["title"] = "论文【待补：题目】"
    found = find_incomplete(ResumeContent.model_validate(data))
    assert any("论文" in message for message in found)


def test_ats_section_texts_include_research():
    from app.services.ats_keywords import _SECTION_ORDER, _section_texts

    sections = _section_texts(ResumeContent.model_validate(_content()))
    assert {"publications", "research_projects", "patents"} <= set(sections)
    assert {"publications", "research_projects", "patents"} <= set(_SECTION_ORDER)
    assert PUB_TITLE in sections["publications"]
    assert "CN202310000001" in sections["patents"]


# ===== 6. PDF / Word（与 HTML/MD 同源字段，不承诺像素一致）=====


@needs_font
def test_pdf_and_word_include_research_entries_and_status_words():
    import io
    import zipfile

    import pypdf
    from app.services.docx_exporter import build_resume_docx
    from app.services.pdf_exporter import build_resume_pdf

    resume = ResumeContent.model_validate(_content())
    pdf_text = "".join(
        page.extract_text() or ""
        for page in pypdf.PdfReader(
            io.BytesIO(build_resume_pdf(resume, page_limit=2).content)
        ).pages
    )
    assert PUB_TITLE in pdf_text and PATENT_TITLE in pdf_text
    assert "在投" in pdf_text and "已授权" in pdf_text
    assert "已发表" not in pdf_text
    with zipfile.ZipFile(io.BytesIO(build_resume_docx(resume, page_limit=2).content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    for probe in (PUB_TITLE, RESEARCH_NAME, PATENT_TITLE, "CN202310000001", "在投"):
        assert probe in xml, probe


@needs_font
def test_scholar_template_renders_research_sections_in_order():
    from app.services.pdf_exporter import build_resume_pdf

    resume = ResumeContent.model_validate(_content())
    content = build_resume_pdf(
        resume, template="scholar", page_limit=3, include_photo=False
    ).content
    import io

    import pypdf

    text = "".join(page.extract_text() or "" for page in pypdf.PdfReader(io.BytesIO(content)).pages)
    positions = [text.find(probe) for probe in (PUB_TITLE, RESEARCH_NAME, PATENT_TITLE)]
    assert all(position >= 0 for position in positions), positions
    assert positions == sorted(positions), "科研板块应按 论文→项目→专利 的默认顺序出现"


# ===== 7. 中英填充词 / 分隔符 / 分页域接受科研板块（独立复验发现并修复的缺陷回归）=====


def test_en_us_research_exports_use_translated_field_labels():
    """en-US 的科研字段前缀必须是英文：此前 MD/HTML/Word/PDF 硬编码「经费/申请/授权」。"""
    from app.services.docx_exporter import build_resume_docx
    from app.services.exporter import export_markdown, render_html

    data = _content()
    data["patents"][0]["filed_date"] = "2021-03"
    data["patents"][0]["granted_date"] = "2023-08"
    resume = ResumeContent.model_validate(data)
    html = render_html(resume, language="en-US")
    markdown = export_markdown(resume, language="en-US")
    for text in (html, markdown):
        for english in ("Funding", "Filed", "Granted", "DOI"):
            assert english in text, english
        for chinese in ("经费", "申请", "授权"):
            assert chinese not in text, chinese
    import io
    import zipfile

    with zipfile.ZipFile(io.BytesIO(build_resume_docx(resume, language="en-US").content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    for english in ("Funding", "Filed", "Granted"):
        assert english in xml, english
    for chinese in ("经费", "申请", "授权"):
        assert chinese not in xml, chinese


def test_research_detail_helpers_have_no_dangling_separators():
    """HTML/PDF/Word 共用的细节行：空项不产生前导 " · "，日期只有一端不留 " - "。"""
    from app.schemas.resume_research import ResumePatent, ResumePublication
    from app.services.resume.resume_labels import date_range, patent_detail, publication_detail

    publication = ResumePublication(title="T", doi="10.1/x")
    assert publication_detail(publication, "zh-CN") == "DOI：10.1/x"
    patent = ResumePatent(title="P", filed_date="2021-03")
    assert patent_detail(patent, "en-US") == "Filed 2021-03"
    assert date_range("2020-09", "") == "2020-09"
    assert date_range("", "2023-08") == "2023-08"
    assert date_range("2020-09", "2023-08") == "2020-09 - 2023-08"


def test_html_research_details_have_no_leading_separator():
    from app.services.exporter import render_html

    html = render_html(ResumeContent.model_validate(_content()), language="zh-CN")
    assert 'data-role="meta"> · ' not in html
    # 只有开始日期的科研项目：右栏不得留下 " - "。
    data = _content()
    data["research_projects"][0]["end_date"] = ""
    html = render_html(ResumeContent.model_validate(data))
    assert " - " not in html.split("科研项目", 1)[1][:600]


def test_pagination_domain_accepts_research_sections():
    """W14 的科研板块键必须进分页域白名单（否则"论文从新页开始"会被静默丢弃）。"""
    from app.services.resume.resume_pagination import (
        SECTION_KEYS,
        resolve_pagination,
        validate_pagination_domain,
    )
    from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER

    assert SECTION_KEYS == DEFAULT_SECTION_ORDER
    domain = {
        "version": 1,
        "sections": {"publications": {"break_before": "page"}},
        "entries": {ID: {"keep_with_next": 2} for ID in ("pub_12345678", "rsp_12345678")},
    }
    kept = validate_pagination_domain(domain)
    assert kept["sections"]["publications"]["break_before"] == "page"
    assert kept["entries"]["pub_12345678"]["keep_with_next"] == 2
    plan = resolve_pagination({"pagination": domain})
    assert plan.section("publications").break_before_page is True
