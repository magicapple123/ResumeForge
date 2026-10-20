# SPDX-License-Identifier: Apache-2.0
"""Validate browser navigation input independently from process lifecycle handling."""

from urllib.parse import urlsplit


class BrowserError(Exception):
    """A browser-domain error whose message may be presented to the local user."""


def validated_browser_url(value: str | None) -> str:
    """Only explicit web URLs or the application-controlled blank page are accepted."""
    if value is None or value == "" or value == "about:blank":
        return "about:blank"
    if (
        not isinstance(value, str)
        or len(value) > 8192
        or any(ord(char) < 32 or ord(char) == 127 or char == "\\" for char in value)
    ):
        raise BrowserError("浏览器地址无效，请使用完整的 HTTP 或 HTTPS 网页地址")
    clean = value.strip()
    try:
        parsed = urlsplit(clean)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValueError("invalid web address")
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError("invalid port")
    except ValueError as exc:
        raise BrowserError("浏览器地址无效，请使用完整的 HTTP 或 HTTPS 网页地址") from exc
    return clean
