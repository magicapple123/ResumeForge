# SPDX-License-Identifier: Apache-2.0
"""W19 文件名规则：导出预设里的命名模板 → 安全文件名（单一实现）。

- 未知 token 在**保存预设时**校验（422）；导出时只渲染、fail-soft（不因命名挂掉导出）。
- 路径分隔符/非法字符走既有 sanitize_filename；扩展名由格式决定，用户不可控制。
- 未配置命名时退回既有 build_filename（旧客户端/未配置用户零变化）。
"""

from __future__ import annotations

import re
from datetime import datetime

from ...schemas.resume import ResumeContent
from ...services.exporter import build_filename, sanitize_filename

NAMED_TOKENS: tuple[str, ...] = (
    "name",
    "company",
    "job_title",
    "template",
    "date",
    "revision",
    "language",
)
DEFAULT_NAMING = "{name}-{job_title}-{date}"
MAX_FILENAME_STEM = 120
_TOKEN_RE = re.compile(r"\{([a-zA-Z_]+)\}")


class NamingError(ValueError):
    """命名模板不合法（保存预设时拒绝）。"""


def validate_naming(pattern: str) -> str:
    cleaned = (pattern or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) > MAX_FILENAME_STEM * 2:
        raise NamingError("命名模板过长")
    unknown = sorted({match.group(1) for match in _TOKEN_RE.finditer(cleaned)} - set(NAMED_TOKENS))
    if unknown:
        raise NamingError(
            "命名模板含未知占位符：" + "、".join("{" + name + "}" for name in unknown)
        )
    return cleaned


def _token_values(record) -> dict[str, str]:  # noqa: ANN001 - ORM 记录
    job_title = getattr(record, "job_title", "") or ""
    return {
        "name": "",
        "company": getattr(record, "company", "") or "",
        "job_title": job_title,
        "template": getattr(record, "template", "") or "",
        "date": datetime.now().strftime("%Y%m%d"),
        "revision": str(int(getattr(record, "revision", 0) or 0)),
        "language": getattr(record, "language", "") or "",
    }


def render_filename(
    pattern: str,
    *,
    resume: ResumeContent,
    record,
    doc_format: str,
) -> str:
    """渲染命名模板；未配置时保持既有 build_filename 行为。"""
    if not pattern:
        return build_filename(resume, f".{doc_format}")
    values = _token_values(record)
    values["name"] = resume.name or values["name"]
    stem = pattern
    for token, value in values.items():
        stem = stem.replace("{" + token + "}", value)
    safe_stem = sanitize_filename(stem.strip())[:MAX_FILENAME_STEM].strip(". ")
    # 落盘名的安全底线：不能以点结尾、不能出现 ..（会被资产安全校验/路径判断视为可疑）。
    while ".." in safe_stem:
        safe_stem = safe_stem.replace("..", ".")
    safe_stem = safe_stem.strip(". ") or "resume"
    return f"{safe_stem}.{doc_format}"


__all__ = [
    "DEFAULT_NAMING",
    "MAX_FILENAME_STEM",
    "NAMED_TOKENS",
    "NamingError",
    "render_filename",
    "validate_naming",
]
