# SPDX-License-Identifier: Apache-2.0
"""422 参数校验：中文文案 + 不回显输入原文。

用户实测：AI 端点填空文本返回英文 Pydantic 原文（String should have at least 1
character），超长输入返回 422 时 detail.input 把整段原文回显。这里守三条性质：

1. 常见校验失败的 msg 是中文、可操作（说清哪里错、限制是多少）；
2. 响应里不带 input / 超长原文（用户正文不外泄到错误响应里）；
3. 既有自定义中文校验文案（如"请粘贴招聘信息…"）原样保留，不被全局翻译覆盖。

同时保证 status_code 仍为 422、detail 仍是数组（既有前端对数组形状的契约不变）。
"""

from __future__ import annotations

LONG_MARKER = "超长原文标记"


def _detail(response) -> list[dict]:
    body = response.json()
    assert isinstance(body.get("detail"), list), body
    return body["detail"]


def _resume_id(client) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "校验文案测试", "content": {"name": "张示例", "summary": "一段总结"}},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def test_empty_ai_text_returns_chinese_message(client):
    resume_id = _resume_id(client)
    response = client.post(
        f"/api/resumes/{resume_id}/writing/polish",
        json={"text": "", "style": "concise_tech"},
    )

    assert response.status_code == 422, response.text
    detail = _detail(response)
    assert detail, response.text
    message = detail[0]["msg"]
    assert "String should" not in message, message
    assert "至少" in message or "不能为空" in message, message
    assert "input" not in detail[0], "错误响应不应回显原始输入"


def test_oversize_ai_text_does_not_echo_the_content(client):
    resume_id = _resume_id(client)
    long_text = (LONG_MARKER + "负责会员增长与活动运营。") * 2000  # 远大于 20000 字上限
    assert len(long_text) > 20000

    response = client.post(
        f"/api/resumes/{resume_id}/writing/polish",
        json={"text": long_text, "style": "concise_tech"},
    )

    assert response.status_code == 422, response.text
    detail = _detail(response)
    message = detail[0]["msg"]
    assert "String should" not in message, message
    assert "20000" in message, message
    assert "不能超过" in message or "过长" in message, message
    # 不回显：响应体里不能出现用户正文（更不能不设上限地整段回显）。
    assert LONG_MARKER not in response.text
    assert len(response.content) < 2000, f"422 响应体过大：{len(response.content)} bytes"
    assert "input" not in detail[0]


def test_missing_field_returns_chinese_message(client):
    resume_id = _resume_id(client)
    response = client.post(f"/api/resumes/{resume_id}/writing/rewrite-field", json={})

    assert response.status_code == 422, response.text
    messages = [item["msg"] for item in _detail(response)]
    assert any("必填" in message for message in messages), messages
    assert all("Field required" not in message for message in messages), messages


def test_custom_chinese_validator_message_is_preserved(client):
    response = client.post("/api/jobs/parse-text", json={"text": ""})

    assert response.status_code == 422, response.text
    detail = _detail(response)
    messages = [item["msg"] for item in detail]
    # 自定义校验器写的中文文案是产品文案，不能被全局 Handler 覆盖成通用英文/套话。
    assert any("请粘贴招聘信息" in message for message in messages), messages
    assert all(not message.startswith("Value error,") for message in messages), messages


def test_extra_field_is_reported_in_chinese_without_input_echo(client):
    response = client.post(
        "/api/assistant/conversations",
        json={"title": "x", "unexpected_field": "should-not-be-echoed-" + "x" * 500},
    )

    assert response.status_code == 422, response.text
    detail = _detail(response)
    messages = " ".join(item["msg"] for item in detail)
    assert "不支持" in messages or "多余" in messages, messages
    assert "should-not-be-echoed" not in response.text
    assert all("input" not in item for item in detail)
