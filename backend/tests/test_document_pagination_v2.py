# SPDX-License-Identifier: Apache-2.0
"""T1：分页报告直接消费 v2 文档，并与 PDF 入口保持同一页数口径。"""

from __future__ import annotations

import copy

from app.models.resume import ResumeRecord
from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import build_resume_pdf
from app.services.resume.document_pagination import build_pagination_report
from app.services.resume.resume_record import record_format_config
from test_pdf_exporter import needs_font
from tests.document_export_samples import make_document


def test_v2_entry_break_and_placement_share_pdf_report_pipeline():
    document = copy.deepcopy(make_document())
    projects = next(section for section in document["sections"] if section["key"] == "projects")
    projects["entries"][0].setdefault("layout", {})["start_on_new_page"] = True
    projects["entries"][0]["items"].append(
        {
            "kind": "field",
            "id": "it_prj999999",
            "key": "placement_probe",
            "value": "Trail placement value",
            "placement": "trail",
            "show_label": True,
            "solo": False,
        }
    )

    report = build_pagination_report(
        document,
        template="classic",
        format_config={},
        page_limit=3,
    )
    pdf = build_resume_pdf(
        document,
        template="classic",
        format_config={},
        page_limit=3,
    )

    assert report["pages"] == pdf.pages
    assert report["pages_needed"] == pdf.pages_needed
    assert report["overflow"] is False


def test_v2_entry_break_changes_natural_page_count():
    baseline = make_document()
    forced = copy.deepcopy(baseline)
    projects = next(section for section in forced["sections"] if section["key"] == "projects")
    projects["entries"][0].setdefault("layout", {})["start_on_new_page"] = True

    baseline_pdf = build_resume_pdf(baseline, template="classic", format_config={}, page_limit=3)
    forced_pdf = build_resume_pdf(forced, template="classic", format_config={}, page_limit=3)

    assert forced_pdf.pages_needed >= baseline_pdf.pages_needed + 1


@needs_font
def test_report_endpoint_keeps_v2_entry_break_and_does_not_write_override(client, db_session):
    created = client.post(
        "/api/resumes/manual",
        json={
            "title": "分页报告 v2",
            "content": ResumeContent(name="报告样本").model_dump(),
            "job_id": None,
        },
    )
    assert created.status_code == 201, created.text
    resume_id = created.json()["id"]
    before = client.get(f"/api/resumes/{resume_id}").json()["content"]
    record = db_session.get(ResumeRecord, resume_id)
    assert record is not None

    document = copy.deepcopy(make_document())
    projects = next(section for section in document["sections"] if section["key"] == "projects")
    entry = projects["entries"][0]
    entry.setdefault("layout", {})["start_on_new_page"] = True
    entry["items"].append(
        {
            "kind": "field",
            "id": "it_prj999999",
            "key": "placement_probe",
            "value": "Trail placement value",
            "placement": "trail",
            "show_label": True,
            "solo": False,
        }
    )
    response = client.post(
        f"/api/resumes/{resume_id}/pagination/report",
        json={"page_limit": 1, "content": document},
    )
    assert response.status_code == 200, response.text

    config = record_format_config(db_session, record)
    expected = build_pagination_report(
        document,
        template=record.template,
        format_config=config,
        page_limit=1,
        font_scale=record.font_scale,
        language=record.language,
    )
    report = response.json()
    assert report["pages"] == expected["pages"] == 1
    assert report["pages_needed"] == expected["pages_needed"] > 1
    assert report["truncated_at"] == expected["truncated_at"]
    assert {
        "kind": "entry",
        "object_id": entry["id"],
        "page": 2,
    } in report["manual_breaks"]
    assert client.get(f"/api/resumes/{resume_id}").json()["content"] == before
