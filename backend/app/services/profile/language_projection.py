# SPDX-License-Identifier: Apache-2.0
"""R-72 语言能力的唯一纸面映射：语言条目 → ResumeSkill（纯函数，不读库）。

需求 v3 §5.12 的路线 1：不改 ResumeContent 结构、不改模板、不动渲染指纹，把语言
能力条目映射成"专业技能"分区的 skills 条目。形态口径（R-72）：

- name = 语言；
- level = 非空的「水平/等级 → 证书 → 分数」以 " · " 连接，空段跳过；
- **不含取得时间、不含语言的自定义小字段**（§11 第 5 条：仅素材，不进纸面）；
- 语言条目排在系统技能之后，由 paper_projection 负责拼接顺序，本模块只管单条映射；
- 同名多证书**不按 name 去重**：完整映射值就是区分项（"英语（CET-6 · 550）" 与
  "英语（雅思 · 7）"是两条），吞掉一条就是静默丢内容。

level 的 64 字符上限来自既有 ResumeSkill；放不下时这里截断（保证结果可序列化），
paper_projection 用 language_overflow_warnings 汇总成 carrier_overflow 警告，
不静默。
"""

from __future__ import annotations

from ...schemas.profile_projection import ConsumedEntry, ConsumedSection
from ...schemas.resume_entries import ResumeSkill

# 与 schemas/resume_entries.py 的 ResumeSkill.level max_length 一致。
LANGUAGE_LEVEL_MAX = 64
LEVEL_SEPARATOR = " · "

_LANGUAGE_FIELD_ID = "languages.language"
# 拼接顺序固定为"水平/等级 → 证书 → 分数"（R-72 的形态要求），取得时间不参与。
_LEVEL_FIELD_IDS = ("languages.level", "languages.certificate", "languages.score")


def _text(entry: ConsumedEntry, field_id: str) -> str:
    return str(entry.values.get(field_id) or "").strip()


def language_name(entry: ConsumedEntry) -> str:
    """语言名（纸面 skills 条目的 name）；未填返回空串，由调用方决定是否跳过。"""
    return _text(entry, _LANGUAGE_FIELD_ID)


def language_level(entry: ConsumedEntry) -> str:
    """未截断的 level 映射值：「水平/等级 · 证书 · 分数」，空段跳过。"""
    return LEVEL_SEPARATOR.join(
        part for part in (_text(entry, field_id) for field_id in _LEVEL_FIELD_IDS) if part
    )


def project_language_skill_entries(
    languages: ConsumedSection,
) -> list[tuple[str, ResumeSkill]]:
    """与 project_language_skills 同一实现，但带上来源 entry_id。

    投影层要用 entry_id 回答"这条语言在 content.skills 的第几项"（候选的
    paper_content_path）；生成侧（F3 语言补位）只需要 skill 列表，走下面那层薄封装。
    """
    rows: list[tuple[str, ResumeSkill]] = []
    for entry in languages.entries:
        name = language_name(entry)
        level = language_level(entry)
        if not name and not level:
            continue
        rows.append(
            (entry.entry_id, ResumeSkill(name=name[:128], level=level[:LANGUAGE_LEVEL_MAX]))
        )
    return rows


def project_language_skills(languages: ConsumedSection) -> list[ResumeSkill]:
    """把语言能力分区映射成 skills 条目列表（按条目顺序；不按同名去重）。

    整条完全为空（语言与 level 都没有）的条目不产生 skill，避免在纸面上留一个
    空标签；level 超过 64 字符时截断到 64（限长由既有结构决定，警告见
    language_overflow_warnings）。
    """
    return [skill for _entry_id, skill in project_language_skill_entries(languages)]


def language_overflow_warnings(languages: ConsumedSection) -> list[tuple[str, str, int]]:
    """返回 [(entry_id, 语言, 原始 level 长度)]：limit 放不下的条目，供上层转 warning。"""
    rows: list[tuple[str, str, int]] = []
    for entry in languages.entries:
        level = language_level(entry)
        if len(level) > LANGUAGE_LEVEL_MAX:
            rows.append((entry.entry_id, language_name(entry), len(level)))
    return rows


__all__ = [
    "LANGUAGE_LEVEL_MAX",
    "LEVEL_SEPARATOR",
    "language_level",
    "language_name",
    "language_overflow_warnings",
    "project_language_skill_entries",
    "project_language_skills",
]
