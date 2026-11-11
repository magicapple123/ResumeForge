# SPDX-License-Identifier: Apache-2.0
"""资料识别值的**预处理与值级修补**（FIX-3 / FIX-4 / FIX-5 / FIX-6）。

从 `text_extraction_normalization` 独立出来（2026-11-11）：那个模块已经 420 行，
只允许"加调用不加实现"。这里放四件与字段边界无关的事——它们都作用在**已经成形**的
值或原文版式上：

* FIX-3 **制表符当分隔符**：Excel 抄录的一行里 `\\t` 出现 ≥2 次时才是列分隔符，
  换成 ` | `；只出现 1 次仍当缩进（缩进式排版不能被切开）。
* FIX-4 **日期回填**：条目的 `start_date` / `end_date` 为空时，从该条目**自身**的描述
  或原文锚点 ±200 字内捞 `（21年7月到23年8月）`、`2021.7-2023.8` 这类写法；两位年份
  补 `20`。只在自身范围内捞，跨条目捞会把隔壁的日期安到这条上。
* FIX-5 **四六级归位**：`(四级|CET-?4)[^0-9]{0,6}(\\d{3})` 命中且分数落在 425–710 →
  搬进 `cet4_score` / `cet6_score`，并把这段从原字段（`achievements` / `courses` /
  `description`）里删掉。只取三位数且限定区间，避免把"4"当分数。
* FIX-6 **注入句剔除**：`忽略以上` / `ignore previous` / `请把…填成` 命中的**行**不进
  条目。只删命中的句子，不删整条——模型可能只是把注入语句抄进了描述。
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any

from .profile_entry_merge import IDENTITY_FIELDS

# ===== FIX-3 制表符 =====

_TAB = "\t"
_CELL_SEPARATOR = " | "
# 一行里出现这么多次制表符才算"多列"（Excel 抄录）。
_MIN_TAB_COLUMNS = 2

# ===== FIX-6 注入句 =====

_INJECTION_LINE_RE = re.compile(
    r"忽略(?:以上|上述|之前|前面)(?:的)?(?:所有)?(?:指令|指示|规则|要求|提示)"
    r"|无视(?:以上|上述|之前)(?:的)?(?:所有)?(?:指令|指示|规则|要求|提示)"
    r"|ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior|preceding)"
    r"|disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior|preceding)"
    r"|请(?:把|将)[^。\n]{0,20}(?:填成|改成|写成|设置成)",
    re.IGNORECASE,
)

# ===== FIX-4 日期回填 =====

# 条目自身的描述类字段（日期通常被模型留在这里，而没落进 start/end）。
_DATE_SOURCE_FIELDS = ("description", "highlights", "achievements", "courses")
# 锚点两侧的原文窗口：只在这个范围内捞日期，不跨条目。
_DATE_WINDOW_CHARS = 200
_DATE_SECTIONS = frozenset({"educations", "experiences", "campus_experiences", "projects"})

_DATE_TOKEN = r"(?:\d{4}|\d{2})\s*[年./\-]\s*\d{1,2}\s*月?"
_DATE_RANGE_RE = re.compile(
    rf"(?P<start>{_DATE_TOKEN})\s*(?:到|至|—|–|-|~|～|起)\s*"
    r"(?P<end>至今|现在|目前|present|"
    rf"{_DATE_TOKEN})",
    re.IGNORECASE,
)
_TWO_DIGIT_YEAR = 2
_CENTURY_PREFIX = "20"
_LAST_CENTURY_PREFIX = "19"
_ONGOING_TOKENS = frozenset({"至今", "现在", "目前", "present"})

# 出生年月：「98年7月生的」这类口语写法（FIX-4 同一族：日期只在原文字面存在时才补）。
_BIRTH_RE = re.compile(
    r"(?P<year>\d{4}|\d{2})\s*年\s*(?P<month>\d{1,2})\s*月"
    r"(?:\s*(?:份)?\s*(?:出生|生))?"
)

# ===== FIX-5 四六级分数 =====

_CET_PATTERNS = (
    ("cet4_score", re.compile(r"(?:英语)?(?:四级|CET-?\s?4)[^0-9]{0,6}(\d{3})", re.IGNORECASE)),
    ("cet6_score", re.compile(r"(?:英语)?(?:六级|CET-?\s?6)[^0-9]{0,6}(\d{3})", re.IGNORECASE)),
)
_CET_SOURCE_FIELDS = ("achievements", "courses", "description")
_CET_MIN_SCORE = 425
_CET_MAX_SCORE = 710

_TRIM_CHARS = " \t:：,，;；|｜、/。.·-—"


def normalize_line_separators(text: str) -> str:
    """FIX-3：一行里 `\\t` 出现 ≥2 次才当列分隔符，换成 ` | `。

    Excel / 表格抄录粘贴出来是 `学校\\t公司\\t东风汽车\\t职位\\t结构`，模型会把整串当成
    公司名。单个 `\\t` 保留原样：缩进式排版（`\\t负责…`）靠它表示层级。
    """
    if not text or _TAB not in text:
        return text
    lines = []
    for line in text.splitlines():
        if line.count(_TAB) >= _MIN_TAB_COLUMNS:
            cells = [cell.strip() for cell in line.split(_TAB)]
            line = _CELL_SEPARATOR.join(cell for cell in cells if cell)
        lines.append(line)
    return "\n".join(lines)


def strip_injection_lines(text: str) -> str:
    """FIX-6：命中提示词注入特征的**整行**不进材料（它是指令，不是事实）。"""
    if not text:
        return text
    return "\n".join(line for line in text.splitlines() if not _INJECTION_LINE_RE.search(line))


def sanitize_source_text(text: str) -> str:
    """识别前对原文做的版式与安全清理：制表符分列 + 剔掉注入行。"""
    return strip_injection_lines(normalize_line_separators(text or ""))


def _tidy_line(line: str) -> str:
    return re.sub(r"[ \t]{2,}", " ", line).strip()


def _drop_fragment(line: str, fragment: str) -> str:
    """从一行里删掉一段，并把两侧残留的分隔符一起清掉。"""
    index = line.find(fragment)
    if index < 0:
        return line
    head = line[:index].rstrip(_TRIM_CHARS)
    tail = line[index + len(fragment) :].lstrip(_TRIM_CHARS)
    if head and tail:
        return f"{head} {tail}"
    return head or tail


def _expand_year(year: str) -> str:
    """两位年份补成四位：本世纪内的补 `20`，更大的（出生年份 `98`）补 `19`。

    单靠"补 20"会把 `98年7月生的` 变成 `2098-07`。分界用**当前年份的后两位**：
    `21` / `23` 这类履历年份落在本世纪，`98` 这类出生年份落在上世纪。
    """
    if len(year) != _TWO_DIGIT_YEAR:
        return year
    pivot = datetime.now().year % 100
    century = _CENTURY_PREFIX if int(year) <= pivot else _LAST_CENTURY_PREFIX
    return f"{century}{year}"


def _normalize_date_token(token: str) -> str:
    """`21年7月` / `2021.7` / `2021/07` / `至今` → `2021-07` / `至今`。"""
    compact = unicodedata.normalize("NFKC", token).strip()
    if compact.casefold() in _ONGOING_TOKENS:
        return "至今"
    digits = re.findall(r"\d+", compact)
    if not digits:
        return ""
    year = _expand_year(digits[0])
    if len(year) != 4:
        return ""
    if len(digits) < 2:
        return year
    month = int(digits[1])
    if not 1 <= month <= 12:
        return ""
    return f"{year}-{month:02d}"


def _anchor_window(anchor_text: str, source_text: str) -> str:
    """以条目锚点所在**行**为单位取窗口（含紧跟的一行，两侧各不超过 200 字）。

    早期的实现是"锚点前后各 200 字"，在较短的简历上会把**上一条**的日期包进来：D2 的
    项目条目因此拿到了教育经历的 `2014.09-2018.06`。按行切是"该条目自身范围"的硬边界，
    同时保留"日期写在下一行"这种排版（头部一行 + 日期一行）。
    """
    if not anchor_text or not source_text:
        return ""
    anchor = anchor_text.strip()
    index = source_text.find(anchor)
    if index < 0:
        # 全半角/空格写法不一致时退一步：取锚点里最长的一段（≥2 字）再找一次。
        tokens = sorted(
            (token for token in re.split(r"\s+", anchor) if len(token) >= 2),
            key=len,
            reverse=True,
        )
        for token in tokens:
            index = source_text.find(token)
            if index >= 0:
                anchor = token
                break
        else:
            return ""
    line_start = source_text.rfind("\n", 0, index) + 1
    line_end = source_text.find("\n", index + len(anchor))
    if line_end < 0:
        line_end = len(source_text)
    next_end = source_text.find("\n", line_end + 1)
    block_end = len(source_text) if next_end < 0 else next_end
    start = max(line_start, index - _DATE_WINDOW_CHARS)
    end = min(block_end, line_end + _DATE_WINDOW_CHARS)
    return source_text[start:end]


def _entry_anchor_text(section: str, item: dict[str, Any]) -> str:
    for field in IDENTITY_FIELDS[section]:
        value = item.get(field)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def backfill_entry_dates(section: str, item: dict[str, Any], source_text: str) -> int:
    """FIX-4：把 `（21年7月到23年8月）` 这类日期写法补回 `start_date` / `end_date`。

    只看这个条目**自己的**字段，其次看原文里锚点 ±200 字的窗口；两侧都已有值或捞不到
    就原样返回。返回回填的字段个数（供调用方出提示）。
    """
    if section not in _DATE_SECTIONS:
        return 0
    filled = 0
    for field in ("start_date", "end_date"):
        current = item.get(field)
        if isinstance(current, str) and current.strip():
            continue
        candidates = [
            item.get(name)
            for name in _DATE_SOURCE_FIELDS
            if isinstance(item.get(name), str) and item.get(name)
        ]
        candidates.append(_anchor_window(_entry_anchor_text(section, item), source_text))
        for text in candidates:
            match = _DATE_RANGE_RE.search(text or "")
            if not match:
                continue
            token = match.group("start" if field == "start_date" else "end")
            normalized = _normalize_date_token(token)
            if not normalized:
                continue
            item[field] = normalized
            filled += 1
            break
    return filled


def _backfill_birth_year(values: dict[str, Any], source_text: str) -> int:
    """FIX-4 同族：`98年7月生的` 这类口语出生年月只在原文字面存在时补上。"""
    current = values.get("birth_year")
    if isinstance(current, str) and current.strip():
        return 0
    match = _BIRTH_RE.search(unicodedata.normalize("NFKC", source_text or ""))
    if not match:
        return 0
    year, month = _expand_year(match.group("year")), int(match.group("month"))
    if len(year) != 4 or not 1 <= month <= 12:
        return 0
    values["birth_year"] = f"{year}-{month:02d}"
    return 1


def relocate_cet_scores(item: dict[str, Any]) -> int:
    """FIX-5：把 `英语六级：532` 这类分数搬进 `cet6_score`，并从原字段删掉这段。

    只认三位数且落在 425–710 的分数——「四级」后面跟着的通常是分数，但「4」这种
    单个数字不是。搬走之后原字段如果整行被清空就删掉该行，不留空行。
    """
    moved = 0
    for field in _CET_SOURCE_FIELDS:
        text = item.get(field)
        if not isinstance(text, str) or not text.strip():
            continue
        changed = False
        kept: list[str] = []
        for line in text.splitlines():
            new_line = line
            for target, pattern in _CET_PATTERNS:
                for match in list(pattern.finditer(new_line)):
                    score = int(match.group(1))
                    if not _CET_MIN_SCORE <= score <= _CET_MAX_SCORE:
                        continue
                    changed = True
                    if not str(item.get(target) or "").strip():
                        item[target] = str(score)
                        moved += 1
                    new_line = _drop_fragment(new_line, match.group(0))
            new_line = _tidy_line(new_line)
            if new_line:
                kept.append(new_line)
        if changed:
            item[field] = "\n".join(kept).strip()
    return moved


def clean_profile_values(values: dict[str, Any], source_text: str) -> list[str]:
    """把 FIX-4 / FIX-5 / FIX-6 作用到已装配好的资料值上，返回用户可读说明。

    就地修改 `values`（基础字段 + 各分区），调用方随后整体交给
    `ProfileTextParseResult` 校验。
    """
    notes: list[str] = []
    injected = _strip_injection_from_values(values)
    if injected:
        notes.append(f"已忽略资料中 {injected} 句指令性文字，请核对。")
    dates = 0
    cet = 0
    for section in IDENTITY_FIELDS:
        entries = values.get(section)
        if not isinstance(entries, list):
            continue
        for item in entries:
            if not isinstance(item, dict):
                continue
            dates += backfill_entry_dates(section, item, source_text)
            if section == "educations":
                cet += relocate_cet_scores(item)
    dates += _backfill_birth_year(values, source_text)
    if dates:
        notes.append(f"已从原文补全 {dates} 处时间，请核对。")
    if cet:
        notes.append(f"已把 {cet} 个四六级分数归位，请核对。")
    return notes


def _strip_injection_from_values(values: dict[str, Any]) -> int:
    """FIX-6：把已抄进字段的注入句整行删掉（模型可能把原文那句一起搬了进来）。"""
    removed = 0
    for field in ("summary", "job_intent", "city", "target_city"):
        text = values.get(field)
        if isinstance(text, str) and text.strip():
            cleaned = strip_injection_lines(text).strip()
            if cleaned != text.strip():
                removed += _count_lines(text) - _count_lines(cleaned)
                values[field] = cleaned
    for section in IDENTITY_FIELDS:
        entries = values.get(section)
        if not isinstance(entries, list):
            continue
        for item in entries:
            if not isinstance(item, dict):
                continue
            for field, value in list(item.items()):
                if not isinstance(value, str) or not value.strip():
                    continue
                cleaned = strip_injection_lines(value).strip()
                if cleaned == value.strip():
                    continue
                removed += _count_lines(value) - _count_lines(cleaned)
                item[field] = cleaned
    return removed


def _count_lines(text: str) -> int:
    return len([line for line in text.splitlines() if line.strip()]) or (1 if text.strip() else 0)


__all__ = [
    "backfill_entry_dates",
    "clean_profile_values",
    "normalize_line_separators",
    "relocate_cet_scores",
    "sanitize_source_text",
    "strip_injection_lines",
]
