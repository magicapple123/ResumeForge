"""应用内可保留部分精度的日期规范化。"""
from __future__ import annotations

import calendar
import re

_DATE_RE = re.compile(r"^(?P<year>\d{4})(?:-(?P<month>\d{1,2})(?:-(?P<day>\d{1,2}))?)?$")
_ONGOING = frozenset({"至今", "现在", "目前", "在职", "在读", "present", "now", "current"})


def normalize_partial_date(value: str | None) -> str:
    """统一为 ``YYYY``、``YYYY-MM``、``YYYY-MM-DD`` 或 ``至今``。

    不能确认含义的旧值原样保留，避免历史资料因为一次保存被静默改坏；
    但所有可识别的日期都会在写入和读取边界统一成短横线格式。
    """
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.casefold() in _ONGOING:
        return "至今"

    normalized = (
        raw.replace("年", "-")
        .replace("月", "-")
        .replace("日", "")
        .replace("/", "-")
        .replace(".", "-")
    )
    normalized = re.sub(r"\s+", "", normalized).strip("-")
    match = _DATE_RE.fullmatch(normalized)
    if match is None:
        return raw

    year = int(match.group("year"))
    month_text = match.group("month")
    day_text = match.group("day")
    if year < 1:
        return raw
    if month_text is None:
        return f"{year:04d}"

    month = int(month_text)
    if not 1 <= month <= 12:
        return raw
    if day_text is None:
        return f"{year:04d}-{month:02d}"

    day = int(day_text)
    if not 1 <= day <= calendar.monthrange(year, month)[1]:
        return raw
    return f"{year:04d}-{month:02d}-{day:02d}"


__all__ = ["normalize_partial_date"]
