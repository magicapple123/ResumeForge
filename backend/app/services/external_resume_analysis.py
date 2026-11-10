# SPDX-License-Identifier: Apache-2.0
"""外部简历的**文本级**检查（清单 `21.4）：纯规则、不调模型、不给总分。

外部简历只有"一段从文件里提取出来的纯文本"，没有结构化条目、没有纸面位置、也没有
真实渲染，所以这里**只做文本能证明的结论**：占位符、量化比例、联系方式、长度与篇幅、
弱表述，以及"有 JD 时才出"的关键词覆盖。版式检查、字段完整性、分页准确度、ATS 解析
都不做——没有结构就拿不到，硬做只会给出"假精确"的分数（清单 `21.7 第 3 条）。

**为什么没有总分**：五个分项的单位互不相干（条数 / 比例 / 字数 / 覆盖率），加成一个
0–100 的数字只会让人误以为它是"这份简历的得分"。所有结论条目化，每条带行号与原文片段。

口径（与 ats 检测一致的部分）：

- 量化比例 = 含数字或百分号的行 / 非空内容行；
- 弱表述 = "负责了 / 参与了 / 协助了……"开头的行 / 非空内容行；
- 关键词覆盖率只在**有 JD** 时出现：目标词由 `ats_keywords._target_tiers` 抽取
  （与 ATS 检测同一份词库、"要求段"过滤与别名规则），分母 = 目标词数、分子 = 命中的
  目标词数。没有 JD、或 JD 里一个目标词都抽不到时**不出现该分项**（不是 0 分）——
  没有分母就没有分项，与 `check_ats` 的 `coverage_ratio=None` 同一口径。

**为什么统计"行"而不是"句"**：简历正文的条目本来就是一行一条，"行"既是用户能对上
的位置（行号），也不依赖中文分句（分号、顿号、无标点混排都会让句子切分失真）。
"""

from __future__ import annotations

import re

from ..models.claim import has_placeholder
from ..schemas.external_resume import (
    AnalysisCheck,
    AnalysisHit,
    ExternalResumeAnalysisOut,
    KeywordCoverage,
)
from .ats_keywords import _target_tiers, keyword_count, load_keywords

# 估算页数的口径：一页 A4 中文简历的正文大约 1200 字（含标题与空行）。只用于展示
# "大概几页"，不做版式检查——真实页数要渲染 PDF 才知道，那不在本模块的诚实范围内。
CHARS_PER_PAGE = 1200
# 每条检查最多回多少条原文片段：列表/抽屉只需要"看几条典型"，count 才是全量。
MAX_ITEMS = 10
# 原文片段的最大长度：足够认出是哪一行，又不至于把整段简历塞进响应。
SNIPPET_CHARS = 120

# 行首的项目符号与序号：判断"弱表述开头"前先剥掉它们，否则 "- 负责了..." 与
# "1. 负责了..." 会漏判。
_BULLET_PREFIX = re.compile(r"^[\s\-*•·▪◦●○]*(?:\d+[.、)）]|[（(]\d+[）)])?\s*")
_WEAK_PREFIXES = ("负责了", "参与了", "协助了", "帮助了", "配合了", "支持了")
_DIGIT_RE = re.compile(r"\d")
_PERCENT_RE = re.compile(r"[%％]")
# 联系方式在**自由文本**里的形态：ats_rules 的两条正则是给结构化字段做整串匹配的
# （^...$），直接拿来搜正文会把"手机号后面跟着别的字"整行漏掉。这里改成搜索式，
# 但保留同样的格式边界（手机号 11 位、前面不能再接数字）。
_PHONE_IN_TEXT = re.compile(r"(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)")
_EMAIL_IN_TEXT = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def _content_lines(text: str) -> list[tuple[int, str, str]]:
    """非空内容行：`(行号, 剥掉项目符号后的文本, 原始行)`（行号 1 基）。"""
    rows: list[tuple[int, str, str]] = []
    for number, raw_line in enumerate(text.splitlines(), start=1):
        cleaned = _BULLET_PREFIX.sub("", raw_line).strip()
        if cleaned:
            rows.append((number, cleaned, raw_line.strip()))
    return rows


def _snippet(text: str) -> str:
    body = (text or "").strip()
    return body if len(body) <= SNIPPET_CHARS else f"{body[:SNIPPET_CHARS]}…"


def _hit(number: int, text: str) -> AnalysisHit:
    return AnalysisHit(line=number, text=_snippet(text))


def _ratio(count: int, sample_size: int) -> float:
    return round(count / sample_size, 3) if sample_size else 0.0


def _placeholder_check(rows: list[tuple[int, str, str]]) -> AnalysisCheck:
    hits = [_hit(number, raw) for number, _cleaned, raw in rows if has_placeholder(raw)]
    return AnalysisCheck(
        key="placeholder",
        count=len(hits),
        sample_size=len(rows),
        items=hits[:MAX_ITEMS],
    )


def _quantification_check(rows: list[tuple[int, str, str]]) -> AnalysisCheck:
    quantified = [
        (number, raw)
        for number, cleaned, raw in rows
        if _DIGIT_RE.search(cleaned) or _PERCENT_RE.search(cleaned)
    ]
    return AnalysisCheck(
        key="quantification",
        count=len(quantified),
        ratio=_ratio(len(quantified), len(rows)),
        sample_size=len(rows),
        # 量化检查只报比例与少量样例，不逐条列出"哪些行没有数字"：一份简历没数字的行
        # 占大多数，列出来只是噪音。用户对着行号回去看即可。
        items=[_hit(number, raw) for number, raw in quantified[:3]],
    )


def _contact_check(rows: list[tuple[int, str, str]]) -> AnalysisCheck:
    hits: list[AnalysisHit] = []
    total = 0
    for number, _cleaned, raw in rows:
        matches = _PHONE_IN_TEXT.findall(raw) + _EMAIL_IN_TEXT.findall(raw)
        if matches:
            total += len(matches)
            hits.append(_hit(number, raw))
    return AnalysisCheck(
        key="contact",
        count=total,
        sample_size=len(rows),
        items=hits[:MAX_ITEMS],
    )


def _weak_wording_check(rows: list[tuple[int, str, str]]) -> AnalysisCheck:
    weak = [(number, raw) for number, cleaned, raw in rows if cleaned.startswith(_WEAK_PREFIXES)]
    return AnalysisCheck(
        key="weak_wording",
        count=len(weak),
        ratio=_ratio(len(weak), len(rows)),
        sample_size=len(rows),
        items=[_hit(number, raw) for number, raw in weak[:MAX_ITEMS]],
    )


def _keyword_check(text: str, jd_text: str) -> AnalysisCheck | None:
    """有 JD 且能抽出目标词时才返回关键词分项；否则返回 None（分项不出现，不是 0 分）。"""
    if not jd_text.strip():
        return None
    target, _supplemental = _target_tiers(jd_text, load_keywords())
    if not target:
        return None
    text_lower = text.lower()
    matched = [word for word in target if keyword_count(text_lower, word.lower()) > 0]
    missing = [word for word in target if word not in matched]
    coverage = round(len(matched) / len(target), 3)
    return AnalysisCheck(
        key="keywords",
        count=len(matched),
        ratio=coverage,
        sample_size=len(target),
        keywords=KeywordCoverage(
            target=target,
            matched=matched,
            missing=missing,
            coverage_ratio=coverage,
        ),
    )


def analyze_external_resume(
    text: str, *, jd_text: str = "", resume_id: int = 0
) -> ExternalResumeAnalysisOut:
    """对一段提取出来的简历正文做文本级检查。

    `jd_text` 为空 = 没有关联 JD：关键词分项**不出现**（不是 0 分），其余五项照常。
    `text` 为空 = 这份文件没有文字层：`has_text=False` 且 `checks` 为空——界面据此
    显示「未提取到文字」，绝不给一个"检查通过"的错觉。
    """
    body = (text or "").strip()
    if not body:
        return ExternalResumeAnalysisOut(
            resume_id=resume_id,
            text_chars=0,
            line_count=0,
            estimated_pages=0.0,
            has_text=False,
            checks=[],
            warnings=["这份简历没有提取到文字，无法做文本检查"],
        )

    rows = _content_lines(body)
    checks = [
        _placeholder_check(rows),
        _quantification_check(rows),
        _contact_check(rows),
        # 长度与篇幅：count = 字数、sample_size = 内容行数；估算页数由接口顶层字段给。
        AnalysisCheck(key="length", count=len(body), sample_size=len(rows), items=[]),
        _weak_wording_check(rows),
    ]
    keyword_check = _keyword_check(body, jd_text)
    if keyword_check is not None:
        checks.append(keyword_check)
    return ExternalResumeAnalysisOut(
        resume_id=resume_id,
        text_chars=len(body),
        line_count=len(rows),
        estimated_pages=round(len(body) / CHARS_PER_PAGE, 1),
        has_text=True,
        checks=checks,
        warnings=[],
    )


__all__ = [
    "CHARS_PER_PAGE",
    "MAX_ITEMS",
    "SNIPPET_CHARS",
    "analyze_external_resume",
]
