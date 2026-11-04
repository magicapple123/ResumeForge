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
    _ALIASES,
    _ATS_KEYWORDS_PATH,
    _CHINESE_PHRASE_RE,
    _CHINESE_SUFFIXES,
    _GENERIC_ABBREVIATIONS,
    _JD_STOPWORDS,
    _JD_TOKEN_RE,
    _MAX_JD_PHRASES,
    _MAX_JD_TOKENS,
    _MAX_TARGET_KEYWORDS,
    _MISSING_HIGH_RATIO,
    _MISSING_MEDIUM_RATIO,
    _NOISE_WORDS,
    _PHRASE_NOISE_CHARS,
    _PHRASE_NOISE_PREFIXES,
    _SECTION_ORDER,
    _STUFFING_COUNT,
    _STUFFING_TITLE,
    KeywordAnalysis,
    _dedupe_words,
    _header_text,
    _jd_chinese_phrases,
    _jd_library_hits,
    _jd_tech_tokens,
    _join_parts,
    _keyword_analysis,
    _keyword_issues,
    _missing_severity,
    _resume_text,
    _section_texts,
    _strip_phrase_noise,
    _target_keywords,
    _target_tiers,
    is_jd_token_allowed,
    jd_keyword_tiers,
    keyword_count,
    load_keywords,
    normalize_alias,
    normalize_phrase_aliases,
    required_jd_text,
    split_compound,
)

# re-export：产物解析检查（真实 PDF 能否被读出来）。
from .ats_parse_check import parse_check_issues  # noqa: F401  (对外的兼容导入面)

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


def check_ats(
    resume: ResumeContent | dict,
    jd_text: str = "",
    *,
    resume_id: int = 0,
    parse_check: bool = False,
) -> AtsCheckOut:
    """ATS 本地检测：三类结论 + 分项分数 + 免责声明。纯本地计算，不调用模型。

    没有 JD（或 JD 抽不出任何目标词）时**不计关键词分项**，``score`` 为 ``None``：
    覆盖率是关键词分项的唯一来源，没有分母就没有这一项，"没有这一项"必须能被表达，
    不能拿通用词库顶替（那会对非技术岗位给出系统性误判的分）。

    ``parse_check`` 打开时额外真渲染一遍 PDF、抽回文本做**产物解析检查**
    （``ats_parse_check.parse_check_issues``）：多一条 format 类问题，但**不加新分项、
    不改 0.4/0.4/0.2 的加权口径**。默认关闭——渲染有成本，只有 ATS 面板这个面向用户的
    出口需要，简历检查（preflight）已经自己渲染过一次，不应该再付一次。
    """
    analysis = _keyword_analysis(resume, jd_text)
    issues = (
        _format_issues(resume)
        + _contact_format_issues(resume)
        + _date_issues(resume)
        + _description_issues(resume)
        + _keyword_issues(analysis)
        + _position_issues(resume)
    )
    if parse_check:
        issues += parse_check_issues(resume)
    ratio = quantified_ratio(resume)
    subscores = {
        # 量化加分落在格式分项（"描述带数字的比例"描述的是格式/量化，不是关键词）。
        "format": _subscore_format(issues, ratio),
        "position": _subscore_position(issues),
    }
    # 关键词分项直接由覆盖率决定：覆盖率就是用户的"匹配度"。覆盖率缺失 = 没有目标词 →
    # 这一项不参与计分（也因此总分返回 None），而不是按满分 100 计。
    if analysis.coverage_ratio is not None:
        subscores["keyword"] = _subscore_keyword(issues, analysis.coverage_ratio)
    # 三个类别即使一条问题都没有也保留 0 计数：前端按固定 key 渲染，"0 条"与"缺 key"
    # 是两件事。注意条数口径与计分口径不同——没有 JD 时关键词**不参与计分**（不出现在
    # subscores），但它仍然是一个已知类别，条数恒为 0，不需要从 summary 里一起消失。
    summary: dict[str, int] = {category: 0 for category in ("format", "keyword", "position")}
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
        supplementary_coverage_ratio=analysis.supplementary_coverage_ratio,
        keyword_hits=analysis.hits,
    )


__all__ = [
    "ATS_DISCLAIMER",
    "KeywordAnalysis",
    "check_ats",
    "load_keywords",
    "parse_check_issues",
    "quantified_ratio",
]
