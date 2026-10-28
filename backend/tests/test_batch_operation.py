# SPDX-License-Identifier: Apache-2.0
"""设置页「批量操作」两套参数与简历中心批量导出。"""

from __future__ import annotations

import io
import zipfile

from app.models.resume import ResumeRecord


def _generation(**overrides):
    payload = {
        "template": "classic",
        "format_name": "",
        "font_scale": "standard",
        "page_limit": 1,
        "language": "zh-CN",
        "enhance": False,
        "enhancement_level": "balanced",
        "custom_instruction": "",
    }
    payload.update(overrides)
    return payload


def _export(**overrides):
    payload = {
        "template": "classic",
        "format_name": "",
        "font_scale": "standard",
        "page_limit": 1,
        "language": "zh-CN",
        "export_format": "md",
    }
    payload.update(overrides)
    return payload


def _resume(db_session, title: str = "后端开发-张三") -> ResumeRecord:
    record = ResumeRecord(
        title=title,
        content={"name": "张三", "summary": "3 年后端经验，做过高并发订单系统"},
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def test_batch_operation_sections_start_unconfigured(client):
    body = client.get("/api/settings/batch-operation").json()

    assert body["generation"]["configured"] is False
    assert body["export"]["configured"] is False


def test_generation_and_export_parameters_are_independent(client):
    response = client.put(
        "/api/settings/batch-operation/generation",
        json=_generation(template="modern", font_scale="large", enhance=True),
    )
    assert response.status_code == 200, response.text
    assert response.json()["configured"] is True

    body = client.get("/api/settings/batch-operation").json()
    assert body["generation"]["template"] == "modern"
    assert body["generation"]["enhance"] is True
    assert body["export"]["configured"] is False, "保存生成参数不应把导出也标成已配置"

    client.put(
        "/api/settings/batch-operation/export",
        json=_export(template="scholar", export_format="html"),
    )
    body = client.get("/api/settings/batch-operation").json()
    assert body["export"]["template"] == "scholar"
    assert body["export"]["export_format"] == "html"
    assert body["generation"]["template"] == "modern", "导出参数覆盖了生成参数"


def test_unknown_template_is_rejected_per_section(client):
    response = client.put(
        "/api/settings/batch-operation/export",
        json=_export(template="not-a-template"),
    )

    assert response.status_code == 400
    assert "版式模板" in response.json()["detail"]


def test_page_limit_is_validated(client):
    response = client.put(
        "/api/settings/batch-operation/generation", json=_generation(page_limit=9)
    )

    assert response.status_code == 422


def test_batch_export_requires_its_own_configuration(client, db_session):
    record = _resume(db_session)
    # 只有生成参数：导出仍然必须被拒绝。
    client.put("/api/settings/batch-operation/generation", json=_generation())

    response = client.post("/api/resumes/batch-export", json={"resume_ids": [record.id]})

    assert response.status_code == 409
    assert "批量导出" in response.json()["detail"]


def test_batch_export_returns_zip_with_one_file_per_resume(client, db_session):
    first = _resume(db_session, "后端开发-张三")
    second = _resume(db_session, "产品经理-张三")
    client.put("/api/settings/batch-operation/export", json=_export())

    response = client.post(
        "/api/resumes/batch-export",
        json={"resume_ids": [first.id, second.id]},
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["X-Batch-Exported"] == "2"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
    assert len(names) == 2
    assert all(name.endswith(".md") for name in names)


def test_batch_export_reports_missing_resume(client, db_session):
    record = _resume(db_session)
    client.put("/api/settings/batch-operation/export", json=_export())

    response = client.post(
        "/api/resumes/batch-export",
        json={"resume_ids": [record.id, 999999]},
    )

    assert response.status_code == 404
    assert "999999" in response.json()["detail"]


def test_legacy_flat_configuration_is_treated_as_unconfigured(client, db_session):
    """旧版单份扁平配置没有区分动作，升级后两节都应视为"还没配置"。"""
    from app.models.setting import AppSetting

    db_session.add(
        AppSetting(
            key="batch_operation_config",
            value='{"template": "classic", "export_format": "pdf", "updated_at": "2026-10-28"}',
        )
    )
    db_session.commit()

    body = client.get("/api/settings/batch-operation").json()
    assert body["generation"]["configured"] is False
    assert body["export"]["configured"] is False
