# SPDX-License-Identifier: Apache-2.0
"""W11 统一检查：三层合并、分级映射、快照一致性、稳定 id。

文件命名：`tests/test_preflight.py` 已被"启动完整性检查"占用（另一个功能），本文件按被测模块
前缀命名，避免覆盖既有用例（与 test_resume_document_save.py 同一条命名理由）。

这组用例刻意走**真实 HTTP 端点**（而不是直接调 service）：W11 的价值一半在编排——
正文覆盖、版式覆盖、快照指纹、层选择都只在路由层才能验证。
"""

from __future__ import annotations

BASE = {
    "name": "张示例",
    "job_intent": "后端工程师",
    "summary": "五年后端开发经验",
    "experience": [
        {
            "company": "示例科技",
            "role": "后端工程师",
            "start_date": "2020-01",
            "end_date": "至今",
            "description": ["负责订单系统重构"],
        }
    ],
}


def _create(client, content: dict | None = None) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"job_id": None, "content": content or BASE, "draft": False},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _preflight(client, record_id: int, **body):
    return client.post(f"/api/resumes/{record_id}/preflight", json=body)


def test_content_layer_flags_incomplete_marker_as_blocker(client):
    content = {**BASE, "summary": "负责【待补：具体指标】的系统重构"}
    record_id = _create(client, content)
    response = _preflight(client, record_id, layers=["content"])
    assert response.status_code == 200, response.text
    payload = response.json()
    issues = [issue for issue in payload["issues"] if issue["code"] == "incomplete_marker"]
    assert issues, payload["issues"]
    assert issues[0]["severity"] == "blocker"
    assert issues[0]["locator"]["scope"] == "section"
    assert issues[0]["locator"]["section"] == "summary"
    assert payload["summary"]["blocker"] >= 1
    assert payload["layers_run"] == ["content"]


def test_issue_id_is_stable_across_requests(client):
    content = {**BASE, "summary": "负责【待补：指标】的重构"}
    record_id = _create(client, content)
    first = _preflight(client, record_id, layers=["content"]).json()
    second = _preflight(client, record_id, layers=["content"]).json()
    assert [issue["id"] for issue in first["issues"]] == [issue["id"] for issue in second["issues"]]


def test_snapshot_changes_with_content_and_layout(client):
    record_id = _create(client)
    base = _preflight(client, record_id, layers=["content"]).json()
    changed = _preflight(
        client,
        record_id,
        layers=["content"],
        content={**BASE, "summary": "改过的总结"},
    ).json()
    assert changed["snapshot"]["content_sha256"] != base["snapshot"]["content_sha256"]
    layout_changed = _preflight(
        client, record_id, layers=["content"], layout={"page_limit": 2}
    ).json()
    assert (
        layout_changed["snapshot"]["render_config_sha256"]
        != base["snapshot"]["render_config_sha256"]
    )
    assert layout_changed["snapshot"]["page_limit"] == 2


def test_measure_overflow_maps_to_blocker(client):
    record_id = _create(client)
    payload = _preflight(
        client,
        record_id,
        layers=["layout"],
        measure={"used_height": 297.0, "page_content_height": 260.0},
        layout={"page_limit": 1},
    ).json()
    codes = {issue["code"] for issue in payload["issues"]}
    assert "layout_overflow" in codes
    overflow = [i for i in payload["issues"] if i["code"] == "layout_overflow"][0]
    assert overflow["severity"] == "blocker"
    assert overflow["fix"]["action"] == "open_layout_analyze"


def test_layout_layer_without_measure_says_so_instead_of_passing(client):
    record_id = _create(client)
    payload = _preflight(client, record_id, layers=["layout"]).json()
    codes = {issue["code"] for issue in payload["issues"]}
    assert "layout_no_measure" in codes
    assert "layout_overflow" not in codes


def test_risk_layer_without_model_is_not_reported_as_pass(client):
    record_id = _create(client)
    payload = client.post(
        f"/api/resumes/{record_id}/preflight",
        json={"layers": ["content", "risk"]},
    ).json()
    codes = {issue["code"] for issue in payload["issues"]}
    assert "model_not_configured" in codes
    assert "risk" in payload["layers_run"]


def test_product_layer_extracts_machine_text_and_keeps_hidden_out(client):
    content = {
        **BASE,
        "experience": [
            {
                "company": "示例科技",
                "role": "后端工程师",
                "description": ["负责订单系统重构"],
            },
            {
                "company": "隐藏公司",
                "role": "秘密岗位",
                "description": ["不该出现在产物里的隐藏内容"],
                "hidden": True,
            },
        ],
    }
    record_id = _create(client, content)
    response = _preflight(client, record_id, layers=["layout", "product"])
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["machine_text"], "产物层应当抽到至少一页文本"
    joined = "".join(page["text"] for page in payload["machine_text"])
    assert "负责订单系统重构" in joined
    assert "隐藏公司" not in joined
    assert "不该出现在产物里的隐藏内容" not in joined
    codes = {issue["code"] for issue in payload["issues"]}
    assert "product_hidden_leak" not in codes
    assert payload["font_coverage"] is not None


def test_ats_severity_mapping_uses_verify_not_blocker(client):
    record_id = _create(client)
    payload = _preflight(
        client,
        record_id,
        layers=["content"],
        jd_text="需要 Kubernetes 与 Go 语言经验",
    ).json()
    ats_issues = [issue for issue in payload["issues"] if issue["code"].startswith("ats_")]
    assert ats_issues, payload["issues"]
    assert all(issue["severity"] in {"verify", "suggestion"} for issue in ats_issues)
    assert payload["disclaimer"] == "本地规则估计，不代表真实 ATS 解析结果"


def test_capabilities_matrix_is_shipped_but_not_faked(client):
    record_id = _create(client)
    payload = _preflight(client, record_id, layers=["content"]).json()
    assert payload["capabilities"]["pdf"]["italic"] == "approx"
    assert payload["capabilities"]["pdf"]["link_clickable"] == "unsupported"
    assert payload["capabilities"]["docx"]["italic"] == "supported"


# ===== R03 ①：关键链接失效（blocker） =====


def _codes(payload: dict) -> set[str]:
    return {issue["code"] for issue in payload["issues"]}


def test_invalid_personal_website_is_a_blocker_with_locator(client):
    content = {
        **BASE,
        "personal_website": "portfolio.example.com/me",
        "github": "https://github.com/example",
    }
    record_id = _create(client, content)
    payload = _preflight(client, record_id, layers=["content"]).json()
    links = [issue for issue in payload["issues"] if issue["code"] == "link_invalid"]
    assert links, payload["issues"]
    website = next(issue for issue in links if issue["locator"]["field"] == "personal_website")
    assert website["severity"] == "blocker"
    assert website["locator"]["scope"] == "field"
    assert website["fix"]["action"] == "focus_field"
    assert website["title_key"] == "preflight.issue.link_invalid"
    # 合法链接（https）不报。
    assert not [issue for issue in links if issue["locator"]["field"] == "github"]


def test_link_scheme_outside_whitelist_is_a_blocker(client):
    record_id = _create(
        client,
        {**BASE, "personal_website": "ftp://example.com/resume"},
    )
    payload = _preflight(client, record_id, layers=["content"]).json()
    issue = next(
        item for item in payload["issues"] if item["code"] == "link_scheme_unsupported"
    )
    assert issue["severity"] == "blocker"
    assert "ftp" in issue["detail"]


def test_project_description_link_is_located_at_the_point(client):
    content = {
        **BASE,
        "projects": [
            {
                "name": "示例项目",
                "role": "开发",
                "description": ["项目地址：javascript:alert(1)"],
            }
        ],
    }
    record_id = _create(client, content)
    payload = _preflight(client, record_id, layers=["content"]).json()
    issue = next(
        item for item in payload["issues"] if item["code"] == "link_scheme_unsupported"
    )
    assert issue["locator"]["section"] == "projects"
    assert issue["locator"]["scope"] in {"object", "point"}
    assert issue["locator"]["path"] == "projects.0.description.0"


def test_valid_links_and_hidden_entries_do_not_raise(client):
    content = {
        **BASE,
        "personal_website": "https://portfolio.example.com/me",
        "github": "https://github.com/example",
        "projects": [
            {"name": "可见项目", "description": ["见 https://example.com/demo 与 mailto:me@example.com"]},
            {
                "name": "隐藏项目",
                "description": ["坏链接 ftp://example.com/x"],
                "hidden": True,
            },
        ],
    }
    record_id = _create(client, content)
    payload = _preflight(client, record_id, layers=["content"]).json()
    codes = _codes(payload)
    assert "link_invalid" not in codes
    assert "link_scheme_unsupported" not in codes


# ===== R03 ②：联系方式脱敏状态（verify，只提示不阻断） =====


def test_contact_masking_hint_only_for_export_purpose(client):
    content = {**BASE, "phone": "13800000000", "email": "me@example.com"}
    record_id = _create(client, content)
    # 编辑态不提示。
    edit_payload = _preflight(client, record_id, layers=["content"]).json()
    assert "contact_masking_off" not in _codes(edit_payload)
    # 导出态且未开脱敏：verify 提示（不阻断）。
    export_payload = _preflight(
        client, record_id, layers=["content"], purpose="export"
    ).json()
    issue = next(
        item
        for item in export_payload["issues"]
        if item["code"] == "contact_masking_off"
    )
    assert issue["severity"] == "verify"
    assert issue["fix"]["action"] == "open_settings"
    assert "phone" in issue["evidence"]
    # 开启脱敏后不再提示。
    redacted = _preflight(
        client, record_id, layers=["content"], purpose="export", redact=True
    ).json()
    assert "contact_masking_off" not in _codes(redacted)


def test_contact_found_in_body_text_still_hints(client):
    content = {**BASE, "summary": "联系方式 13800000000，欢迎联系"}
    record_id = _create(client, content)
    payload = _preflight(client, record_id, layers=["content"], purpose="export").json()
    issue = next(
        item for item in payload["issues"] if item["code"] == "contact_masking_off"
    )
    assert issue["evidence"]


def test_export_without_contact_does_not_hint(client):
    record_id = _create(client)
    payload = _preflight(client, record_id, layers=["content"], purpose="export").json()
    assert "contact_masking_off" not in _codes(payload)


# ===== D20：导出前核对摘要（purpose=export） =====


def _record(client, record_id: int) -> dict:
    response = client.get(f"/api/resumes/{record_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_edit_purpose_has_no_export_summary_and_accepts_export_fields(client):
    record_id = _create(client)
    payload = _preflight(
        client,
        record_id,
        layers=["content"],
        watermark="内部",
        redact=False,
        formats=["pdf"],
        strict_revision=False,
        allow_incomplete=False,
    ).json()
    assert payload["export_summary"] is None


def test_export_summary_reports_target_revision_and_hidden_count(client):
    job = client.post(
        "/api/jobs",
        json={"title": "后端开发工程师", "company": "示例公司"},
    ).json()
    content = {
        **BASE,
        "experience": [
            {"company": "示例科技", "role": "后端工程师", "description": ["负责订单重构"]},
            {
                "company": "隐藏公司",
                "role": "秘密岗位",
                "description": ["不该出现在产物里"],
                "hidden": True,
            },
        ],
    }
    created = client.post(
        "/api/resumes/manual",
        json={"job_id": job["id"], "content": content, "draft": False},
    )
    assert created.status_code == 201, created.text
    record = created.json()
    renamed = client.patch(f"/api/resumes/{record['id']}", json={"title": "后端版"})
    assert renamed.status_code == 200, renamed.text
    current = _record(client, record["id"])
    payload = _preflight(
        client,
        record["id"],
        layers=["content"],
        purpose="export",
        formats=["pdf"],
        resume_revision=current["revision"] + 1,
    ).json()
    summary = payload["export_summary"]
    assert summary["target_company"] == "示例公司"
    assert summary["target_job_title"] == "后端开发工程师"
    assert summary["resume_title"] == "后端版"
    assert summary["contact_present"] is False
    assert summary["document_mode"] == "resume"
    assert summary["revision"] == current["revision"]
    assert summary["revision_changed"] is True
    assert summary["hidden_count"] == 1


def test_export_summary_uses_the_same_draft_content_and_snapshot(client):
    record_id = _create(client, {**BASE, "phone": "13800000000"})
    draft = {**BASE, "summary": "草稿里的总结", "hidden": None}
    payload = _preflight(
        client,
        record_id,
        layers=["content"],
        purpose="export",
        content=draft,
    ).json()
    summary = payload["export_summary"]
    # 联系方式判断取自同一份草稿正文（草稿里没有电话）——不能读记录里的旧正文。
    assert summary["contact_present"] is False
    # 快照 content_sha256 也必须来自草稿：改草稿 → 快照跟着变。
    changed = _preflight(
        client,
        record_id,
        layers=["content"],
        purpose="export",
        content={**BASE, "summary": "另一份草稿"},
    ).json()
    assert changed["snapshot"]["content_sha256"] != payload["snapshot"]["content_sha256"]


def test_export_snapshot_fingerprint_matches_the_export_pipeline(client):
    """D20 的 render_config_sha256 必须与导出首格式的指纹逐字一致（同一快照）。"""
    from app.database import SessionLocal
    from app.models.resume import ResumeRecord
    from app.services.export_pipeline import (
        ExportRequest as PipelineRequest,
    )
    from app.services.export_pipeline import (
        render_config_fingerprint,
    )
    from app.services.resume import export_bundle

    record_id = _create(client)
    body = {
        "purpose": "export",
        "layers": ["content"],
        "formats": ["pdf"],
        "watermark": "内部资料",
        "redact": True,
        "include_photo": False,
        "page_limit": 2,
        "font_scale": "small",
        "language": "en-US",
        "format_config": {"page_padding": 12},
    }
    payload = _preflight(client, record_id, **body).json()
    db = SessionLocal()
    try:
        record = db.get(ResumeRecord, record_id)
        context = export_bundle._context(db, record)
        expected = render_config_fingerprint(
            PipelineRequest(
                format="pdf",
                watermark="内部资料",
                redact=True,
                page_limit=2,
                font_scale="small",
                language="en-US",
                format_config={"page_padding": 12},
                include_photo=False,
            ),
            context,
        )
    finally:
        db.close()
    assert payload["snapshot"]["render_config_sha256"] == expected
    assert payload["snapshot"]["page_limit"] == 2
    assert payload["snapshot"]["font_scale"] == "small"
    assert payload["snapshot"]["language"] == "en-US"


def test_export_variant_id_uses_the_variant_snapshot(client):
    record_id = _create(client)
    variant = client.post(
        f"/api/resumes/{record_id}/variants", json={"name": "后端岗变体"}
    )
    assert variant.status_code == 201, variant.text
    variant_id = variant.json()["id"]

    baseline = _preflight(client, record_id, layers=["content"], purpose="export").json()
    with_variant = _preflight(
        client,
        record_id,
        layers=["content"],
        purpose="export",
        variant_id=variant_id,
    ).json()
    assert with_variant["export_summary"]["revision"] == baseline["export_summary"]["revision"]
    # 新建变体派生自当前正文：同一份内容 → 快照内容哈希一致（解析走了变体自己的内容）。
    assert (
        with_variant["snapshot"]["content_sha256"]
        == baseline["snapshot"]["content_sha256"]
    )

    other = _create(client)
    missing = _preflight(
        client, other, layers=["content"], purpose="export", variant_id=variant_id
    )
    assert missing.status_code == 404
