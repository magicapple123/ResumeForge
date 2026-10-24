# SPDX-License-Identifier: Apache-2.0
"""W14-BE 长 CV 文档模式：上限、夹紧、切换语义与资源预算。

三条硬要求（契约 §5.4）：
1. 普通简历 **1–3 页不变**；长 CV 1–10 页（默认 2 页）；
2. 模式切换不改内容/模板/版式，只夹紧页数（切回普通 10 页 → 3 页，不静默丢设置）；
3. 超限/超预算**明确失败**（422 或 409 + 原因），不静默截断、不缩字号。
"""

from __future__ import annotations

import pytest
from app.schemas.resume import ResumeContent
from app.schemas.resume_generation import (
    LONG_CV_DEFAULT_PAGE_LIMIT,
    LONG_CV_MAX_PAGES,
    MODE_PAGE_LIMITS,
    RESUME_MODES,
    mode_page_limit,
)
from test_pdf_exporter import needs_font


def _resume() -> ResumeContent:
    return ResumeContent(
        name="张三",
        job_intent="后端工程师",
        summary="十年后端经验。",
        experience=[{"company": "甲公司", "role": "工程师", "description": ["做了甲。"]}],
    )


def _create(client) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "长 CV 用例", "content": _resume().model_dump(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _layout(client, resume_id: int, payload: dict) -> dict:
    response = client.patch(f"/api/resumes/{resume_id}/layout", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_mode_constants_are_the_frozen_contract():
    assert RESUME_MODES == ("resume", "long_cv")
    assert LONG_CV_MAX_PAGES == 10
    assert LONG_CV_DEFAULT_PAGE_LIMIT == 2
    assert MODE_PAGE_LIMITS == {"resume": (1, 3), "long_cv": (1, 10)}
    assert mode_page_limit(10, "long_cv") == 10
    assert mode_page_limit(11, "long_cv") == 10
    assert mode_page_limit(4, "resume") == 3
    assert mode_page_limit(0, "resume") == 1
    assert mode_page_limit("garbage", "resume") == 1


def test_new_record_defaults_to_resume_mode(client):
    resume_id = _create(client)
    detail = client.get(f"/api/resumes/{resume_id}").json()
    assert detail["document_mode"] == "resume"
    assert detail["page_limit"] == 1


def test_patch_layout_switches_mode_and_clamps_page_limit(client):
    resume_id = _create(client)
    switched = _layout(client, resume_id, {"document_mode": "long_cv", "page_limit": 10})
    assert switched["document_mode"] == "long_cv"
    assert switched["page_limit"] == 10
    # 切回普通：10 页夹紧到 3，不改内容。
    back = _layout(client, resume_id, {"document_mode": "resume", "page_limit": 10})
    assert back["document_mode"] == "resume"
    assert back["page_limit"] == 3
    # 长 CV 的越界值也夹紧（不是 422）。
    clamped = _layout(client, resume_id, {"document_mode": "long_cv", "page_limit": 11})
    assert clamped["page_limit"] == 10


def test_mode_survives_content_save(client):
    resume_id = _create(client)
    _layout(client, resume_id, {"document_mode": "long_cv", "page_limit": 2})
    response = client.put(
        f"/api/resumes/{resume_id}/content", json={"content": _resume().model_dump()}
    )
    assert response.status_code == 200, response.text
    detail = client.get(f"/api/resumes/{resume_id}").json()
    assert detail["document_mode"] == "long_cv"
    assert detail["page_limit"] == 2


def test_catalog_exposes_mode_page_limits(client):
    payload = client.get("/api/resumes/templates").json()
    assert payload["mode_page_limits"] == {"resume": [1, 3], "long_cv": [1, 10]}
    assert payload["long_cv_default_page_limit"] == 2


def test_render_accepts_long_cv_page_limit_and_clamps_resume(client):
    body = {
        "content": _resume().model_dump(),
        "document_mode": "long_cv",
        "page_limit": 10,
    }
    response = client.post("/api/resumes/render", json=body)
    assert response.status_code == 200, response.text
    # 普通模式同一份内容给 10 页：按模式夹紧到 3（不 422）。
    body["document_mode"] = "resume"
    assert client.post("/api/resumes/render", json=body).status_code == 200


@needs_font
def test_export_page_limit_header_follows_document_mode(client):
    """pdf/docx 产物带"生效页数上限"头；长 CV 记录 5 页原样、普通记录夹到 3 页。"""
    resume_id = _create(client)
    _layout(client, resume_id, {"document_mode": "long_cv", "page_limit": 5})
    long_cv = client.post(f"/api/resumes/{resume_id}/export", json={"format": "pdf"})
    assert long_cv.status_code == 200, long_cv.text
    assert long_cv.headers["X-Resume-Page-Limit"] == "5"
    _layout(client, resume_id, {"document_mode": "resume", "page_limit": 5})
    normal = client.post(f"/api/resumes/{resume_id}/export", json={"format": "pdf"})
    assert normal.status_code == 200, normal.text
    assert normal.headers["X-Resume-Page-Limit"] == "3"


def test_long_cv_content_budget_rejects_oversized_content(client):
    resume_id = _create(client)
    _layout(client, resume_id, {"document_mode": "long_cv", "page_limit": 2})
    huge = _resume().model_dump()
    huge["projects"] = [{"name": "大项目", "description": ["负责一段很长的描述。" * 2000] * 40}]
    response = client.put(f"/api/resumes/{resume_id}/content", json={"content": huge})
    assert response.status_code == 422, response.text
    assert "字符预算" in response.text


@pytest.mark.parametrize("mode,limit,expected", [("resume", 4, 3), ("long_cv", 11, 10)])
def test_patch_layout_clamps_any_requested_limit(client, mode, limit, expected):
    resume_id = _create(client)
    payload = _layout(client, resume_id, {"document_mode": mode, "page_limit": limit})
    assert payload["page_limit"] == expected


def test_render_time_budget_fails_explicitly(monkeypatch):
    """渲染超时预算：明确失败并给中文原因，不静默截断（契约 §5.4）。"""
    import app.services.pdf_exporter.fit as fit_module
    from app.services.pdf_exporter import ResumePDFError, build_resume_pdf

    ticks = iter([0.0, 21.0])

    class _Clock:
        @staticmethod
        def monotonic() -> float:
            return next(ticks)

    monkeypatch.setattr(fit_module, "time", _Clock)
    with pytest.raises(ResumePDFError, match="长 CV 预算"):
        build_resume_pdf(_resume(), page_limit=10)
