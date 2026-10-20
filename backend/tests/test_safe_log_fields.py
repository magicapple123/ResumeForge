# SPDX-License-Identifier: Apache-2.0
from time import perf_counter

from app.runtime.log_fields import safe_log_text
from app.runtime.log_redact import redact_sensitive_text


def test_control_characters_cannot_create_or_rewrite_log_lines():
    value = "fixture\r\nFAKE_ENTRY\x1b[31m\t\x00\x85\u2028\u2029"
    escaped = safe_log_text(value)
    assert "\n" not in escaped and "\r" not in escaped and "\x1b" not in escaped
    assert "\\nFAKE_ENTRY" in escaped
    assert all(ord(character) >= 32 for character in escaped)


def test_log_fields_are_bounded_and_obvious_secrets_are_redacted():
    assert "synthetic-secret" not in safe_log_text("token=synthetic-secret")
    assert len(safe_log_text("x" * 5_000)) == 512
    assert safe_log_text(123) == "123"


def test_repeated_unmatched_pydantic_markers_are_linear_and_do_not_lose_text():
    value = "input_value=" * 20_000
    started = perf_counter()
    assert redact_sensitive_text(value) == value
    assert perf_counter() - started < 2.0
