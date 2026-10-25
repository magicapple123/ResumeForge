# SPDX-License-Identifier: Apache-2.0
"""岗位提示词和个人资料上下文的长度预算控制。"""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from ...models.job import Job
from ...schemas.job import JobOut
from .profile_relevance_constants import (
    _LIST_DETAIL_FIELDS,
    _MIN_PROFILE_CONTEXT_CHARS,
    _OPTIONAL_TOP_LEVEL_FIELDS,
    _REFERENCE_SECTIONS,
    FACT_STANDALONE_SECTIONS,
    SECTION_LIMITS,
)


def _dump(data: dict[str, Any]) -> str:
    # Prompt 不需要缩进；紧凑序列化可以为事实本身省出更多上下文空间。
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _list_sections(data: dict[str, Any]) -> list[str]:
    """候选里所有列表分区（按插入顺序）。预算压缩只改已存在的键（R-29/C1）。"""
    return [key for key, value in data.items() if isinstance(value, list)]


def _trim_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    cut = value[:max_chars]
    if "\n" in cut:
        cut = cut.rsplit("\n", 1)[0]
    return f"{cut.rstrip()}…" if cut.rstrip() else ""


def _trim_middle(value: str, max_chars: int) -> str:
    """保留超长文本的开头和结尾，避免遗漏写在末尾的硬性要求。"""
    if len(value) <= max_chars:
        return value
    if max_chars < 8:
        return _trim_text(value, max_chars)
    head_size = max_chars * 2 // 3
    tail_size = max_chars - head_size - 1
    return f"{value[:head_size].rstrip()}…{value[-tail_size:].lstrip()}"


def build_job_prompt_text(job: JobOut | Job, max_chars: int) -> str:
    """在固定预算中优先保留任职要求，再补充职位描述。

    两种入参都收：schema 层（``JobOut``，助手工具链路）与模型层（``Job``，面试 /
    简历生成链路直接拿 ORM 记录调用）——函数只读 ``requirements`` / ``description``
    / ``additional_info`` 三个 str 字段，两边都有且语义一致。
    """
    requirements = job.requirements.strip()
    description = job.description.strip()
    additional_info = job.additional_info.strip()
    overhead = len("任职要求（优先）：\n\n\n职位描述：\n\n\n其他招聘信息：\n")
    available = max(0, max_chars - overhead)
    if not requirements:
        description_budget = available if not additional_info else available * 3 // 4
        description_text = _trim_middle(description, description_budget)
        additional_text = _trim_middle(additional_info, max(0, available - len(description_text)))
        result = f"职位描述：\n{description_text}"
        if additional_text:
            result += f"\n\n其他招聘信息：\n{additional_text}"
        return result

    requirement_budget = min(
        len(requirements),
        max(available * 3 // 5, min(available, 1_200)),
    )
    requirement_text = _trim_middle(requirements, requirement_budget)
    remaining = max(0, available - len(requirement_text))
    description_budget = remaining if not additional_info else remaining * 3 // 4
    description_text = _trim_middle(description, description_budget)
    additional_text = _trim_middle(additional_info, max(0, remaining - len(description_text)))
    result = f"任职要求（优先）：\n{requirement_text}\n\n职位描述：\n{description_text}"
    if additional_text:
        result += f"\n\n其他招聘信息：\n{additional_text}"
    return result


def _drop_one_detail(data: dict[str, Any]) -> bool:
    """从候选尾部逐条删减要点，优先保留排名靠前的事实。"""
    for section in reversed(_REFERENCE_SECTIONS):
        for item in reversed(data.get(section) or []):
            excerpt = item.get("reference_excerpt")
            if not isinstance(excerpt, str) or not excerpt:
                continue
            if len(excerpt) > 360:
                item["reference_excerpt"] = _trim_text(excerpt, max(360, len(excerpt) // 2))
            else:
                item.pop("reference_excerpt", None)
                if not item.get("reference_facts"):
                    item.pop("reference_file_name", None)
            return True
    for section in reversed(_REFERENCE_SECTIONS):
        for item in reversed(data.get(section) or []):
            facts = item.get("reference_facts")
            if not isinstance(facts, list) or not facts:
                continue
            facts.pop()
            if not facts:
                item.pop("reference_facts", None)
                if not item.get("reference_excerpt"):
                    item.pop("reference_file_name", None)
            return True
    # 裁剪顺序固定：先补充事实（旧 A3 栏目 + v3 新增五个大字段的列表字段），再旧六
    # 分区，最后其余参与分区。论文/科研的候选通常只是资料库里的长尾证据，不该为了
    # 它们先砍用户的核心经历；同一顺序也保证"删掉无关分区不会挤掉共有分区"（N）。
    detail_sections = [section for section in FACT_STANDALONE_SECTIONS if section in data]
    detail_sections += [
        section
        for section in ("awards", "campus_experiences", "experiences", "projects", "educations")
        if section in data
    ]
    detail_sections += [
        section
        for section in reversed(_list_sections(data))
        if section not in detail_sections
    ]
    for section in detail_sections:
        entries = data.get(section) or []
        for item in reversed(entries):
            if not isinstance(item, dict):
                continue
            for field in ("description", "outcomes", *_LIST_DETAIL_FIELDS):
                values = item.get(field)
                if not isinstance(values, list) or not values:
                    continue
                if len(values) > 1:
                    values.pop()
                    return True
                if len(values[0]) > 240:
                    # 裁剪目标要明显小于触发阈值：_trim_text 会保留 max_chars+1 个字符
                    # （截断后补省略号），若按 240 裁会得到 241 字符，下一轮仍 >240，
                    # 在 while 循环里永远消不掉。200 -> 最多 201 字符，稳定收敛。
                    values[0] = _trim_text(values[0], 200)
                    return True
    return False


def _trim_all_strings(value: Any, max_chars: int) -> Any:
    """极端长输入的最后兜底；常规资料不会触发这一层。"""
    if isinstance(value, str):
        return _trim_text(value, max_chars)
    if isinstance(value, list):
        return [_trim_all_strings(item, max_chars) for item in value]
    if isinstance(value, dict):
        return {key: _trim_all_strings(item, max_chars) for key, item in value.items()}
    return value


def serialize_profile_prompt_data(data: dict[str, Any], max_chars: int) -> str:
    """在字段/要点边界上压缩资料，返回不超过预算的合法 JSON。"""
    if max_chars < _MIN_PROFILE_CONTEXT_CHARS:
        raise ValueError(f"资料上下文预算不能小于 {_MIN_PROFILE_CONTEXT_CHARS} 个字符")

    candidate = deepcopy(data)
    serialized = _dump(candidate)
    if len(serialized) <= max_chars:
        return serialized

    while len(serialized) > max_chars and _drop_one_detail(candidate):
        serialized = _dump(candidate)

    for field in _OPTIONAL_TOP_LEVEL_FIELDS:
        if len(serialized) <= max_chars:
            break
        value = candidate.get(field)
        if isinstance(value, str) and value:
            candidate[field] = _trim_text(value, 400)
            serialized = _dump(candidate)

    trim_sections = [section for section in _list_sections(candidate)]
    # 旧六分区按既有顺序先压（旧链路行为不变），其余参与分区按插入顺序随后。
    old_order = ("educations", "experiences", "campus_experiences", "projects", "awards")
    trim_sections = [section for section in old_order if section in trim_sections] + [
        section for section in trim_sections if section not in old_order
    ]
    for limit in (800, 400, 200):
        if len(serialized) <= max_chars:
            break
        for section in trim_sections:
            for item in candidate.get(section, []):
                if not isinstance(item, dict):
                    continue
                for field in ("description", "outcomes", *_LIST_DETAIL_FIELDS):
                    values = item.get(field)
                    if isinstance(values, list):
                        item[field] = [_trim_text(value, limit) for value in values if value]
        serialized = _dump(candidate)

    for field in ("summary", "github", "personal_website", "target_city"):
        if len(serialized) <= max_chars:
            break
        if field in candidate:
            candidate[field] = ""
            serialized = _dump(candidate)
    if len(serialized) > max_chars:
        # 先减少 v3 新增分区的条目（尾部优先），再动旧六分区：这样把无关分区从组里
        # 删掉不会降低共有分区的入选数量（N 的预算单调性）。
        pop_sections = [
            section
            for section in reversed(_list_sections(candidate))
            if section not in old_order
        ] + [section for section in old_order if section in candidate]
        for section in pop_sections:
            entries = candidate.get(section) or []
            while len(serialized) > max_chars and len(entries) > 1:
                entries.pop()
                serialized = _dump(candidate)
    if len(serialized) > max_chars:
        for limit in (128, 64, 32, 16):
            candidate = _trim_all_strings(candidate, limit)
            serialized = _dump(candidate)
            if len(serialized) <= max_chars:
                break
    if len(serialized) > max_chars:
        candidate = {
            "target_city": "",
            "job_intent": _trim_text(str(candidate.get("job_intent", "")), 64),
            "summary": "",
            # 只保留 candidate 里真的有的 section：旧数据没有新增分区键，兜底结果的
            # 键集合与改动前完全一致；有新增分区时它们参与兜底而不是被静默丢掉。
            **{
                section: (candidate.get(section) or [])[:1]
                for section in [
                    *SECTION_LIMITS,
                    *(
                        section
                        for section in _list_sections(candidate)
                        if section not in SECTION_LIMITS
                    ),
                ]
                if section in candidate
            },
        }
        candidate = _trim_all_strings(candidate, 32)
        serialized = _dump(candidate)
    if len(serialized) > max_chars:
        # 参与分区的**键要保留**（C1：在组里就出现，没数据就是空数组）。预算极端不足时
        # 从尾部（v3 新增分区优先、旧六分区最后）逐分区清空数组，而不是丢掉键或静默截断。
        for section in reversed(_list_sections(candidate)):
            if len(serialized) <= max_chars:
                break
            if candidate.get(section):
                candidate[section] = []
                serialized = _dump(candidate)
    if len(serialized) > max_chars:
        raise ValueError("个人资料基础字段过长，无法在安全预算内生成简历")
    return serialized