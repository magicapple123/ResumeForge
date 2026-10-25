# SPDX-License-Identifier: Apache-2.0
"""跨工具域共享的 helper 与常量。"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from ...models.job import Job
from ...schemas.profile import ProfileOut
from ..profile.profile_reader import load_all_consumed_profile
from ..profile.profile_service import (
    legacy_profile_has_entries,
    project_legacy_profile,
    project_legacy_profile_from_consumed,
)

logger = logging.getLogger(__name__)

MAX_JOB_RESULT_CHARS = 6_000
MAX_PROFILE_RESULT_CHARS = 8_000
DEFAULT_LIST_LIMIT = 20
MAX_LIST_LIMIT = 50

MAX_ASSISTANT_SKILL_FILE_CHARS = 20_000
MAX_ASSISTANT_SKILL_TOTAL_CHARS = 60_000
MAX_ASSISTANT_SKILL_FILES = 10

PROFILE_EDITABLE_FIELDS = (
    "name",
    "gender",
    "birth_year",
    "phone",
    "email",
    "city",
    "target_city",
    "job_intent",
    "personal_website",
    "github",
    "summary",
)


def _trim(value: str, limit: int) -> str:
    return value if len(value) <= limit else f"{value[:limit].rstrip()}…"


def int_argument(arguments: dict[str, Any], key: str, error: str) -> int:
    """把工具参数里的整数 id 收成 `int`，缺失或不是数字时抛 `error`（中文提示）。

    工具参数是模型生成的 JSON：同一个 id 既可能给成 `"12"` 也可能给成 `12`，缺失时是
    `None`。三者要落到同一个出口——"先用 list_xxx 查"这句提示对模型来说是唯一有用的
    下一步。写成一处实现，免得二十个工具各抄一份 `try: int(...) except ...`。
    """
    value = arguments.get(key)
    if value is None:
        raise ValueError(error)
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(error) from None


# 读简历时留给正文的预算（从总预算里扣掉元信息与版式那部分）。
_RESUME_CONTENT_BUDGET = MAX_JOB_RESULT_CHARS - 1_500
# 正文过长时按这个顺序**整段**省略（越靠前越先丢）：荣誉 → 校园经历 → 技能 → 项目 → 教育。
# 经历放最后：它通常最能回答"这个人做过什么"。
_RESUME_CONTENT_DROP_ORDER = ("awards", "campus_experience", "skills", "projects", "education")


def _resume_content_for_model(content: dict, budget: int) -> tuple[dict, list[str]]:
    """把简历正文压进预算：超出时**整段**省略次要段落，并返回省略了哪些。

    刻意不是"从中间截断字符串"：那会让模型收到一段缺了结尾的 JSON，进而以为简历就这么多
    内容，回答时漏掉后面的经历——而用户完全看不出来。整段省略 + 明说省略了哪几段，
    模型至少知道自己没看全，可以再单独去查。
    """
    trimmed = dict(content)
    dropped: list[str] = []
    for key in _RESUME_CONTENT_DROP_ORDER:
        if len(json.dumps(trimmed, ensure_ascii=False)) <= budget:
            break
        if key in trimmed:
            trimmed.pop(key)
            dropped.append(key)
    return trimmed, dropped


def _job_brief(job: Job) -> dict:
    return {
        "id": job.id,
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "salary": job.salary,
        "status": job.status,
        "favorite": job.favorite,
        "posted_at": job.posted_at,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }


def _load_profile(db: Session) -> ProfileOut | None:
    """read-modify-write 用的旧形状全量快照（含 hidden/未映射字段的值）。

    工具写入口是旧 PUT 协议：拿不到隐藏字段的值，"只改一个字段"的 read-modify-write
    就会把隐藏值清空（R-67 要求值保留）。所以这里读**编辑视图**（project_legacy_profile）
    而不是消费快照；它不是发给模型的内容，不构成 AI 取数。
    """
    if not legacy_profile_has_entries(db):
        return None
    return project_legacy_profile(db)


def _profile_snapshot(db: Session) -> ProfileOut | None:
    """AI 可读资料快照：消费 DTO（hidden 已剔除）+ 不按组限制（R-64）→ 旧形状。"""
    if not legacy_profile_has_entries(db):
        return None
    return project_legacy_profile_from_consumed(load_all_consumed_profile(db))
