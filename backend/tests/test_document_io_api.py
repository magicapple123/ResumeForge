# SPDX-License-Identifier: Apache-2.0
"""v2 文档模型的 API 读写边界集成验收（backend-api 自测）。

覆盖计划 §7.5/§8.2 的读写收口：
- 手工创建接受旧 v1 内容 → 响应/存储是 v2，并带 document_conversion；
- 详情读取旧 v1 记录 → 转换一次（不写库）并回摘要；已存 v2 → 摘要为 None；
- 保存（含条件写）接受 v1/v2 → 一律落 v2，revision 语义不变；
- 四出口（HTML/Markdown/TXT/JSON/PDF/Word）对 v2 简历**产物非空且含关键字段**
  （qa 报告过"v2 简历导出全空"的静默丢内容 bug，这里钉住回归）；
- /render 与 /redact 的 v2 入口；资料字段位置目录接口。
"""

from __future__ import annotations

from app.models.resume import ResumeRecord
from tests.document_helpers import values

V1_CONTENT = {
    "name": "张示例",
    "phone": "13800000000",
    "email": "demo@example.com",
    "job_intent": "后端工程师",
    "summary": "三年 Python 后端经验。",
    "education": [
        {
            "school": "示例大学",
            "major": "计算机科学与技术",
            "degree": "本科",
            "start_date": "2016-09",
            "end_date": "2020-06",
            "gpa": "3.8/4.0",
        }
    ],
    "experience": [
        {
            "company": "示例公司",
            "role": "后端工程师",
            "start_date": "2020-07",
            "end_date": "2023-01",
            "description": ["负责订单服务重构", "接口 QPS 提升两倍"],
        }
    ],
}


def _manual_resume(client, content: dict) -> dict:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "v2 集成验收", "content": content, "job_id": None},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_manual_create_converts_v1_to_v2_and_reports_conversion(client):
    created = _manual_resume(client, V1_CONTENT)
    assert created["content"]["version"] == 2
    assert created["content"]["header"]["items"]
    report = created.get("document_conversion")
    assert isinstance(report, dict)
    assert report["fields_recognized"] > 0
    assert "warnings" in report and "empty_sections" in report
    # 关键值都在 v2 文档里（文字不丢）。
    assert "张示例" in values(created["content"])
    assert "示例公司" in values(created["content"])


def test_detail_reads_stored_v2_without_second_conversion(client):
    created = _manual_resume(client, V1_CONTENT)
    detail = client.get(f"/api/resumes/{created['id']}").json()
    assert detail["content"]["version"] == 2
    # 存储已是 v2：详情不再触发转换，摘要必须为 None（避免前端重复提示"已升级"）。
    assert detail.get("document_conversion") is None
    assert detail["revision"] == created["revision"]


def test_save_v2_content_roundtrip_and_revision(client):
    created = _manual_resume(client, V1_CONTENT)
    content = created["content"]
    # 改一个 header 值，模拟编辑器保存。
    name_item = next(item for item in content["header"]["items"] if item["key"] == "name")
    name_item["value"] = "张示例改"
    saved = client.put(
        f"/api/resumes/{created['id']}/content",
        json={"content": content, "expected_revision": created["revision"]},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["content"]["version"] == 2
    assert body["revision"] == created["revision"] + 1
    detail = client.get(f"/api/resumes/{created['id']}").json()
    assert "张示例改" in values(detail["content"])


def test_save_accepts_legacy_v1_content_too(client):
    """旧调用方仍可提交 v1：服务端转换后落 v2（写侧兼容）。"""
    created = _manual_resume(client, V1_CONTENT)
    legacy = dict(V1_CONTENT)
    legacy["name"] = "旧客户端改名"
    saved = client.put(
        f"/api/resumes/{created['id']}/content",
        json={"content": legacy, "expected_revision": created["revision"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["content"]["version"] == 2
    assert "旧客户端改名" in values(saved.json()["content"])


def test_legacy_v1_record_reads_as_v2_with_conversion_report(client, db_session):
    # 直接写一条 v1 记录的库内形态（模拟本批之前保存的简历）。
    record = ResumeRecord(
        title="旧简历",
        job_title="",
        company="",
        content=V1_CONTENT,
        warnings=[],
        source="manual",
        model="",
        enhancement_enabled=False,
        enhancement_level="balanced",
        parse_error="",
        template="classic",
        format_config={},
        page_limit=1,
        font_scale="standard",
        language="zh-CN",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    detail = client.get(f"/api/resumes/{record.id}").json()
    assert detail["content"]["version"] == 2
    assert detail["document_conversion"] is not None
    assert "示例大学" in values(detail["content"])
    # 读路径不写库：再读一次仍是最初的 v1 原始内容。
    db_session.refresh(record)
    assert record.content.get("version") is None
    assert record.content == V1_CONTENT


def test_exports_of_v2_resume_are_non_empty_and_contain_fields(client):
    created = _manual_resume(client, V1_CONTENT)
    resume_id = created["id"]
    expected = ("示例大学", "示例公司")
    for doc_format in ("html", "md", "txt", "json"):
        response = client.post(f"/api/resumes/{resume_id}/export", json={"format": doc_format})
        assert response.status_code == 200, (doc_format, response.text[:300])
        assert len(response.content) > 200, doc_format
        text = response.content.decode("utf-8", errors="ignore")
        for field_value in expected:
            assert field_value in text, (doc_format, field_value)
    for doc_format, magic in (("pdf", b"%PDF"), ("docx", b"PK")):
        response = client.post(f"/api/resumes/{resume_id}/export", json={"format": doc_format})
        assert response.status_code == 200, (doc_format, response.text[:300])
        assert response.content.startswith(magic), doc_format
        assert len(response.content) > 1000, doc_format


def test_render_html_of_v2_content_contains_fields(client):
    document = _manual_resume(client, V1_CONTENT)["content"]
    response = client.post("/api/resumes/render", json={"content": document, "template": "classic"})
    assert response.status_code == 200, response.text
    text = response.text
    assert "示例公司" in text and "负责订单服务重构" in text


def test_redact_preview_masks_pii_and_keeps_structure(client):
    created = _manual_resume(client, V1_CONTENT)
    response = client.post(f"/api/resumes/{created['id']}/redact", json={})
    assert response.status_code == 200, response.text
    redacted = response.json()
    assert redacted["version"] == 2
    header = {item["key"]: item["value"] for item in redacted["header"]["items"]}
    assert header["name"] == "***"
    assert header["phone"] == "***"
    assert header["email"] == "***"
    # 原文不被改动：再读详情仍是真实姓名（脱敏是导出时变换）。
    detail = client.get(f"/api/resumes/{created['id']}").json()
    assert "张示例" in values(detail["content"])


def test_field_placement_catalog_lists_builtin_and_custom_fields(client):
    created_field = client.post(
        "/api/profile/sections/projects/fields",
        json={
            "label": "导师姓名",
            "field_type": "single_line",
            "default_placement": "lead",
            "material_only": False,
        },
    )
    assert created_field.status_code == 201, created_field.text
    material = client.post(
        "/api/profile/sections/projects/fields",
        json={"label": "内部编号", "field_type": "single_line", "material_only": True},
    )
    assert material.status_code == 201, material.text

    response = client.get("/api/profile/field-placement-catalog?language=zh-CN")
    assert response.status_code == 200, response.text
    catalog = response.json()
    assert catalog["sections"]
    projects = next(item for item in catalog["sections"] if item["key"] == "projects")
    # 契约字段齐全（前端按这些字段渲染添加字段菜单与位置徽标）。
    assert projects["profile_section_key"] == "projects"
    assert projects["title_key"]
    builtin = next(field for field in projects["fields"] if field["key"] == "name")
    assert builtin["default_placement"] == "title" and builtin["is_builtin"] is True
    assert builtin["source_field_id"] == "projects.name"
    custom = next(
        field
        for field in projects["fields"]
        if field["source_field_id"] == created_field.json()["field_id"]
    )
    assert custom["default_placement"] == "lead" and custom["is_builtin"] is False
    hidden = next(
        field
        for field in projects["fields"]
        if field["source_field_id"] == material.json()["field_id"]
    )
    assert hidden["material_only"] is True and hidden["default_placement"] == "hidden"
    # 页眉目录：契约名 header_fields，10 个内置页眉字段。
    header_keys = [field["key"] for field in catalog["header_fields"]]
    assert {"name", "phone", "email", "job_intent"} <= set(header_keys)
    assert catalog["header"] == catalog["header_fields"]
