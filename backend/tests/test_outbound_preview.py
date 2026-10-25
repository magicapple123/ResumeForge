# SPDX-License-Identifier: Apache-2.0
"""R04 外发前预览：只展示、不落库、不写日志；密钥检测只给 boolean。

隐私边界的验证方式：请求前后表行数不变 + caplog 里不出现正文标记 + 响应无独立秘钥字段。
"""

from __future__ import annotations

import logging

from app.models.llm_usage import LLMUsageRecord
from app.models.provenance import ResumeSource, ResumeSourceRevision
from app.schemas.outbound import MAX_PREVIEW_BODY_CHARS


def _request(body: str = "把这段用户资料发给模型：示例项目经历", **overrides) -> dict:
    payload = {
        "target_service": "OpenAI 兼容服务",
        "material_categories": ["岗位描述", "个人资料"],
        "attachment_types": ["txt"],
        "excluded_fields": ["phone", "email", "api_key"],
        "fetch_pages": True,
        "body": body,
    }
    payload.update(overrides)
    return payload


def test_preview_reports_what_leaves_the_machine(client):
    body = "R01-OUTBOUND-MARKER 把这段资料发出去"
    response = client.post("/api/outbound/preview", json=_request(body))

    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["target_service"] == "OpenAI 兼容服务"
    assert preview["material_categories"] == ["岗位描述", "个人资料"]
    assert preview["attachment_types"] == ["txt"]
    assert preview["excluded_fields"] == ["phone", "email", "api_key"]
    assert preview["fetch_pages"] is True
    assert preview["body_preview"] == body
    assert preview["body_chars"] == len(body)
    assert preview["body_truncated"] is False
    assert len(preview["body_sha256"]) == 64
    assert preview["secret_leak_detected"] is False
    # 结构性承诺：正文只在响应里，不存在"已保存"状态。
    assert preview["persistence"] == "memory_only"


def test_secret_leak_is_flagged_without_echoing_a_second_copy(client):
    body = "配置：api_key=sk-live-0123456789abcdef，password=hunter2hunter2"
    response = client.post("/api/outbound/preview", json=_request(body))

    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["secret_leak_detected"] is True
    # 只给 boolean：响应里没有单独的 leaked_value / matches 字段。
    assert "leaked_value" not in preview
    assert "matches" not in preview


def test_preview_truncates_long_body_but_keeps_full_hash(client):
    body = "x" * (MAX_PREVIEW_BODY_CHARS + 500)
    response = client.post("/api/outbound/preview", json=_request(body))

    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["body_truncated"] is True
    assert len(preview["body_preview"]) == MAX_PREVIEW_BODY_CHARS
    assert preview["body_chars"] == len(body)


def test_preview_does_not_persist_or_log_the_body(client, db_session, caplog):
    marker = "R04-NO-PERSIST-MARKER-UNIQUE"
    before = (
        db_session.query(LLMUsageRecord).count(),
        db_session.query(ResumeSource).count(),
        db_session.query(ResumeSourceRevision).count(),
    )
    with caplog.at_level(logging.DEBUG):
        response = client.post("/api/outbound/preview", json=_request(marker))
    after = (
        db_session.query(LLMUsageRecord).count(),
        db_session.query(ResumeSource).count(),
        db_session.query(ResumeSourceRevision).count(),
    )

    assert response.status_code == 200
    assert before == after
    assert marker not in caplog.text


def test_preview_request_validation(client):
    assert client.post("/api/outbound/preview", json=_request(target_service="")).status_code == 422
    too_many = dict(_request())
    too_many["material_categories"] = [f"c{index}" for index in range(21)]
    assert client.post("/api/outbound/preview", json=too_many).status_code == 422
    extra = dict(_request())
    extra["unknown_field"] = 1
    assert client.post("/api/outbound/preview", json=extra).status_code == 422

def test_preview_does_not_persist_usage_or_echo_pricing_config(client, db_session, caplog):
    """R04：外发预览不产生用量记录，也不回显单价配置（预览只回答"发什么"）。"""
    client.put(
        "/api/usage/pricing",
        json={"input_per_1k": 0.123456, "output_per_1k": 0.654321, "currency": "USD"},
    )
    before = db_session.query(LLMUsageRecord).count()
    marker = "R04-PREVIEW-PRICING-MARKER"
    with caplog.at_level(logging.DEBUG):
        response = client.post("/api/outbound/preview", json=_request(marker))
    assert response.status_code == 200, response.text
    preview = response.json()
    for key in ("cost", "estimated", "pricing", "price_per_1k", "usage"):
        assert key not in preview
    assert "0.123456" not in response.text
    assert db_session.query(LLMUsageRecord).count() == before
    assert marker not in caplog.text
