# SPDX-License-Identifier: Apache-2.0
"""A4 证书资质与扩展可选字段的六格式产物 + 模板渲染（从 test_resume_credentials 拆出）。

为什么单独成文件：主文件已到 500 行测试预算（行数守卫）。本文件只回答"纸面/文件里
有没有这些栏目与字段、隐藏条目是否被排除、历史模板是否都能渲染"，口径与
tests/test_resume_research.py 的同名用例一致：六种格式（HTML/MD/TXT/JSON/Word/PDF）
从同一份样本出发，逐个断言内容与状态词、链接。
"""

from __future__ import annotations

import io
import json
import zipfile
from html import unescape

import pytest
from app.schemas.resume import ResumeContent
from app.services.exporter import export_json, export_markdown, render_html
from app.services.resume.resume_visibility import visible_resume
from test_pdf_exporter import needs_font
from test_resume_credentials import (
    ARTIFACT_TYPE,
    CREDENTIAL_NAME,
    ISSUER,
    PUBLIC_URL,
    VERIFY_URL,
    _content,
    _resume,
)

# ===== 5. 六格式与模板 =====


def _six_products(resume: ResumeContent) -> dict[str, str]:
    from app.services.docx_exporter import build_resume_docx
    from app.services.export_pipeline import ExportRequest, RenderContext, build_export

    context = RenderContext(template="classic", page_limit=3)
    products = {
        fmt: build_export(ExportRequest(format=fmt), resume, context).content.decode("utf-8")
        for fmt in ("html", "md", "txt", "json")
    }
    with zipfile.ZipFile(io.BytesIO(build_resume_docx(resume, page_limit=3).content)) as bundle:
        products["docx"] = bundle.read("word/document.xml").decode("utf-8")
    return products


def test_all_six_formats_include_credentials_and_new_fields():
    resume = _resume()
    products = _six_products(resume)
    expected = {
        "html": (CREDENTIAL_NAME, ISSUER, "有效期内", VERIFY_URL, ARTIFACT_TYPE, "合同制"),
        "md": (CREDENTIAL_NAME, "有效期内", VERIFY_URL, ARTIFACT_TYPE, "合同制"),
        "txt": (CREDENTIAL_NAME, "有效期内", VERIFY_URL, ARTIFACT_TYPE, "合同制"),
        "docx": (CREDENTIAL_NAME, "有效期内", VERIFY_URL, ARTIFACT_TYPE, "合同制"),
        "json": (CREDENTIAL_NAME, VERIFY_URL),
    }
    for fmt, probes in expected.items():
        for probe in probes:
            assert probe in products[fmt], f"{fmt} 缺少扩展栏目内容：{probe}"

    payload = json.loads(products["json"])
    assert payload["credentials"][0]["status"] == "active"
    assert payload["projects"][0]["public_url"] == PUBLIC_URL
    assert payload["experience"][0]["experience_kind"] == "contract"


@needs_font
def test_pdf_includes_credentials_and_new_fields():
    import pypdf
    from app.services.pdf_exporter import build_resume_pdf, font_subset

    font_subset.reset()
    resume = _resume()
    pdf = build_resume_pdf(resume, page_limit=3)
    text = "".join(
        page.extract_text() or "" for page in pypdf.PdfReader(io.BytesIO(pdf.content)).pages
    )
    for probe in (
        "证书资质",
        CREDENTIAL_NAME,
        ISSUER,
        "有效期内",
        VERIFY_URL,
        ARTIFACT_TYPE,
        "合同制",
    ):
        assert probe in text, f"PDF 缺少扩展栏目内容：{probe}"


def test_hidden_credentials_are_excluded_from_delivery_formats():
    data = _content()
    data["credentials"][0]["hidden"] = True
    resume = ResumeContent.model_validate(data)
    assert visible_resume(resume).credentials == []
    html = render_html(resume)
    markdown = export_markdown(resume)
    payload = json.loads(export_json(resume))
    for text in (html, markdown):
        assert CREDENTIAL_NAME not in text
    assert "credentials" not in payload


def test_en_us_credentials_exports_use_translated_labels():
    """en-US 的证照标题/字段前缀/状态词必须是英文（与科研栏目同一条守卫）。"""
    from app.services.exporter import export_markdown, render_html

    resume = _resume()
    # HTML 会把 & 转义成 &amp;，断言看的是纸面文字，先把实体还原再比。
    html = unescape(render_html(resume, language="en-US"))
    markdown = export_markdown(resume, language="en-US")
    for text in (html, markdown):
        for english in ("Certifications & Qualifications", "Active", "Issued", "Expiry", "Verify"):
            assert english in text, english
        for chinese in ("证书资质", "颁发机构", "有效期内"):
            assert chinese not in text, chinese


def test_html_credentials_have_resume_paths():
    html = render_html(_resume())
    for path in (
        "credentials.0.name",
        "credentials.0.issuer",
        "projects.0.public_url",
        "projects.0.artifact_type",
        "experience.0.experience_kind",
    ):
        assert f'data-resume-path="{path}"' in html, path


@pytest.mark.parametrize("template", ["classic", "modern", "elegant", "minimal", "compact", "technical", "split", "scholar", "editorial"])
def test_every_builtin_template_renders_credentials(template):
    """所有可见模板共用两个共享片段：历史模板继续能渲染新栏目（不报错、不丢标题）。"""
    html = render_html(_resume(), template=template)
    assert "证书资质" in html
    assert CREDENTIAL_NAME in html
