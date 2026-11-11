# SPDX-License-Identifier: Apache-2.0
"""岗位识别结果的**落框兜底**（JFIX-1 / JFIX-2 / JFIX-3 / JFIX-5）。

`text_extraction_normalization.normalize_job_result` 只做字段级锚定（"这个值在原文里
出现过吗"），它发现不了另外三种缺陷——这三种都会让用户填完表单后以为已经全了：

1. **同一句落两个框**（JFIX-1）：福利句同时出现在 `description` 和 `additional_info`，
   详情页出现重复段落。这里按语义归属只保留一份（福利类只留 `additional_info`）。
2. **内容丢失**（JFIX-2）：原文有「你将获得：六险一金、弹性工作…」，而三个正文字段里
   都没有。这里把"命中福利/流程/投递/联系方式关键词、且完全没出现在任何字段"的行补进
   `additional_info`。**只补命中关键词的行**，寒暄语（"你好，我们公司在招…"）天然被排除。
3. **整段未切分**（JFIX-3）：`requirements` 为空而 `description` 接近全文长度时，按
   行首标题（`任职要求：` / `Qualifications:`）或要求类行首词把尾部切给 `requirements`。
   **只在 `requirements` 为空时触发**，否则会把正常切分的好结果二次切开。

提示词（`prompts/job_text_extract.md`）是主，这里是兜底：只做"明显漏了/明显重复"的修补，
不做语义重排。
"""

from __future__ import annotations

import re
from typing import Any

from .profile_entry_merge import normalized_key

# 正文三兄弟：互斥去重与覆盖度检查都只看这三个字段。
_JOB_BODY_FIELDS = ("description", "requirements", "additional_info")

# 福利/待遇类：命中即归 `additional_info`（JFIX-1 的唯一归属判定）。
_WELFARE_KEYWORDS = (
    "福利",
    "待遇",
    "补贴",
    "假期",
    "你将获得",
    "我们提供",
    "五险一金",
    "六险一金",
    "公积金",
    "年终奖",
    "期权",
    "股票",
    "带薪",
    "年假",
    "体检",
    "团建",
    "餐补",
    "房补",
    "节日",
    "旅游",
)
# 覆盖度补漏的白名单（JFIX-2）：福利、流程、投递、联系方式四类。
_BACKFILL_KEYWORDS = (
    *_WELFARE_KEYWORDS,
    "面试流程",
    "面试",
    "流程",
    "投递",
    "简历发送",
    "发送简历",
    "联系方式",
    "联系人",
    "联系电话",
    "邮箱",
    "微信",
    "扫码",
    "截止",
)
# 补漏的单行上限：`additional_info` 不能变成垃圾桶。
_MAX_BACKFILL_CHARS = 200
# 归一后的最短行长：太短的行（"福利："）补进去只是噪音。
_MIN_BACKFILL_CHARS = 4

# JFIX-3：切分点必须是**行首标题形态**，不做句中匹配——职责里出现"负责梳理客户要求"
# 这种句子时不能被当成切分点。
_REQUIREMENT_HEADING_RE = re.compile(
    r"^\s*(?:任职要求|岗位要求|职位要求|任职资格|资格要求|你需要具备|希望你具备|"
    r"我们希望你|需具备|qualifications?|requirements?|what\s+you(?:'|’)?ll\s+need)"
    r"\s*[:：]?",
    re.IGNORECASE,
)
# 没有标题时退一档：要求类内容常见的行首词（仍然只看行首）。
_REQUIREMENT_LINE_START_RE = re.compile(
    r"^\s*(?:\d+[.、)）]\s*)?(?:本科|硕士|博士|大专|专科|统招|学历|专业|"
    r"\d+\s*年以上|应届|年龄|熟悉|熟练掌握|掌握|精通|具备|具有良好的?|"
    r"有(?:较强|良好)的?|能够|能独立|英语|计算机相关)",
)
_WELFARE_HEADING_RE = re.compile(
    r"^\s*(?:薪资福利|薪酬福利|福利待遇|福利|待遇|你将获得|我们提供|"
    r"benefits?|what\s+we\s+offer)\s*[:：]?",
    re.IGNORECASE,
)

# JFIX-3 的触发条件：`description` 占原文的比例。
_UNSPLIT_DESCRIPTION_RATIO = 0.7
# JFIX-5 的告警阈值：`description` 占原文超过这个比例就是"没区分职责与要求"。
_RAW_DESCRIPTION_RATIO = 0.8
_LINE_NUMBER_RE = re.compile(r"^\s*(?:\d+[.、)）]|[-•*·●○])\s*")


def _text_lines(text: str) -> list[str]:
    """按行切开并去掉编号前缀（`1.` / `-` / `•`）。"""
    lines: list[str] = []
    for raw in (text or "").splitlines():
        line = _LINE_NUMBER_RE.sub("", raw).strip()
        if line:
            lines.append(line)
    return lines


def _line_key(line: str) -> str:
    return normalized_key(_LINE_NUMBER_RE.sub("", line))


def _hits(line: str, keywords: tuple[str, ...]) -> bool:
    """这一行是否命中关键词（整行 casefold 后的子串匹配）。"""
    lowered = line.casefold()
    return any(keyword.casefold() in lowered for keyword in keywords)


def _is_welfare(line: str) -> bool:
    return _hits(line, _WELFARE_KEYWORDS)


def clean_job_fields(values: dict[str, Any], source_text: str) -> tuple[dict[str, Any], list[str]]:
    """把 JFIX-1 / JFIX-2 / JFIX-3 / JFIX-5 作用到已锚定的岗位字段上。

    返回（修正后的字段字典, 面向用户的说明）。纯函数：不改入参，不读写数据库。
    """
    cleaned: dict[str, Any] = dict(values)
    notes: list[str] = []
    split = _split_unsplit_description(cleaned, source_text)
    duplicates = _dedupe_across_fields(cleaned)
    backfilled = _backfill_missing_lines(cleaned, source_text)
    if duplicates:
        notes.append(f"已去掉 {duplicates} 行在多个字段里重复出现的内容，请核对。")
    if backfilled:
        notes.append(f"已把原文里 {len(backfilled)} 行福利或流程说明补进补充信息，请核对。")
    source_key = normalized_key(source_text or "")
    description_key = normalized_key(str(cleaned.get("description") or ""))
    if source_key and len(description_key) > _RAW_DESCRIPTION_RATIO * len(source_key):
        notes.append("未能区分职责与要求，请核对岗位描述与任职要求。")
    elif split:
        notes.append("原文没有小标题，已按行首标题把任职要求与福利切出来，请核对。")
    return cleaned, notes


def _split_unsplit_description(values: dict[str, Any], source_text: str) -> bool:
    """JFIX-3：`requirements` 为空且 `description` 接近全文时，按行首标题切开。

    两个前提缺一不可：`requirements` 为空（否则会把正常切分二次切开）、`description`
    占了原文的 70% 以上（否则只是"原文里没写要求"，不该硬切）。
    """
    if str(values.get("requirements") or "").strip():
        return False
    description = str(values.get("description") or "")
    source_key = normalized_key(source_text or "")
    if source_key and len(normalized_key(description)) <= _UNSPLIT_DESCRIPTION_RATIO * len(
        source_key
    ):
        return False
    lines = _text_lines(description)
    if len(lines) < 2:
        return False
    cut = _find_requirement_cut(lines)
    if cut is None:
        return False
    requirements = lines[cut:]
    values["description"] = "\n".join(lines[:cut]).strip()
    # 福利段：标题形态（`福利待遇：`）或直接就是福利内容（`五险一金`）都算起点。
    welfare_cut = next(
        (
            index
            for index, line in enumerate(requirements)
            if _WELFARE_HEADING_RE.match(line) or _is_welfare(line)
        ),
        None,
    )
    if welfare_cut is None:
        values["requirements"] = "\n".join(requirements).strip()
        return True
    values["requirements"] = "\n".join(requirements[:welfare_cut]).strip()
    _append_lines(values, "additional_info", requirements[welfare_cut:])
    return True


def _find_requirement_cut(lines: list[str]) -> int | None:
    """第一个"要求段从这里开始"的行号：先认标题，再认要求类行首词。"""
    for index, line in enumerate(lines):
        if index == 0:
            continue
        if _REQUIREMENT_HEADING_RE.match(line):
            return index
    for index, line in enumerate(lines):
        if index == 0:
            continue
        if _REQUIREMENT_LINE_START_RE.match(line):
            return index
    return None


def _append_lines(values: dict[str, Any], field: str, lines: list[str]) -> None:
    current = str(values.get(field) or "").strip()
    additions = [line.strip() for line in lines if line.strip()]
    if not additions:
        return
    values[field] = "\n".join([current, *additions]).strip() if current else "\n".join(additions)


def _dedupe_across_fields(values: dict[str, Any]) -> int:
    """JFIX-1：**同一句出现在多个字段**时按语义归属只留一份；福利句只留 `additional_info`。

    只有重复出现的行才动——单独出现在一个字段里的福利句（本地规则常把它塞进
    `requirements`）原样保留，这条修法只解决"同一段落在详情页出现两次"。
    """
    lines = {field: _text_lines(str(values.get(field) or "")) for field in _JOB_BODY_FIELDS}
    keys = {field: [_line_key(line) for line in lines[field]] for field in _JOB_BODY_FIELDS}
    counts: dict[str, int] = {}
    for field in _JOB_BODY_FIELDS:
        for key in {key for key in keys[field] if key}:
            counts[key] = counts.get(key, 0) + 1
    duplicated = {key for key, count in counts.items() if count > 1}
    if not duplicated:
        return 0
    owner: dict[str, str] = {}
    sample: dict[str, str] = {}
    for field in ("requirements", "description", "additional_info"):
        for key, line in zip(keys[field], lines[field], strict=False):
            if key not in duplicated:
                continue
            sample.setdefault(key, line)
            # 福利句无论先出现在哪个字段，归属都是 `additional_info`。
            owner.setdefault(key, "additional_info" if _is_welfare(line) else field)
    additional_keys = set(keys["additional_info"])
    moved = [
        sample[key]
        for key, field_owner in owner.items()
        if field_owner == "additional_info" and key not in additional_keys
    ]
    removed = 0
    for field in _JOB_BODY_FIELDS:
        kept: list[str] = []
        for key, line in zip(keys[field], lines[field], strict=False):
            if key in duplicated and owner.get(key) != field:
                removed += 1
                continue
            kept.append(line)
        if field == "additional_info":
            kept = [*kept, *moved]
        updated = "\n".join(kept).strip()
        if updated != str(values.get(field) or "").strip():
            values[field] = updated
    return removed


def _backfill_missing_lines(values: dict[str, Any], source_text: str) -> list[str]:
    """JFIX-2：命中福利/流程/投递/联系方式关键词、且完全没出现在任何字段的行。"""
    if not source_text.strip():
        return []
    combined = normalized_key(
        " ".join(
            str(values.get(field) or "")
            for field in ("title", "company", "location", "salary", *_JOB_BODY_FIELDS)
        )
    )
    added: list[str] = []
    for line in _text_lines(source_text):
        key = _line_key(line)
        if len(key) < _MIN_BACKFILL_CHARS:
            continue
        if not _hits(line, _BACKFILL_KEYWORDS):
            continue
        if key in combined:
            continue
        if any(key in _line_key(item) for item in added):
            continue
        if any(_line_key(item) in key for item in added):
            continue
        added.append(line[:_MAX_BACKFILL_CHARS])
    if added:
        _append_lines(values, "additional_info", added)
    return added


__all__ = ["clean_job_fields"]
