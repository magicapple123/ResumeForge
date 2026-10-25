# SPDX-License-Identifier: Apache-2.0
"""W09 内容精简候选的本地相关性提示（只读、确定性、不调模型）。

为什么需要它：前端无法判断"哪条要点与目标岗位无关"——那需要岗位信号与正文的比对。
内容精简候选要给出低相关要点，本模块复用岗位相关性筛选的同一套信号
（build_job_focus）与打分（_score_item），不新写一套关键词逻辑，也不调模型。

边界：
- 只读：不落库、不改内容、不调模型；
- 信息不足时返回空列表：没有关联岗位 / 岗位已删 / 岗位文本里提取不到信号 / 条目没有
  W01 稳定 id（前端无法定位到对象）→ 一律不猜；
- 只提示"低相关"，删不删由用户决定；这里不删除任何东西。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.resume import ResumeRecord
from ...schemas.job import JobOut
from ...schemas.resume import ResumeContent
from .. import trash
from ..profile.profile_relevance import _score_item, build_job_focus
from ..profile.profile_service import get_profile_detail, to_profile_out
from .document_identity import ENTRY_FIELDS, POINT_FIELDS, is_object_id
from .resume_visibility import is_hidden_entry

# 一次最多给几条：候选清单是"建议看看"，不是"必须处理"；一条墙纸只会被无视。
MAX_CONTENT_HINTS = 10

# 太短的要点（"负责开发"这类）打分噪音大，也不值得单独提示删改。
_MIN_POINT_CHARS = 4

# 简历栏目 → 岗位相关性打分使用的资料栏目（_score_item 的 section 决定权重）。
# 科研三栏目没有对应的资料分区，按最接近的 projects 处理。
_SECTION_TO_SCORE_SECTION = {
    "education": "educations",
    "experience": "experiences",
    "campus_experience": "campus_experiences",
    "projects": "projects",
    "publications": "projects",
    "research_projects": "projects",
    "patents": "projects",
    "skills": "skills",
    "awards": "awards",
}

# 没有要点数组的栏目也可以给"整条低相关"提示（技能/荣誉），其余栏目按要点提示。
_ENTRY_LEVEL_SECTIONS = ("skills", "awards")


def _profile_section(section: str) -> str:
    return _SECTION_TO_SCORE_SECTION.get(section, "projects")


def _focus_terms_line(focus) -> str:
    terms = list(focus.skills) + list(focus.terms)
    unique = list(dict.fromkeys(term for term in terms if term.strip()))
    if not unique:
        return ""
    return "岗位关键词：" + "、".join(unique[:6])


def _hint(
    *,
    section: str,
    object_id: str,
    point_field: str | None,
    point_id: str | None,
    text: str,
    focus,
) -> dict[str, Any]:
    evidence = [text.strip()[:160]]
    terms_line = _focus_terms_line(focus)
    if terms_line:
        evidence.append(terms_line)
    return {
        "kind": "low_relevance",
        "section": section,
        "object_id": object_id,
        "point_field": point_field,
        "point_id": point_id,
        "reason": "这条内容没有命中目标岗位的关键词，可考虑精简或换一种更相关的表达",
        "evidence": evidence[:10],
    }


def _entry_point_ids(entry: Any) -> dict[str, list[str]]:
    point_ids = getattr(entry, "point_ids", None)
    return point_ids if isinstance(point_ids, dict) else {}


def build_content_hints(db: Session, record: ResumeRecord) -> list[dict[str, Any]]:
    """当前简历的"低相关要点"提示（最多 MAX_CONTENT_HINTS 条）。

    判据：与岗位相关性筛选同一个打分函数，得分 0 视为"没有命中岗位关键词"。
    只对**有稳定 id** 的条目给提示——前端要按 object_id/point_id 定位到具体对象。
    """
    if record.job_id is None:
        return []
    job = db.get(Job, record.job_id)
    if job is None or trash.is_deleted(job):
        return []
    try:
        # JobOut 会把 keywords 的历史 dict 形状归一成模型；直接拿 ORM 对象去打分会在
        # job.keywords 上碰到 dict（相关性筛选全程按 JobOut 写，这里必须走同一入口）。
        job_out = JobOut.model_validate(job)
        profile = to_profile_out(get_profile_detail(db))
        focus = build_job_focus(job_out, profile)
    except Exception:  # noqa: BLE001 - 提示是锦上添花，读资料失败不能拖垮版面诊断
        return []
    if not (focus.skills or focus.domains or focus.terms):
        # 岗位文本里提取不到任何信号：这时"低相关"没有依据，不猜。
        return []

    content = ResumeContent.model_validate(record.content or {})
    hints: list[dict[str, Any]] = []
    for section in ENTRY_FIELDS:
        for entry in getattr(content, section, None) or []:
            if is_hidden_entry(entry):
                continue
            object_id = getattr(entry, "id", None)
            if not is_object_id(object_id):
                continue
            point_ids = _entry_point_ids(entry)
            point_fields = POINT_FIELDS.get(section, ())
            emitted_for_entry = False
            for point_field in point_fields:
                values = getattr(entry, point_field, None) or []
                ids = point_ids.get(point_field) or []
                for index, text in enumerate(values):
                    if not isinstance(text, str) or len(text.strip()) < _MIN_POINT_CHARS:
                        continue
                    if _score_item({point_field: text}, _profile_section(section), focus) > 0:
                        continue
                    point_id = ids[index] if index < len(ids) else None
                    hints.append(
                        _hint(
                            section=section,
                            object_id=object_id,
                            point_field=point_field,
                            point_id=point_id if is_object_id(point_id) else None,
                            text=text,
                            focus=focus,
                        )
                    )
                    emitted_for_entry = True
                    if len(hints) >= MAX_CONTENT_HINTS:
                        return hints
            if emitted_for_entry or section not in _ENTRY_LEVEL_SECTIONS:
                continue
            entry_text = " ".join(
                value
                for value in (
                    getattr(entry, "name", ""),
                    getattr(entry, "level", ""),
                    getattr(entry, "description", ""),
                )
                if isinstance(value, str) and value.strip()
            )
            if len(entry_text.strip()) < _MIN_POINT_CHARS:
                continue
            if _score_item({section: entry_text}, _profile_section(section), focus) > 0:
                continue
            hints.append(
                _hint(
                    section=section,
                    object_id=object_id,
                    point_field=None,
                    point_id=None,
                    text=entry_text,
                    focus=focus,
                )
            )
            if len(hints) >= MAX_CONTENT_HINTS:
                return hints
    return hints


__all__ = ["MAX_CONTENT_HINTS", "build_content_hints"]
