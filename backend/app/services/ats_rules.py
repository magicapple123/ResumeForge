# SPDX-License-Identifier: Apache-2.0
"""ATS 检测的**规则与评分域**：格式/联系方式/日期/量化/位置判定 + 分项打分。

拆分自 ``services/ats_check.py``（原 834 行超预算）。本模块只做「规则判定」：

- 格式风险：必填项缺失、特殊符号、联系方式格式、日期格式与区间、段落可读性与量化；
- 信息位置：求职意向 / 个人总结 / 教育 / 技能等关键区块是否就位；
- 评分：三个分项（格式 40% / 关键词 40% / 位置 20%）的扣分与加权总分。

关键词域（词库 / JD 抽词 / 覆盖率）住在 ``ats_keywords.py``；对外编排仍在
``ats_check.py``（它 re-export 本模块的全部符号，历史上从 ``ats_check`` 直接
import 内部符号的调用点无需改动）。
"""

from __future__ import annotations

import json
import re

from ..schemas.ats import AtsIssue
from ..schemas.resume import ResumeContent

# 容易被 ATS 误解析、或让版面显得不专业的符号：emoji、方框线、带圈数字、杂项符号。
_SPECIAL_CHAR_RE = re.compile(
    r"[\u2460-\u2473\u2500-\u257F\u2600-\u27BF\uFE00-\uFE0F\uD800-\uDBFF]"
)

# 分项扣分权重：high 25 / medium 12 / low 5（每类从 100 分往下扣，扣到 0 为止）。
_SEVERITY_PENALTY = {"high": 25, "medium": 12, "low": 5}

# 总分权重：格式与关键词各占 40%，信息位置 20%。
_WEIGHT_FORMAT = 0.4
_WEIGHT_KEYWORD = 0.4
_WEIGHT_POSITION = 0.2

# 量化加分：描述里带数字/百分比的比例越高，关键词分项最多加 10 分。
_QUANTIFY_BONUS_MAX = 10
# 单条描述超过这个字数、又不换行，会被 ATS 当成一大段文本。
_LONG_PARAGRAPH_CHARS = 120
# 描述条目达到这个数量后，才谈得上"整体量化不足"。
_MIN_ITEMS_FOR_QUANTIFY = 3
# 量化条目占比低于这个值时提示"补数字"。
_QUANTIFY_RATIO_MIN = 0.3

_PHONE_RE = re.compile(r"^(\+?86)?1[3-9]\d{9}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# 允许的日期写法：YYYY / YYYY-MM / YYYY-MM-DD（外加"至今"）。
_DATE_RE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")
_DATE_PRESENT = "至今"
_DIGIT_RE = re.compile(r"\d")
_PERCENT_RE = re.compile(r"[%％]")


def _find_special_chars(resume: ResumeContent) -> list[str]:
    text = json.dumps(resume.model_dump(exclude={"photo"}), ensure_ascii=False)
    found: list[str] = []
    for match in _SPECIAL_CHAR_RE.finditer(text):
        char = match.group(0)
        if char not in found:
            found.append(char)
    return found


def _format_issues(resume: ResumeContent) -> list[AtsIssue]:
    """格式类问题：必填项缺失与特殊符号（联系方式/日期/段落见各自的判定函数）。"""
    issues: list[AtsIssue] = []
    if not resume.name.strip():
        issues.append(
            AtsIssue(
                category="format",
                severity="high",
                title="缺少姓名",
                detail="姓名缺失会被 ATS 与 HR 直接判为不合格",
                suggestion="在简历顶部补上真实姓名，不要只写「个人简历」或昵称。",
            )
        )
    if not resume.phone.strip() and not resume.email.strip():
        issues.append(
            AtsIssue(
                category="format",
                severity="high",
                title="缺少联系方式",
                detail="手机与邮箱至少保留一项，否则无法联系到你",
                suggestion="补一个手机号或邮箱，优先放在姓名下方同一行。",
            )
        )
    special = _find_special_chars(resume)
    if special:
        issues.append(
            AtsIssue(
                category="format",
                severity="medium",
                title="正文含特殊符号",
                detail="特殊符号 / emoji 可能被 ATS 误解析，建议改用纯文本",
                evidence=special[:5],
                suggestion="把 emoji、方框线与带圈数字换成普通文字或短横线。",
            )
        )
    return issues


def _contact_format_issues(resume: ResumeContent) -> list[AtsIssue]:
    """联系方式**格式**：非空但不像手机号/邮箱时提示（不猜用户想写什么）。"""
    issues: list[AtsIssue] = []
    phone = resume.phone.strip()
    if phone and not _PHONE_RE.match(phone):
        issues.append(
            AtsIssue(
                category="format",
                severity="medium",
                title="手机号格式可能不正确",
                detail="以 1 开头的 11 位手机号最容易被 ATS 识别，带空格/短横线时常常整段丢失",
                evidence=[phone[:32]],
                suggestion="改成 11 位连续数字（可带 +86 前缀），删掉空格与短横线。",
            )
        )
    email = resume.email.strip()
    if email and not _EMAIL_RE.match(email):
        issues.append(
            AtsIssue(
                category="format",
                severity="medium",
                title="邮箱格式可能不正确",
                detail="缺少 @ 或域名后缀的邮箱无法被解析，HR 也发不出邮件",
                evidence=[email[:64]],
                suggestion="检查邮箱是否为 name@example.com 这样的完整形式。",
            )
        )
    return issues


def _dated_records(resume: ResumeContent) -> list[tuple[str, str, str]]:
    """所有带起止时间的条目：(说明, start_date, end_date)。

    ``awards`` 只有一个日期字段、没有区间，因此不参与"倒置"判断。
    """
    records: list[tuple[str, str, str]] = []
    for item in resume.education:
        records.append((f"教育经历「{item.school or '未命名'}」", item.start_date, item.end_date))
    for item in resume.experience:
        records.append((f"工作经历「{item.company or '未命名'}」", item.start_date, item.end_date))
    for item in resume.campus_experience:
        records.append(
            (f"校园经历「{item.organization or '未命名'}」", item.start_date, item.end_date)
        )
    for item in resume.projects:
        records.append((f"项目经历「{item.name or '未命名'}」", item.start_date, item.end_date))
    return records


def _parse_date(value: str) -> tuple[int, int, int] | None:
    """把 ``YYYY`` / ``YYYY-MM`` / ``YYYY-MM-DD`` 解析成可比较的三元组；其余返回 None。"""
    match = _DATE_RE.match(value.strip())
    if match is None:
        return None
    year = int(match.group(1))
    month = int(match.group(2) or 1)
    day = int(match.group(3) or 1)
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    return (year, month, day)


def _is_date_text(value: str) -> bool:
    text = value.strip()
    return text == _DATE_PRESENT or _parse_date(text) is not None


def _date_issues(resume: ResumeContent) -> list[AtsIssue]:
    """日期格式与区间：格式不统一 → low；起止倒置 → high（明显写错，HR 会当成造假）。"""
    issues: list[AtsIssue] = []
    malformed: list[str] = []
    reversed_ranges: list[str] = []
    for label, start, end in _dated_records(resume):
        for value in (start, end):
            text = value.strip()
            if text and not _is_date_text(text):
                malformed.append(f"{label}：{text[:32]}")
        start_at = _parse_date(start)
        end_at = _parse_date(end)
        if start_at is not None and end_at is not None and start_at > end_at:
            reversed_ranges.append(label)
    if malformed:
        issues.append(
            AtsIssue(
                category="format",
                severity="low",
                title="日期格式不统一",
                detail="支持 2024 / 2024-06 / 2024-06-01 / 至今 四种写法，其他写法可能被解析成空值",
                evidence=malformed[:5],
                suggestion="统一成 2024-06 这类「年-月」写法，在读区间时更稳。",
            )
        )
    if reversed_ranges:
        issues.append(
            AtsIssue(
                category="format",
                severity="high",
                title="起止时间倒置",
                detail="开始时间晚于结束时间，ATS 会算成 0 个月，HR 也会怀疑真实性",
                evidence=reversed_ranges[:5],
                suggestion="核对并调换起止日期，仍在职的结束时间写「至今」。",
            )
        )
    return issues


def _description_items(resume: ResumeContent) -> list[str]:
    """所有"描述/成果"条目（不含课程列表这类名词短语）。"""
    items: list[str] = []
    for item in resume.education:
        items.extend(item.achievements)
    for item in resume.experience:
        items.extend(item.description)
    for item in resume.campus_experience:
        items.extend(item.description)
    for item in resume.projects:
        items.extend(item.description)
        items.extend(item.highlights)
    return [text.strip() for text in items if text.strip()]


def _is_quantified(text: str) -> bool:
    """一条描述是否带数字或百分比（量化的最小判据）。"""
    return bool(_DIGIT_RE.search(text) or _PERCENT_RE.search(text))


def quantified_ratio(resume: ResumeContent) -> float:
    """描述条目里含数字/百分比的比例（无条目时为 0）。"""
    items = _description_items(resume)
    if not items:
        return 0.0
    return sum(1 for text in items if _is_quantified(text)) / len(items)


def _description_issues(resume: ResumeContent) -> list[AtsIssue]:
    """段落可读性与量化程度：过长段落不利解析，全无数字无法体现成果。"""
    issues: list[AtsIssue] = []
    items = _description_items(resume)
    long_items = [text for text in items if len(text) > _LONG_PARAGRAPH_CHARS and "\n" not in text]
    if long_items:
        issues.append(
            AtsIssue(
                category="format",
                severity="medium",
                title="单条描述过长",
                detail=(
                    f"有 {len(long_items)} 条描述超过 {_LONG_PARAGRAPH_CHARS} 字且未换行，"
                    "ATS 会当成一整段文本，与关键词的匹配精度下降"
                ),
                evidence=[text[:20] for text in long_items[:5]],
                suggestion="把长段落拆成多条要点，每条一句话、以动作动词开头。",
            )
        )
    ratio = quantified_ratio(resume)
    if len(items) >= _MIN_ITEMS_FOR_QUANTIFY and ratio < _QUANTIFY_RATIO_MIN:
        issues.append(
            AtsIssue(
                category="format",
                severity="medium",
                title="描述缺少量化",
                detail=(
                    f"{len(items)} 条描述里只有 {round(ratio * 100)}% 带数字或百分比，"
                    "成果难以被量化评估"
                ),
                suggestion="给关键条目补上规模、耗时、提升幅度等数字（只写真实数据）。",
            )
        )
    return issues


def _position_issues(resume: ResumeContent) -> list[AtsIssue]:
    issues: list[AtsIssue] = []
    if not resume.job_intent.strip():
        issues.append(
            AtsIssue(
                category="position",
                severity="medium",
                title="缺少求职意向",
                detail="求职意向应放在顶部显眼位置，方便 ATS 与 HR 快速定位",
                suggestion="在姓名下方加一行「求职意向：后端开发工程师」这类明确表述。",
            )
        )
    if not resume.summary.strip():
        issues.append(
            AtsIssue(
                category="position",
                severity="medium",
                title="缺少个人总结",
                detail="个人总结缺失，ATS 难以快速抓取你的核心卖点",
                suggestion="用 2–3 句话写清年限、方向与最强的一项成果。",
            )
        )
    if not resume.education:
        issues.append(
            AtsIssue(
                category="position",
                severity="medium",
                title="缺少教育经历",
                detail="教育经历缺失；应届生建议把它放在靠前位置",
                suggestion="补上学校、专业、学历与起止时间。",
            )
        )
    if not resume.skills:
        issues.append(
            AtsIssue(
                category="position",
                severity="medium",
                title="缺少技能清单",
                detail="技能应单列成块，便于关键词命中",
                suggestion="把技能单列成「技能」区块，用逗号分隔具体工具与语言。",
            )
        )
    return issues


def _subscore(issues: list[AtsIssue], category: str) -> int:
    """单个分项的分数：100 分往下扣，扣到 0 为止。"""
    penalty = sum(
        _SEVERITY_PENALTY.get(issue.severity, 0) for issue in issues if issue.category == category
    )
    return max(0, 100 - penalty)


def _subscore_format(issues: list[AtsIssue]) -> int:
    return _subscore(issues, "format")


def _subscore_keyword(issues: list[AtsIssue], ratio: float) -> int:
    """关键词分项：基础扣分 + 量化加分（最多 10），再 clamp 到 100。"""
    bonus = min(_QUANTIFY_BONUS_MAX, round(ratio * _QUANTIFY_BONUS_MAX))
    return min(100, _subscore(issues, "keyword") + bonus)


def _subscore_position(issues: list[AtsIssue]) -> int:
    return _subscore(issues, "position")


def _total_score(subscores: dict[str, int]) -> int:
    """加权总分：格式 40% + 关键词 40% + 位置 20%。"""
    total = (
        _WEIGHT_FORMAT * subscores.get("format", 0)
        + _WEIGHT_KEYWORD * subscores.get("keyword", 0)
        + _WEIGHT_POSITION * subscores.get("position", 0)
    )
    return max(0, min(100, round(total)))


__all__ = [
    "quantified_ratio",
    "_QUANTIFY_BONUS_MAX",
    "_QUANTIFY_RATIO_MIN",
    "_SEVERITY_PENALTY",
    "_WEIGHT_FORMAT",
    "_WEIGHT_KEYWORD",
    "_WEIGHT_POSITION",
    "_contact_format_issues",
    "_date_issues",
    "_dated_records",
    "_description_issues",
    "_description_items",
    "_find_special_chars",
    "_format_issues",
    "_is_date_text",
    "_is_quantified",
    "_parse_date",
    "_position_issues",
    "_subscore",
    "_subscore_format",
    "_subscore_keyword",
    "_subscore_position",
    "_total_score",
]
