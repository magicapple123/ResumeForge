"""Bounded, redacted, single-line logging for operational metadata only."""

from .log_redact import redact_sensitive_text


def safe_log_text(value: object) -> str:
    """Do not use for resume/model text: log counts and IDs instead of such content."""
    text = redact_sensitive_text(str(value)[:512])
    escaped = "".join(
        f"\\u{ord(character):04x}"
        if (ord(character) < 32 and character not in "\r\n")
        or ord(character) in {127, 0x85, 0x2028, 0x2029}
        else character
        for character in text
    )
    return escaped.replace("\r", "\\r").replace("\n", "\\n")
