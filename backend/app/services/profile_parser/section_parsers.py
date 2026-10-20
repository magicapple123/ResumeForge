# SPDX-License-Identifier: Apache-2.0
"""教育、工作、校园、项目和奖项条目的解析。"""

import re

from .entry_blocks import (
    _block_labeled_value,
    _is_header_metadata_line,
    _parse_header,
    _split_entry_blocks,
)
from .entry_constants import _DATE_RE, _DEGREE_TERMS
from .entry_details import _detail_groups
from .entry_inference import _compact_header_fields, _find_date_range, _infer_unlabeled_header
from .normalization import _clean_line

# 校园经历的条目头常常是**单列**的「组织 + 职务」连写（如
# 「软件学院向阳工作室总负责人」「2301班团支书」）：从尾部职责词处拆开，
# 组织与角色才各自落位。只在校园分区的单列头部启用——多列头部本来就
# 有明确的角色列，不动。
_CAMPUS_ROLE_SUFFIX_RE = re.compile(
    r"^(?P<organization>.{2,60}?)"
    r"(?P<role>总负责人|负责人|团长|副团长|团支书|书记|部长|副部长|部员|"
    r"主席|副主席|会长|副会长|理事长|班长|副班长|委员|干事|队长|副队长|"
    r"组长|副组长|社长|副社长|成员|志愿者)$"
)


def _parse_education(lines: list[str]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for block in _split_entry_blocks(lines, "education"):
        parts, start, end = _parse_header(block[0])
        compact = _compact_header_fields(block[0], "education")
        details, _highlights, _tech, courses, achievements, gpa = _detail_groups(
            [line for line in block[1:] if not _is_header_metadata_line(line)]
        )
        school = (
            _block_labeled_value(block, "school")
            or compact.get("school", "")
            or (parts[0] if parts else "")
        )
        major = (
            _block_labeled_value(block, "major")
            or compact.get("major", "")
            or (parts[1] if len(parts) > 1 else "")
        )
        # 「软件工程专业/本科」这类写法会把量词带进专业名：去掉尾部"专业"，
        # 表单里直接可得"软件工程"。
        if major.endswith("专业") and len(major) > len("专业"):
            major = major[: -len("专业")]
        degree = (
            _block_labeled_value(block, "degree")
            or compact.get("degree", "")
            or next(
                (
                    part
                    for part in parts
                    if any(term.casefold() in part.casefold() for term in _DEGREE_TERMS)
                ),
                "",
            )
        )
        start, end = _find_date_range(
            block, compact.get("start_date", start), compact.get("end_date", end)
        )
        if not achievements and details:
            achievements = "\n".join(details)
        if school or major or degree or details:
            result.append(
                {
                    "school": school,
                    "major": major,
                    "degree": degree,
                    "start_date": start,
                    "end_date": end,
                    "gpa": gpa,
                    "courses": courses,
                    "achievements": achievements,
                    "reference_file_name": "",
                    "reference_content": "",
                }
            )
    return result


def _parse_experience(lines: list[str], campus: bool = False) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for block in _split_entry_blocks(lines, "campus" if campus else "experience"):
        parts, start, end = _parse_header(block[0])
        compact = _compact_header_fields(block[0], "experience")
        labeled_first = _block_labeled_value(block, "organization" if campus else "company")
        labeled_role = _block_labeled_value(block, "role")
        inferred_first = inferred_role = ""
        inferred_start = inferred_end = ""
        inferred_details: list[str] | None = None
        if (
            len(parts) <= 1
            and len(block) > 1
            and not labeled_first
            and not compact.get("first")
            and not labeled_role
            and not compact.get("role")
        ):
            (
                inferred_first,
                inferred_role,
                inferred_start,
                inferred_end,
                inferred_details,
            ) = _infer_unlabeled_header(block)
        detail_lines = (
            inferred_details
            if inferred_details is not None
            else [line for line in block[1:] if not _is_header_metadata_line(line)]
        )
        description, _highlights, _tech, _courses, _achievements, _gpa = _detail_groups(
            detail_lines
        )
        start, end = _find_date_range(
            block, compact.get("start_date", start), compact.get("end_date", end)
        )
        first = labeled_first or compact.get("first", "") or inferred_first
        first = first or (parts[0] if parts else "")
        role = labeled_role or compact.get("role", "") or inferred_role
        role = role or (parts[1] if len(parts) > 1 else "")
        if campus and not role and first and len(parts) <= 1:
            match = _CAMPUS_ROLE_SUFFIX_RE.match(first)
            if match:
                first = match.group("organization")
                role = match.group("role")
        if inferred_start and not start:
            start = inferred_start
        if inferred_end and not end:
            end = inferred_end
        if first or role or description:
            item = {
                "role": role,
                "start_date": start,
                "end_date": end,
                "description": "\n".join(description),
                "reference_file_name": "",
                "reference_content": "",
            }
            item["organization" if campus else "company"] = first
            result.append(item)
    return result


def _parse_projects(lines: list[str]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for block in _split_entry_blocks(lines, "project"):
        parts, start, end = _parse_header(block[0])
        compact = _compact_header_fields(block[0], "project")
        labeled_name = _block_labeled_value(block, "project")
        labeled_role = _block_labeled_value(block, "role")
        inferred_name = inferred_role = ""
        inferred_start = inferred_end = ""
        inferred_details: list[str] | None = None
        if (
            len(parts) <= 1
            and len(block) > 1
            and not labeled_name
            and not compact.get("first")
            and not labeled_role
            and not compact.get("role")
        ):
            (
                inferred_name,
                inferred_role,
                inferred_start,
                inferred_end,
                inferred_details,
            ) = _infer_unlabeled_header(block)
        detail_lines = (
            inferred_details
            if inferred_details is not None
            else [line for line in block[1:] if not _is_header_metadata_line(line)]
        )
        description, highlights, tech_stack, _courses, _achievements, _gpa = _detail_groups(
            detail_lines
        )
        start, end = _find_date_range(
            block, compact.get("start_date", start), compact.get("end_date", end)
        )
        name = (
            labeled_name or compact.get("first", "") or inferred_name or (parts[0] if parts else "")
        )
        role = (
            labeled_role
            or compact.get("role", "")
            or inferred_role
            or (parts[1] if len(parts) > 1 else "")
        )
        if inferred_start and not start:
            start = inferred_start
        if inferred_end and not end:
            end = inferred_end
        if name or role or description or highlights:
            result.append(
                {
                    "name": name,
                    "role": role,
                    "start_date": start,
                    "end_date": end,
                    "tech_stack": "、".join(tech_stack),
                    "description": "\n".join(description),
                    "highlights": "\n".join(highlights),
                    "reference_file_name": "",
                    "reference_content": "",
                }
            )
    return result


def _parse_awards(lines: list[str]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for block in _split_entry_blocks(lines, "award"):
        clean = " ".join(_clean_line(line) for line in block if line).strip()
        if not clean:
            continue
        date_match = _DATE_RE.search(clean)
        date = date_match.group(0) if date_match else ""
        header = _DATE_RE.sub("", clean, count=1).strip(" -—–|｜丨·") if date else clean
        parts, _start, _end = _parse_header(header)
        name = parts[0] if parts else header
        description = "、".join(parts[1:]) if len(parts) > 1 else ""
        result.append({"name": name, "date": date, "description": description})
    return result
