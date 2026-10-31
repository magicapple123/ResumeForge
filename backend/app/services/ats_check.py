# SPDX-License-Identifier: Apache-2.0
"""ATS 本地检测（R-10 / R13）：格式风险 / 关键词覆盖 / 信息位置。

**本地规则估计**：这里用的是通用启发式规则，结果只作参考——**不代表真实 ATS 解析结果**。
所有结论都在输出的 ``disclaimer`` 里声明，前端必须展示。整条链路**纯本地计算，不调模型**。

- 格式风险：关键字段缺失、联系方式格式、日期格式与区间、过长段落、量化不足、正文里的
  特殊符号（可能被 ATS 误解析）。
- 关键词覆盖：对照 ``data/ats_keywords.json`` 词库；提供了 JD 文本时，先抽 JD 里的目标词
  （词库交集 + 英文技术 token + 中文短语后缀），再检查覆盖率；未提供 JD 时做通用覆盖。
- 信息位置：求职意向 / 个人总结 / 教育 / 技能等关键区块是否就位。

评分（R13）拆成三个分项再加权，而不是把所有问题堆进一个总分：用户看到「关键词 40 分、
位置 100 分」才知道该从哪下手；一个笼统的 62 分只会让人无从改起。

**模块结构（2026-10 拆分，为满足单文件 500 行预算）**：

- ``ats_keywords.py``：词库加载、分区文本抽取、JD 抽词、覆盖率与关键词类问题；
- ``ats_rules.py``：格式/联系方式/日期/量化/位置判定与三个分项打分；
- 本模块只保留对外编排 ``check_ats``，并把两个子模块的全部符号 re-export——
  历史上 ``from app.services.ats_check import _subscore_format`` / ``load_keywords``
  之类的导入（含测试与 monkeypatch 落点）**全部照旧可用**。
"""

from __future__ import annotations

from ..schemas.ats import ATS_DISCLAIMER, AtsCheckOut
from ..schemas.resume import ResumeContent

# re-export：关键词域（词库 / 抽取 / 覆盖率）。
from .ats_keywords import (  # noqa: F401  (对外的兼容导入面)
    _ATS_KEYWORDS_PATH,
    _CHINESE_PHRASE_RE,
    _CHINESE_SUFFIXES,
    _JD_STOPWORDS,
    _JD_TOKEN_RE,
    _MAX_JD_PHRASES,
    _MAX_JD_TOKENS,
    _MAX_TARGET_KEYWORDS,
    _PHRASE_NOISE_CHARS,
    _PHRASE_NOISE_PREFIXES,
    _SECTION_ORDER,
    _STUFFING_COUNT,
    KeywordAnalysis,
    _dedupe_words,
    _header_text,
    _jd_chinese_phrases,
    _jd_library_hits,
    _jd_tech_tokens,
    _join_parts,
    _keyword_analysis,
    _keyword_issues,
    _resume_text,
    _section_texts,
    _strip_phrase_noise,
    _target_keywords,
    load_keywords,
)

# re-export：规则与评分域。
from .ats_rules import (  # noqa: F401  (对外的兼容导入面)
    _DATE_PRESENT,
    _DATE_RE,
    _DIGIT_RE,
    _EMAIL_RE,
    _LONG_PARAGRAPH_CHARS,
    _MIN_ITEMS_FOR_QUANTIFY,
    _PERCENT_RE,
    _PHONE_RE,
    _QUANTIFY_BONUS_MAX,
    _QUANTIFY_RATIO_MIN,
    _SEVERITY_PENALTY,
    _SPECIAL_CHAR_RE,
    _WEIGHT_FORMAT,
    _WEIGHT_KEYWORD,
    _WEIGHT_POSITION,
    _contact_format_issues,
    _date_issues,
    _dated_records,
    _description_issues,
    _description_items,
    _find_special_chars,
    _format_issues,
    _is_date_text,
    _is_quantified,
    _parse_date,
    _position_issues,
    _subscore,
    _subscore_format,
    _subscore_keyword,
    _subscore_position,
    _total_score,
    quantified_ratio,
)


def check_ats(resume: ResumeContent | dict, jd_text: str = "", *, resume_id: int = 0) -> AtsCheckOut:
    """ATS 本地检测：三类结论 + 分项分数 + 免责声明。纯本地计算，不调用模型。"""
    analysis = _keyword_analysis(resume, jd_text)
    issues = (
        _format_issues(resume)
        + _contact_format_issues(resume)
        + _date_issues(resume)
        + _description_issues(resume)
        + _keyword_issues(analysis)
        + _position_issues(resume)
    )
    ratio = quantified_ratio(resume)
    subscores = {
        "format": _subscore_format(issues),
        "keyword": _subscore_keyword(issues, ratio),
        "position": _subscore_position(issues),
    }
    summary: dict[str, int] = {}
    for issue in issues:
        summary[issue.category] = summary.get(issue.category, 0) + 1
    return AtsCheckOut(
        resume_id=resume_id,
        issues=issues,
        matched_keywords=analysis.matched,
        missing_keywords=analysis.missing,
        score=_total_score(subscores),
        disclaimer=ATS_DISCLAIMER,
        summary=summary,
        subscores=subscores,
        coverage_ratio=analysis.coverage_ratio,
        keyword_hits=analysis.hits,
    )


__all__ = [
    "ATS_DISCLAIMER",
    "KeywordAnalysis",
    "check_ats",
    "load_keywords",
    "quantified_ratio",
]
