# SPDX-License-Identifier: Apache-2.0
"""问题清单 §7：草稿预览的 HTML 允许携带**超额页正文**。

背景：草稿预览的 HTML 来自导出接口，而导出管线会按 page_limit 先截断内容——画布虽然
按服务端分页报告画出了 5 张纸，第 2 页起却是空白。修法是给预览一条"不截断"的出口：
请求带 include_overflow_pages=true 且 preview=true 时，HTML 不裁；画布照旧用红框 +
「超出上限，不计入导出」标注超额页。

本文件守四件事：

1. 预览不截断：完整 HTML 里能找到只存在于后面几页的标记文本，且不谎报"已裁剪"；
2. 普通导出仍截断：preview=false 时开关无效（HTML/PDF/Word 都按上限截）；
3. 缓存不串：截断版与完整版指纹不同，先截断后完整不能命中旧缓存；
4. 指纹把开关算进去（漏了就会出现"改了代码还是空白"）。
"""

from __future__ import annotations

import pytest
from app.schemas.resume import ResumeContent
from app.services.export_pipeline import (
    ExportRequest,
    RenderContext,
    build_export,
    render_config_fingerprint,
)

EXPORT = "/api/resumes/{id}/export"
MARKER = "尾部标记：量子纠缠实验室负责最后一页的独特内容"


def _long_content() -> ResumeContent:
    """足够长（>5 页）的正文；MARKER 放在靠后的经历里，只在超额页出现。"""
    experience = []
    for index in range(18):
        bullets = [
            f"第 {index + 1}-{item + 1} 条：负责订单链路的高并发改造，把核心接口 P99 从 "
            "820ms 降到 210ms，并用灰度发布保证零回滚。"
            for item in range(8)
        ]
        if index == 15:
            bullets[-1] = MARKER + "（只应出现在完整预览里）"
        experience.append(
            {
                "company": f"示例科技{index + 1}有限公司",
                "role": "后端开发工程师",
                "start_date": "2020-01",
                "end_date": "2021-06",
                "description": bullets,
            }
        )
    return ResumeContent(
        name="李四",
        phone="13900000000",
        email="lisi@example.com",
        job_intent="后端开发工程师",
        summary="六年后端开发经验，负责高并发交易链路与稳定性建设。" * 3,
        experience=experience,
        projects=[
            {
                "name": f"示例项目{index + 1}",
                "role": "核心开发",
                "description": ["负责服务拆分与接口契约治理，把发布频率从每月一次提升到每周两次。"],
            }
            for index in range(6)
        ],
        skills=[
            {"name": name, "level": "熟练"} for name in ("Python", "FastAPI", "MySQL", "Redis")
        ],
    )


def _create_long_resume(client) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "五页草稿预览", "content": _long_content().model_dump(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _export_html(client, resume_id: int, **payload):
    body = {"format": "html", "page_limit": 1, **payload}
    return client.post(EXPORT.format(id=resume_id), json=body)


def _pages_needed(client, resume_id: int) -> int:
    report = client.post(
        f"/api/resumes/{resume_id}/pagination/report",
        json={"page_limit": 1},
    )
    assert report.status_code == 200, report.text
    return int(report.json()["pages_needed"])


def _assert_content_spans_multiple_pages(client, resume_id: int) -> None:
    needed = _pages_needed(client, resume_id)
    assert needed >= 5, f"测试正文不够长（分页报告需要 {needed} 页，期望 >=5）"


def test_preview_html_keeps_overflow_pages(client):
    """preview=true + include_overflow_pages=true：后几页的正文在 HTML 里，且不谎报截断。"""
    resume_id = _create_long_resume(client)
    _assert_content_spans_multiple_pages(client, resume_id)

    full = _export_html(client, resume_id, preview=True, include_overflow_pages=True)
    assert full.status_code == 200, full.text
    assert MARKER in full.text
    # 返回的是完整内容：不能谎报"已按上限裁剪"。
    assert full.headers.get("X-Resume-Truncated") is None

    truncated = _export_html(client, resume_id, preview=True, include_overflow_pages=False)
    assert truncated.status_code == 200, truncated.text
    assert MARKER not in truncated.text
    assert truncated.headers.get("X-Resume-Truncated") == "true"
    # 完整版确实更大：不是"两者都完整"的假绿。
    assert len(full.content) > len(truncated.content)


def test_plain_export_ignores_include_overflow_pages(client):
    """preview=false 时开关不生效：普通 HTML 导出仍按上限截断（导出承诺不能被绕过）。"""
    resume_id = _create_long_resume(client)
    _assert_content_spans_multiple_pages(client, resume_id)

    response = _export_html(client, resume_id, preview=False, include_overflow_pages=True)
    assert response.status_code == 200, response.text
    assert MARKER not in response.text
    assert response.headers.get("X-Resume-Truncated") == "true"

    # 默认（不带开关）的普通导出逐字不变：同样截断。
    baseline = _export_html(client, resume_id, preview=False)
    assert baseline.status_code == 200
    assert MARKER not in baseline.text
    assert baseline.headers.get("X-Resume-Truncated") == "true"


def test_pdf_and_word_exports_still_truncate(client):
    """PDF / Word 仍按上限截断：这个开关只服务草稿预览的 HTML。"""
    resume_id = _create_long_resume(client)

    pdf = client.post(
        EXPORT.format(id=resume_id),
        json={
            "format": "pdf",
            "page_limit": 1,
            "preview": True,
            "include_overflow_pages": True,
        },
    )
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers.get("X-Resume-Pages") == "1"

    docx = client.post(
        EXPORT.format(id=resume_id),
        json={
            "format": "docx",
            "page_limit": 1,
            "include_overflow_pages": True,
        },
    )
    assert docx.status_code == 200, docx.text
    assert docx.headers.get("X-Resume-Truncated") == "true"


def test_preview_cache_does_not_mix_truncated_and_full(client, monkeypatch):
    """先截断、后完整：第二次不能命中第一次的缓存（指纹必须包含该开关）。"""
    from app.services import export_pipeline

    resume_id = _create_long_resume(client)
    _assert_content_spans_multiple_pages(client, resume_id)

    calls: list[int] = []
    original = export_pipeline.render_html

    def counting(*args, **kwargs):  # noqa: ANN002, ANN003 - 只数次数
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(export_pipeline, "render_html", counting)

    truncated = _export_html(client, resume_id, preview=True)
    full = _export_html(client, resume_id, preview=True, include_overflow_pages=True)
    full_again = _export_html(client, resume_id, preview=True, include_overflow_pages=True)

    assert MARKER not in truncated.text
    assert MARKER in full.text
    # 截断版排一次、完整版排一次；第三次是完整版自己的缓存命中。
    assert len(calls) == 2
    assert full_again.content == full.content


def test_render_config_fingerprint_includes_overflow_flag():
    """指纹必须算进这个开关，否则完整预览会命中截断缓存（7.3-3 的硬要求）。"""
    context = RenderContext(page_limit=1)
    plain = render_config_fingerprint(ExportRequest(format="html"), context)
    full = render_config_fingerprint(
        ExportRequest(format="html", include_overflow_pages=True), context
    )
    assert plain != full


def test_pipeline_skip_truncation_only_applies_to_html():
    """管线层兜底：即使请求带开关，非 HTML 格式也不跳过截断（Word 仍被裁）。"""
    content = _long_content().model_dump()
    context = RenderContext(page_limit=1)
    html_artifact = build_export(
        ExportRequest(format="html", page_limit=1, include_overflow_pages=True),
        content,
        context,
    )
    assert not html_artifact.truncated
    assert MARKER in html_artifact.content.decode("utf-8")

    docx_artifact = build_export(
        ExportRequest(format="docx", page_limit=1, include_overflow_pages=True),
        content,
        context,
    )
    assert docx_artifact.truncated


@pytest.mark.parametrize("fmt", ["html", "pdf", "docx"])
def test_include_flag_default_keeps_previous_behavior(fmt: str, client):
    """不带这个字段的旧调用方行为零变化：预览 HTML 仍截断，PDF/Word 不变。"""
    resume_id = _create_long_resume(client)
    response = client.post(
        EXPORT.format(id=resume_id), json={"format": fmt, "page_limit": 1, "preview": True}
    )
    assert response.status_code == 200, response.text
    if fmt == "html":
        assert MARKER not in response.text
        assert response.headers.get("X-Resume-Truncated") == "true"
