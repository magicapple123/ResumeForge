# SPDX-License-Identifier: Apache-2.0
"""Native document facts shared by ATS and risk rules; never a v1 projection."""

from .document_catalog import resolve_section_title
from .document_view import field_text, iter_entries

_TITLES = {
    "education": "school",
    "experience": "company",
    "campus_experience": "organization",
    "projects": "name",
}
_RISK_LABELS = {
    "education": "教育经历",
    "experience": "实习/工作",
    "campus_experience": "校园经历",
    "projects": "项目经历",
}


def body_points(document: dict) -> list[tuple[str, str]]:
    """Read visible prose with a location; include custom and research sections."""
    result: list[tuple[str, str]] = []
    section_by_key = {s.get("key"): s for s in document.get("sections") or []}
    for key, entry in iter_entries(document):
        section = section_by_key.get(key) or {}
        if entry.get("hidden") or section.get("kind") == "inline":
            continue
        label = _RISK_LABELS.get(key) or resolve_section_title(key, section.get("title") or "")
        title = field_text(entry, _TITLES.get(key, "name"), "未命名")
        location = label if section.get("kind") == "text" else f"{label}「{title}」"
        for item in entry.get("items") or []:
            if item.get("hidden") or item.get("placement") == "hidden":
                continue
            values: list[str] = []
            if item.get("kind") == "text":
                values = [item.get("text") or ""]
            elif item.get("kind") == "field" and item.get("placement") == "body":
                values = [item.get("value") or ""]
            elif item.get("kind") == "list" and item.get("key") in {
                "description",
                "achievements",
                "highlights",
                "outcomes",
            }:
                hidden = set(item.get("hidden_values") or [])
                values = [value for value in item.get("values") or [] if value not in hidden]
            result.extend((location, str(value).strip()) for value in values if str(value).strip())
    return result


def dated_records(document: dict) -> list[tuple[str, str, str]]:
    """Read canonical date ranges while preserving established issue locations."""
    labels = {
        "education": "教育经历",
        "experience": "工作经历",
        "campus_experience": "校园经历",
        "projects": "项目经历",
    }
    result: list[tuple[str, str, str]] = []
    for key, entry in iter_entries(document):
        if key not in labels or entry.get("hidden"):
            continue
        title = field_text(entry, _TITLES[key], "未命名")
        period = field_text(entry, "period")
        start, _, end = period.partition("|")
        if not period:
            start, end = field_text(entry, "start_date"), field_text(entry, "end_date")
        if end.lower() in {"present", "now"}:
            end = "至今"
        result.append((f"{labels[key]}「{title}」", start, end))
    return result
