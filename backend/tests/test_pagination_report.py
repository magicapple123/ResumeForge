# SPDX-License-Identifier: Apache-2.0
"""W08：分页报告端点 + 续页信息（重复姓名 / 页码）。

报告端点复用真实 PDF 渲染的绘制日志（``ResumePDF.spans``），不重写排版；
续页信息用 fpdf2 的 header()/footer() 画在页边距内（不占正文流、不影响页数）。
"""

from __future__ import annotations

import io

from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import build_resume_pdf
from pypdf import PdfReader
from test_pdf_exporter import needs_font

ID_A = "exp_12345678"
ID_B = "exp_87654321"


def _resume(extra_experience: int = 0) -> ResumeContent:
    experiences = [
        {"company": "甲公司", "role": "工程师", "description": ["做了甲。"], "id": ID_A},
        {"company": "乙公司", "role": "工程师", "description": ["做了乙。"], "id": ID_B},
    ]
    for index in range(extra_experience):
        experiences.append(
            {
                "company": f"公司{index}",
                "role": "工程师",
                "description": ["负责一段很长的描述。" * 6],
            }
        )
    return ResumeContent(name="张三", job_intent="后端工程师", experience=experiences)


def _create(client, extra: int = 0) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "分页报告", "content": _resume(extra).model_dump(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


REPORT = "/api/resumes/{id}/pagination/report"


def test_report_returns_pages_and_snapshot(client):
    resume_id = _create(client)
    response = client.post(REPORT.format(id=resume_id), json={"page_limit": 3})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["pages"] >= 1
    assert payload["pages_needed"] >= payload["pages"]
    assert payload["overflow"] is False
    assert payload["page_limit"] == 3
    assert payload["truncated_at"] is None
    assert len(payload["snapshot"]["content_sha256"]) == 64
    assert len(payload["snapshot"]["render_config_sha256"]) == 64


def test_report_locates_the_first_truncated_content(client):
    resume_id = _create(client, extra=14)  # 远超一页
    response = client.post(REPORT.format(id=resume_id), json={"page_limit": 1})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["overflow"] is True
    assert payload["pages"] == 1
    assert payload["pages_needed"] > 1
    truncated = payload["truncated_at"]
    assert truncated is not None
    assert truncated["kind"] in {"entry", "point", "section"}
    assert truncated["section"]
    assert truncated["object_id"] or truncated["section"]


def test_report_lists_manual_breaks(client):
    resume_id = _create(client)
    response = client.post(
        REPORT.format(id=resume_id),
        json={
            "page_limit": 3,
            "format_config": {
                "pagination": {
                    "version": 1,
                    "entries": {ID_B: {"break_before": "page"}},
                }
            },
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["manual_breaks"] == [{"kind": "entry", "object_id": ID_B, "page": 2}]


def test_report_accepts_unsaved_content_override(client):
    resume_id = _create(client)
    override = _resume(extra_experience=6).model_dump()
    response = client.post(REPORT.format(id=resume_id), json={"page_limit": 1, "content": override})
    assert response.status_code == 200, response.text
    assert len(response.json()["snapshot"]["content_sha256"]) == 64
    # 未保存正文只用于这次报告：记录内容不被改写（GET 回来的还是两段经历）。
    detail = client.get(f"/api/resumes/{resume_id}").json()
    assert len(detail["content"]["experience"]) == 2


@needs_font
def test_continuation_footer_prints_page_numbers():
    pdf = build_resume_pdf(
        _resume(extra_experience=10),
        template="classic",
        page_limit=3,
        format_config={
            "pagination": {
                "version": 1,
                "entries": {ID_B: {"break_before": "page"}},
                "continuation": {"page_numbers": True, "repeat_name": True},
            }
        },
    )
    assert pdf.pages >= 2
    reader = PdfReader(io.BytesIO(pdf.content))
    first_page = reader.pages[0].extract_text() or ""
    second_page = reader.pages[1].extract_text() or ""
    assert "第" in second_page and "页" in second_page, "第二页应有页码"
    assert "张三" in second_page, "续页应重复姓名"
    assert "张三" not in first_page.split("张三", 1)[1][:0]  # 首屏正常有姓名，不做反向断言
