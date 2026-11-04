# SPDX-License-Identifier: Apache-2.0
"""导出管线与全参数导出 / 脱敏预览接口。

管线是唯一导出出口：这里钉住注册表含全部六种格式、脱敏作为前置步骤、水印后处理，
以及 ``POST /export`` 全参数与 ``POST /redact`` 预览不落库、不回写。
"""

import urllib.parse

import pytest
from app.schemas.resume import ResumeContent
from app.services.export_pipeline import (
    FORMAT_RENDERERS,
    ExportRequest,
    RenderContext,
    build_export,
)
from app.services.privacy import MASK, RedactionOptions
from tests.document_test_support import field_value, header_value


def _resume() -> ResumeContent:
    return ResumeContent(
        name="张三",
        phone="13800000000",
        email="a@example.com",
        github="github.com/zhangsan",
        personal_website="https://zhangsan.dev",
        summary="负责后端服务。",
        experience=[{"company": "字节跳动", "role": "工程师", "description": ["实现检索接口"]}],
    )


# ===== 管线单元 =====


def test_registry_includes_all_six_formats():
    assert set(FORMAT_RENDERERS) >= {"json", "md", "html", "pdf", "docx", "txt"}


def test_build_export_renders_docx_and_txt():
    resume = _resume()

    docx = build_export(ExportRequest(format="docx"), resume, RenderContext())
    assert docx.content.startswith(b"PK")
    assert docx.media_type.startswith("application/vnd.openxmlformats")

    txt = build_export(ExportRequest(format="txt"), resume, RenderContext())
    assert txt.media_type == "text/plain; charset=utf-8"
    assert "张三" in txt.content.decode("utf-8")


def test_build_export_applies_redaction_before_rendering():
    resume = _resume()

    artifact = build_export(
        ExportRequest(format="json", redact=True, redact_options=RedactionOptions()),
        resume,
        RenderContext(),
    )

    text = artifact.content.decode("utf-8")
    assert MASK in text
    assert "张三" not in text
    assert "字节跳动" not in text
    assert "a@example.com" not in text
    # 链接同样是可识别身份的信息：一个 handle / 域名就能顺着找到人。
    assert "github.com/zhangsan" not in text
    assert "zhangsan.dev" not in text


def test_redacted_pdf_does_not_leak_contact_links():
    """PDF 自 2026-10-21 起把 GitHub 与主页画进页头联系方式，脱敏必须跟着覆盖它们。"""
    artifact = build_export(
        ExportRequest(format="pdf", redact=True, redact_options=RedactionOptions()),
        _resume(),
        RenderContext(),
    )
    from io import BytesIO

    from pypdf import PdfReader

    text = "\n".join(
        page.extract_text() or "" for page in PdfReader(BytesIO(artifact.content)).pages
    )
    assert "github.com/zhangsan" not in text
    assert "zhangsan.dev" not in text
    assert "13800000000" not in text


def test_build_export_applies_watermark_to_html():
    resume = _resume()

    artifact = build_export(
        ExportRequest(format="html", watermark="内部使用"),
        resume,
        RenderContext(),
    )

    # 水印是「倾斜 + 重复平铺」的覆盖层；文案在 SVG 数据里，URL 解码后可见。
    text = artifact.content.decode("utf-8")
    assert "background-repeat:repeat" in text
    assert "内部使用" in urllib.parse.unquote(text)


def test_unknown_format_raises():
    with pytest.raises(ValueError):
        build_export(ExportRequest(format="xlsx"), _resume(), RenderContext())


# ===== 全参数导出 / 脱敏预览接口 =====


def _manual_resume(client, content: dict, title: str = "测试") -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": title, "content": content, "job_id": None},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_post_export_full_params_returns_docx(client):
    resume_id = _manual_resume(client, {"name": "张三", "summary": "关注后端。"})

    response = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "docx", "watermark": "内部", "redact": False, "include_photo": True},
    )

    assert response.status_code == 200
    assert response.content.startswith(b"PK")
    # 响应头保留页数 / 页数上限（Word 也回传）。
    assert "X-Resume-Page-Limit" in response.headers


def test_post_export_redaction_removes_pii(client):
    resume_id = _manual_resume(
        client, {"name": "张三", "phone": "13800000000", "summary": "关注后端。"}
    )

    response = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "json", "redact": True},
    )

    assert response.status_code == 200
    text = response.content.decode("utf-8")
    assert "***" in text
    assert "张三" not in text
    assert "13800000000" not in text


def test_post_export_unknown_format_is_rejected(client):
    resume_id = _manual_resume(client, {"name": "张三"})

    response = client.post(f"/api/resumes/{resume_id}/export", json={"format": "xlsx"})

    assert response.status_code == 422


def test_post_export_still_honours_the_incomplete_gate(client):
    resume_id = _manual_resume(client, {"name": "张三", "summary": "关注后端【待补】"})

    blocked = client.post(f"/api/resumes/{resume_id}/export", json={"format": "docx"})
    assert blocked.status_code == 409

    allowed = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "docx", "allow_incomplete": True},
    )
    assert allowed.status_code == 200


def test_redact_preview_returns_redacted_content_without_persisting(client):
    resume_id = _manual_resume(
        client, {"name": "张三", "phone": "13800000000", "summary": "关注后端。"}
    )

    response = client.post(f"/api/resumes/{resume_id}/redact", json={})

    assert response.status_code == 200
    # /redact 返回 v2 文档 JSON：身份字段在 header items 里。
    body = response.json()
    assert body["version"] == 2
    assert header_value(body, "name") == "***"
    assert header_value(body, "phone") == "***"

    # 不落库、不回写：原记录仍是真实值。
    detail = client.get(f"/api/resumes/{resume_id}").json()["content"]
    assert header_value(detail, "name") == "张三"
    assert header_value(detail, "phone") == "13800000000"


def test_redact_preview_options_are_configurable(client):
    resume_id = _manual_resume(
        client,
        {
            "name": "张三",
            "summary": "关注后端。",
            "education": [{"school": "清华大学", "major": "计算机"}],
        },
    )

    response = client.post(
        f"/api/resumes/{resume_id}/redact",
        json={"mask_school": True, "mask_name": False},
    )

    assert response.status_code == 200
    body = response.json()
    assert header_value(body, "name") == "张三"  # mask_name=False：不遮罩
    assert field_value(body, "school", section="education") == "***"  # mask_school=True：遮罩


# ===== 1-D 收口补：PDF 的裁剪事实与「不限」的 page-limit 头 =====


def test_pdf_truncation_flag_matches_whether_pages_were_dropped(monkeypatch):
    """PDF 少了页就要报 ``truncated``；「不限篇幅」下的 10 页保护不算裁剪。

    以前 PDF 只回 ``overflow``（"裁完仍超限"），同一份简历 Word 会说"从某板块起没有"、
    PDF 只说"溢出"，界面读到的口径不一致。这里把两个结论钉在同一个产物上。
    """
    from types import SimpleNamespace

    from app.services import export_pipeline as pipeline

    def _fake_pdf(*_args, **_kwargs):
        # 自然 3 页、被裁到 1 页：文件里确实少了内容。
        return SimpleNamespace(content=b"%PDF-1.4", pages=1, pages_needed=3, overflow=True)

    monkeypatch.setattr(pipeline, "build_resume_pdf", _fake_pdf)

    limited = build_export(
        ExportRequest(format="pdf", page_limit=1), _resume(), RenderContext(page_limit=1)
    )
    assert limited.truncated is True
    assert limited.pages == 1 and limited.pages_needed == 3
    assert limited.truncated_at == "", "PDF 没有板块级裁点，只能报少了内容"

    unlimited = build_export(
        ExportRequest(format="pdf"),
        _resume(),
        RenderContext(page_limit=10, page_limit_is_unlimited=True),
    )
    assert unlimited.truncated is False, "用户选了不限，10 页保护不能报成按上限裁剪"


def test_page_limit_header_value_tells_unlimited_apart():
    """`X-Resume-Page-Limit`：「不限」回语义值 0，不把渲染保护上限 10 当用户上限。"""
    from app.api.resumes._shared import page_limit_header_value

    assert page_limit_header_value(10, is_unlimited=True) == "0"
    assert page_limit_header_value(3, is_unlimited=False) == "3"
    assert page_limit_header_value(None, is_unlimited=False) is None
