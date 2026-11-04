# SPDX-License-Identifier: Apache-2.0
"""「不限篇幅」（``page_limit == 0``）在精确预览与分页报告上的口径。

## 两个字段，两种意思

- ``page_limit``：**渲染保护上限**。``pdf_exporter.fit`` 要一个正数 ``max_pages``，
  所以 0 会被 ``mode_page_limit`` 折成 ``UNLIMITED_RENDER_MAX_PAGES``（10 页）。
- ``page_limit_is_unlimited``：**用户到底选了什么**。为真表示"一个字都不许裁"。

只要其中一处把 0 当成"没传"（或把折出来的 10 当成"用户要 10 页"），界面上就会出现
"选了不限、预览仍按 1 页排"或"实际 3 页，却说上限 10 页"。本文件把两端都钉住：
schema 收得下 0（``PreviewPdfRequest.page_limit`` 的 ``ge=0``）、报告带得出这个布尔。
"""

from __future__ import annotations

from app.schemas.resume import ResumeContent
from test_pdf_exporter import needs_font

REPORT = "/api/resumes/{id}/pagination/report"
PREVIEW = "/api/resumes/{id}/preview-pdf"

# 与 ``mode_page_limit(0, ...)`` 折出来的渲染保护上限一致（普通 / 长 CV 都一样）。
UNLIMITED_RENDER_MAX_PAGES = 10


def _resume(extra_experience: int = 0) -> ResumeContent:
    experiences = [
        {"company": "甲公司", "role": "工程师", "description": ["做了甲。"], "id": "exp_00000001"},
        {"company": "乙公司", "role": "工程师", "description": ["做了乙。"], "id": "exp_00000002"},
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
        json={"title": "不限篇幅", "content": _resume(extra).model_dump(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def test_report_accepts_zero_page_limit_as_unlimited(client):
    """请求体里的 0 必须被收下（旧 schema 是 ``ge=1``，这里直接 422）。"""
    resume_id = _create(client, extra=14)  # 远超一页
    response = client.post(REPORT.format(id=resume_id), json={"page_limit": 0})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["page_limit_is_unlimited"] is True
    # 数字字段仍是渲染保护上限：页标记要一个正数基准，不能是 0。
    assert payload["page_limit"] == UNLIMITED_RENDER_MAX_PAGES
    # 不限 = 不裁剪：没有截断点，也没有溢出。
    assert payload["truncated_at"] is None
    assert payload["overflow"] is False
    assert payload["pages_needed"] >= 1


def test_report_flags_a_real_limit_as_limited(client):
    """有上限时布尔为假——否则前端会把"上限 1 页"也说成"实际 N 页"。"""
    resume_id = _create(client, extra=14)
    payload = client.post(REPORT.format(id=resume_id), json={"page_limit": 1}).json()
    assert payload["page_limit_is_unlimited"] is False
    assert payload["page_limit"] == 1
    assert payload["truncated_at"] is not None


def test_report_reads_unlimited_from_the_record(client):
    """草稿没带 page_limit 时按记录值判：记录是 0 → 报告也要标成不限。"""
    resume_id = _create(client, extra=6)
    saved = client.patch(f"/api/resumes/{resume_id}/layout", json={"page_limit": 0})
    assert saved.status_code == 200, saved.text
    assert saved.json()["page_limit"] == 0

    payload = client.post(REPORT.format(id=resume_id), json={}).json()
    assert payload["page_limit_is_unlimited"] is True
    assert payload["page_limit"] == UNLIMITED_RENDER_MAX_PAGES


def test_report_without_any_page_limit_defaults_to_limited(client):
    """新记录默认 1 页：布尔为假，别把"用户没说话"当成"不限"。"""
    resume_id = _create(client)
    payload = client.post(REPORT.format(id=resume_id), json={}).json()
    assert payload["page_limit_is_unlimited"] is False


@needs_font
def test_preview_pdf_accepts_zero_page_limit(client):
    """精确预览同样要收下 0：响应头回 0（不限），而不是折出来的 10 或最严的 1。"""
    resume_id = _create(client, extra=14)
    response = client.post(
        PREVIEW.format(id=resume_id),
        json={"template": "classic", "page_limit": 0},
    )
    assert response.status_code == 200, response.text
    assert response.headers["X-Resume-Page-Limit"] == "0"
    assert response.headers["X-Resume-Overflow"] == "false"
    assert int(response.headers["X-Resume-Pages"]) >= 1


@needs_font
def test_export_accepts_zero_page_limit(client):
    """导出也要收下 0（导出面板把草稿的 page_limit 原样发来）。

    ``_export_record`` 早就按 ``raw_page_limit == 0`` 算不限，但 ``ExportRequest`` 的
    schema 写死 ``ge=1``：用户在制作台选了「不限」，点导出直接 422。
    """
    resume_id = _create(client, extra=6)
    response = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "pdf", "page_limit": 0},
    )
    assert response.status_code == 200, response.text
    assert response.headers["X-Resume-Page-Limit"] == "0"
    # 只有真的裁过才会带这个头：不限篇幅下它必须缺席（缺席 = 一个字都没裁）。
    assert response.headers.get("X-Resume-Truncated") != "true"


def test_preflight_accepts_zero_page_limit(client):
    """导出前预检用的是同一份草稿值：0（不限）不许在 schema 层被 422 掉。"""
    resume_id = _create(client, extra=6)
    response = client.post(
        f"/api/resumes/{resume_id}/preflight",
        json={"layers": ["content", "layout"], "layout": {"page_limit": 0}},
    )
    assert response.status_code == 200, response.text
