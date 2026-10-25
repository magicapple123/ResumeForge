# SPDX-License-Identifier: Apache-2.0
"""补充事实 payload → 生成候选（resume 风格 dict）的纯映射。

纯函数、不读库、不调模型，便于单测对拍。映射规则来自契约 §3.3 与计划 §8.1：

- 论文 / 科研项目 / 专利 / 证照 → 独立 section；
- 作品项目 → 项目风格（projects，补 public_url / artifact_type）；
- 实践经历 → 经历风格（experiences，补 experience_kind）；
- 证照剔除 credential_number（私密：本地可见，但绝不进模型上下文）；
- 所有链接只保留 http(s)（写入时已校验，这里对旧数据/导入数据再兜一层）。

作者顺序、is_self / corresponding 标记、状态枚举一律**原样保留**，不做任何推断——
"通讯作者""已授权"这类事实只能来自用户录入，不能由 AI 或关键词补齐。
"""

from __future__ import annotations

from typing import Any

from .profile_relevance_constants import (
    FACT_MERGED_SECTIONS,
    FACT_SECTION_KEYS,
    FACT_STANDALONE_SECTIONS,
)

_HTTP_PREFIXES = ("http://", "https://")

# 九类 kind → 事实快照 section 名（与 profile_relevance_constants 的白名单同源）。
FACT_SECTION_BY_KIND: dict[str, str] = {
    "publication": "publications",
    "research_project": "research_projects",
    "patent": "patents",
    "credential": "credentials",
    "work_project": "work_projects",
    "practice": "practices",
    "award": "awards",
    "training": "trainings",
    "language": "skills",
}

# 独立成 section 的四类（作品/实践合并进 projects/experiences，不单独出现）。
# 白名单的**唯一真相**在 profile_relevance_constants：候选链路按它决定预算与保留，
# 这里只做别名导出，避免两份清单漂移。
STANDALONE_SECTION_KEYS: tuple[str, ...] = FACT_STANDALONE_SECTIONS
MERGED_SECTION_KEYS: tuple[str, ...] = FACT_MERGED_SECTIONS


def http_url(value: Any) -> str:
    """只保留 http(s) 链接；空值或其它协议一律返回空串（不猜测、不改写协议）。"""
    text = str(value or "").strip()
    return text if text.lower().startswith(_HTTP_PREFIXES) else ""


def _text(value: Any) -> str:
    return str(value or "").strip()


def _lines(value: Any) -> list[str]:
    """要点列表：逐条去空白、丢弃空行，顺序不变。"""
    if not isinstance(value, list):
        return []
    return [text for text in (str(item or "").strip() for item in value) if text]


def _people(value: Any) -> list[dict[str, Any]]:
    """作者/发明人：顺序即署名顺序，两个布尔标记原样保留。"""
    if not isinstance(value, list):
        return []
    people: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        people.append(
            {
                "name": _text(item.get("name")),
                "is_self": bool(item.get("is_self")),
                "corresponding": bool(item.get("corresponding")),
            }
        )
    return people


def _custom_entries(payload: dict[str, Any]) -> list[dict[str, str]]:
    """自定义字段值快照 → [{label, value}]（空值/空名跳过，顺序不变）。"""
    if not isinstance(payload.get("custom_fields"), list):
        return []
    entries: list[dict[str, str]] = []
    for item in payload["custom_fields"]:
        if not isinstance(item, dict):
            continue
        label = _text(item.get("label"))
        value = _text(item.get("value"))
        if not value:
            continue
        entries.append({"label": label, "value": value})
    return entries


def _custom_lines(payload: dict[str, Any]) -> list[str]:
    """自定义字段 → 「label：value」文本行（供 description/note/level 追加）。"""
    return [
        f"{entry['label']}：{entry['value']}" if entry["label"] else entry["value"]
        for entry in _custom_entries(payload)
    ]


def _append_text(base: str, lines: list[str]) -> str:
    parts = [base] if base else []
    parts.extend(lines)
    return "\n".join(parts)


def publication_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": _text(payload.get("title")),
        "authors": _people(payload.get("authors")),
        "venue": _text(payload.get("venue")),
        "year": _text(payload.get("year")),
        "status": _text(payload.get("status")),
        "doi": _text(payload.get("doi")),
        "url": http_url(payload.get("url")),
        "volume_pages": _text(payload.get("volume_pages")),
        # 论文没有描述列表：自定义字段追加到备注（契约 §5）。
        "note": _append_text(_text(payload.get("note")), _custom_lines(payload)),
    }


def research_project_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(payload.get("name")),
        "role": _text(payload.get("role")),
        "organization": _text(payload.get("organization")),
        "start_date": _text(payload.get("start_date")),
        "end_date": _text(payload.get("end_date")),
        "funding": _text(payload.get("funding")),
        "description": [*_lines(payload.get("description")), *_custom_lines(payload)],
        "outcomes": _lines(payload.get("outcomes")),
    }


def patent_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": _text(payload.get("title")),
        "inventors": _people(payload.get("inventors")),
        "patent_number": _text(payload.get("patent_number")),
        "country": _text(payload.get("country")),
        "status": _text(payload.get("status")),
        "filed_date": _text(payload.get("filed_date")),
        "granted_date": _text(payload.get("granted_date")),
        "url": http_url(payload.get("url")),
        # 专利没有可追加的文本字段：保留自定义字段快照供模型参考（不进纸面字段）。
        "custom_fields": _custom_entries(payload),
    }


def credential_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    """资格证照候选：**显式白名单**，credential_number 不在此列（私密红线）。"""
    return {
        "name": _text(payload.get("name")),
        "issuer": _text(payload.get("issuer")),
        "issue_date": _text(payload.get("issue_date")),
        "expiry_date": _text(payload.get("expiry_date")),
        "status": _text(payload.get("status")),
        "verify_url": http_url(payload.get("verify_url")),
        # 证照没有描述列表：自定义字段追加到备注；credential_number 永不出现。
        "note": _append_text(_text(payload.get("note")), _custom_lines(payload)),
    }


def work_project_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    """作品项目 → 项目风格：保留项目表单的既有键，补 public_url / artifact_type。"""
    return {
        "name": _text(payload.get("name")),
        "role": _text(payload.get("role")),
        "start_date": _text(payload.get("start_date")),
        "end_date": _text(payload.get("end_date")),
        "tech_stack": _lines(payload.get("tech_stack")),
        "description": [*_lines(payload.get("description")), *_custom_lines(payload)],
        "highlights": _lines(payload.get("highlights")),
        "public_url": http_url(payload.get("public_url")),
        "artifact_type": _text(payload.get("artifact_type")),
    }


def practice_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    """实践/服务经历 → 经历风格。

    既有经历条目的身份字段是 company（简历 schema 的唯一字段名），所以这里把中性的
    organization 映射到 company；额外保留 experience_kind 表明这是实践/志愿/合同等
    关系，不靠场景或措辞猜测雇佣类型。
    """
    return {
        "company": _text(payload.get("organization")),
        "role": _text(payload.get("role")),
        "start_date": _text(payload.get("start_date")),
        "end_date": _text(payload.get("end_date")),
        "description": [*_lines(payload.get("description")), *_custom_lines(payload)],
        "experience_kind": _text(payload.get("experience_kind")) or "unset",
    }


def award_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    """荣誉奖项 → 候选 awards 条目；description 依次拼接颁发机构、级别、说明、自定义字段。"""
    parts = [
        _text(payload.get("issuer")),
        _text(payload.get("level")),
        _text(payload.get("description")),
        *_custom_lines(payload),
    ]
    return {
        "name": _text(payload.get("name")),
        "date": _text(payload.get("date")),
        "description": "\n".join(part for part in parts if part),
    }


def training_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    """培训课程 → 候选 projects 条目（复用项目管理/编辑器，成果类型标"培训"）。"""
    return {
        "name": _text(payload.get("name")),
        "role": "学员",
        "start_date": _text(payload.get("start_date")),
        "end_date": _text(payload.get("end_date")),
        "description": [
            *_lines(payload.get("description")),
            *_lines(payload.get("outcomes")),
            *_custom_lines(payload),
        ],
        "public_url": "",
        "artifact_type": "培训",
    }


def language_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    """语言能力 → 候选 skills 条目；level 拼接证书、成绩与自定义字段（空值跳过）。"""
    parts = [
        _text(payload.get("level")),
        _text(payload.get("certificate")),
        _text(payload.get("score")),
        *_custom_lines(payload),
    ]
    return {
        "name": _text(payload.get("name")),
        "level": " / ".join(part for part in parts if part),
        # 技能没有可追加的文本字段，保留自定义字段快照供模型参考（不进纸面字段）。
        "custom_fields": _custom_entries(payload),
    }


_FACT_MAPPERS = {
    "publication": publication_candidate,
    "research_project": research_project_candidate,
    "patent": patent_candidate,
    "credential": credential_candidate,
    "work_project": work_project_candidate,
    "practice": practice_candidate,
    "award": award_candidate,
    "training": training_candidate,
    "language": language_candidate,
}


def map_fact_payload(kind: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """按 kind 映射一条事实；未知 kind 返回 None（由调用方跳过，不猜测）。"""
    mapper = _FACT_MAPPERS.get(kind)
    if mapper is None:
        return None
    return mapper(payload if isinstance(payload, dict) else {})


__all__ = [
    "FACT_SECTION_BY_KIND",
    "FACT_SECTION_KEYS",
    "MERGED_SECTION_KEYS",
    "STANDALONE_SECTION_KEYS",
    "award_candidate",
    "credential_candidate",
    "http_url",
    "language_candidate",
    "map_fact_payload",
    "patent_candidate",
    "practice_candidate",
    "publication_candidate",
    "research_project_candidate",
    "training_candidate",
    "work_project_candidate",
]
