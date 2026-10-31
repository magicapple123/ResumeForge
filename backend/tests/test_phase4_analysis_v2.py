# SPDX-License-Identifier: Apache-2.0
"""Analysis responses keep their contracts while reading native documents."""

from app.schemas.resume import ResumeContent
from app.services.ats_check import check_ats
from app.services.resume.document_io import ensure_document_version
from app.services.resume.resume_risk_rules import scan_local


def _content():
    return ResumeContent.model_validate(
        {
            "name": "示例",
            "phone": "13800000000",
            "email": "demo@example.com",
            "job_intent": "Python 工程师",
            "summary": "后端开发与 SQL 检索",
            "education": [
                {
                    "school": "示例大学",
                    "major": "软件工程",
                    "start_date": "2020-09",
                    "end_date": "2024-06",
                }
            ],
            "experience": [
                {
                    "company": "示例公司",
                    "role": "开发",
                    "description": ["主导 Python 接口开发，耗时减少 30%", "优化 SQL 查询"],
                    "start_date": "2024-07",
                    "end_date": "至今",
                }
            ],
            "skills": [{"name": "Python", "level": "熟练"}],
        }
    )


def test_ats_v2_response_equals_existing_conventional_content_contract():
    resume = _content()
    document = ensure_document_version(resume.model_dump())
    expected = check_ats(resume, jd_text="Python SQL", resume_id=7).model_dump()
    assert check_ats(document, jd_text="Python SQL", resume_id=7).model_dump() == expected


def test_risk_v2_response_equals_existing_conventional_content_contract():
    resume = _content()
    document = ensure_document_version(resume.model_dump())
    assert [p.model_dump() for p in scan_local(document, [])] == [
        p.model_dump() for p in scan_local(resume, [])
    ]


def test_native_analysis_reads_custom_sections_and_excludes_hidden_text():
    document = ensure_document_version(_content().model_dump())
    document["sections"].append(
        {
            "key": "custom_analysis",
            "title": "自建分析",
            "kind": "entries",
            "entries": [
                {
                    "id": "ob_customanalysis",
                    "items": [
                        {"kind": "text", "id": "pt_customanalysis", "text": "主导 Rust 服务开发"},
                        {
                            "kind": "text",
                            "id": "pt_hiddenanalysis",
                            "text": "全球第一",
                            "hidden": True,
                        },
                    ],
                }
            ],
        }
    )
    result = check_ats(document, jd_text="Rust").model_dump()
    hit = next(h for h in result["keyword_hits"] if h["keyword"].lower() == "rust")
    assert hit["matched"] and hit["sections"] == ["custom_analysis"]
    risks = scan_local(document, [])
    assert any(p.category == "deep_dive" and "Rust" in p.text for p in risks)
    assert not any(p.text == "全球第一" for p in risks)
