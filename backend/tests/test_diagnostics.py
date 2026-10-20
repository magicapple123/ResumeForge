# SPDX-License-Identifier: Apache-2.0
from app.services.diagnostics import diagnostic_snapshot, record_event, sanitize_text


def _last_event_named(events: list[dict], name: str) -> dict:
    return next(item for item in reversed(events) if item["event"] == name)


def test_diagnostics_redact_profile_like_values():
    record_event(
        "test.event",
        control_count=4,
        email="person@example.com",
        value="private value",
        title="网申页面",
    )

    events = diagnostic_snapshot(limit=20)["events"]
    event = _last_event_named(events, "test.event")

    assert event["details"]["control_count"] == 4
    assert event["details"]["email"] == "<redacted>"
    assert event["details"]["value"] == "<redacted>"
    assert event["details"]["title"] == "网申页面"


def test_sanitize_text_patterns_cover_common_pii():
    """模式表集中在 sanitize_text：手机号/邮箱/身份证/Bearer/sk- 全部命中。"""
    cases = {
        "联系电话 13800138000 请回电": "联系电话 <redacted> 请回电",
        "mailto:person@example.com": "mailto:<redacted>",
        "证件号 11010119900307867X 校验": "证件号 <redacted> 校验",
        "Authorization: Bearer abcdef123456 deadbeef": "Authorization: <redacted> deadbeef",
        "key=sk-abcdef1234567890 end": "key=<redacted> end",
    }
    for raw, expected in cases.items():
        cleaned, hits = sanitize_text(raw)
        assert cleaned == expected, raw
        assert hits >= 1


def test_sanitize_text_leaves_plain_text_and_counters_alone():
    """普通文本与数字计数不是个人信息，不应被误伤。"""
    cleaned, hits = sanitize_text("生成阶段 渲染完成，用时 1230ms")
    assert cleaned == "生成阶段 渲染完成，用时 1230ms"
    assert hits == 0


def test_content_level_pii_in_free_text_is_sanitized_with_audit():
    """键名 denylist 之外：自由文本里的联系方式/密钥也被清洗，并留审计计数。"""
    record_event(
        "test.freeform",
        path="/jobs/search?email=person@example.com",
        message="调用失败：13800138000 的令牌 sk-abcdef1234567890 失效",
    )

    events = diagnostic_snapshot(limit=50)["events"]
    event = _last_event_named(events, "test.freeform")
    audit = _last_event_named(events, "diagnostics.sanitized")

    exported = repr(events)
    assert "person@example.com" not in exported
    assert "13800138000" not in exported
    assert "sk-abcdef1234567890" not in exported
    assert event["details"]["path"] == "/jobs/search?email=<redacted>"
    assert "sk-abcdef1234567890" not in str(event["details"]["message"])
    assert "<redacted>" in event["details"]["message"]
    # 审计事件只有计数与事件名，不含任何原值。
    assert audit["details"]["count"] >= 3
    assert audit["details"]["event"] == "test.freeform"
    assert "13800138000" not in repr(audit)
