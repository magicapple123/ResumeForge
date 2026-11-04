# SPDX-License-Identifier: Apache-2.0
"""ATS 检测的**关键词域**：词库加载、分区文本抽取、命中统计与两档覆盖率。

拆分自 ``services/ats_check.py``（原 834 行超预算）。本模块只做「词」相关的事：

- 加载 ``data/ats_keywords.json`` 词库（``load_keywords``，带缓存）；
- 把简历拍平成可检索文本（页头 + 各分区），并给出分区归属；
- 统计命中/缺失/覆盖率（``KeywordAnalysis``）并生成关键词类问题。

JD 抽词住在 ``ats_jd_tokens.py``，别名与白名单住在 ``ats_aliases.py``；规则判定住在
``ats_rules.py``；对外编排仍在 ``ats_check.py``（它 re-export 本模块的全部符号，
历史上从 ``ats_check`` 直接 import 内部符号的调用点无需改动）。

**两档覆盖率（2026-11）**：核心词（命中词库/别名）与补充词（JD 抽取）分开算，
``coverage_ratio`` 优先只反映核心词——碎片进不了分母，用户看到的百分比才有意义；
**核心词为空时**退回补充词做分母（否则"没有分母"会被误当成 100%），两者都为空才
返回 ``None``（= 没有可比对的关键词）。
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

from ..schemas.ats import AtsIssue, AtsSeverity
from ..schemas.resume import ResumeContent
from .ats_aliases import (  # noqa: F401  (对外的兼容导入面)
    _ALIASES,
    _GENERIC_ABBREVIATIONS,
    _JD_STOPWORDS,
    _MIN_WHITELIST_LEN,
    _NOISE_WORDS,
    _PHRASE_ALIASES,
    alias_variants,
    is_jd_token_allowed,
    normalize_alias,
)
from .ats_jd_tokens import (  # noqa: F401  (对外的兼容导入面)
    _CHINESE_PHRASE_RE,
    _CHINESE_SUFFIXES,
    _CJK_RUN_RE,
    _JD_TOKEN_RE,
    _MAX_JD_PHRASES,
    _MAX_JD_TOKENS,
    _PHRASE_BAD_PREFIXES,
    _PHRASE_GENERIC_ONLY,
    _PHRASE_NOISE_CHARS,
    _PHRASE_NOISE_PREFIXES,
    _jd_chinese_phrases,
    _jd_tech_tokens,
    _strip_phrase_noise,
    jd_keyword_tiers,
    normalize_phrase_aliases,
    required_jd_text,
    split_compound,
)
from .ats_text import (  # noqa: F401
    _SECTION_ORDER,
    _header_text,
    _join_parts,
    _resume_text,
    _section_texts,
)

_ATS_KEYWORDS_PATH = Path(__file__).resolve().parent.parent / "data" / "ats_keywords.json"

# 同一个词出现超过这个次数就是堆砌（ATS 与 HR 都会判定为刻意塞词）。
_STUFFING_COUNT = 6
# 「关键词重复堆砌」的标题：评分侧按这个标题把堆砌扣分从关键词分项里单独扣。
_STUFFING_TITLE = "关键词重复堆砌"
# 覆盖率问题的严重程度分档（缺失比例 ≥60% → high，≥25% → medium，其余 low）。
_MISSING_HIGH_RATIO = 0.6
_MISSING_MEDIUM_RATIO = 0.25
# 目标词两档各自的封顶（核心词 40 / 补充词 40）。核心词封顶沿用历史值 40。
_MAX_TARGET_KEYWORDS = 40
# 英文关键词按**词边界**计数：否则 "Go" 会在 "django" 里命中、"Java" 会在 "JavaScript" 里命中。
_ASCII_KEYWORD_RE = re.compile(r"^[a-z0-9][a-z0-9 +#./-]*$")


class KeywordAnalysis(NamedTuple):
    """关键词分析的完整结果（命中清单 / 缺失清单 / 两档覆盖率）。

    ``coverage_ratio`` 为 ``None`` 表示**没有可比对的关键词**（没有 JD，或 JD 里一个
    目标词都抽不到）：这时既不能说 100%（会白送满分）也不能说 0%（会冤枉用户），
    只能如实说"需要 JD"。关键词分项也因此不参与计分。
    """

    target: list[str]
    hits: list[dict]
    matched: list[str]
    missing: list[str]
    coverage_ratio: float | None
    # 两档明细（旧调用方只读前五个字段，这里给默认值保持向后兼容）。
    core_target: list[str] = []
    core_missing: list[str] = []
    supplementary_target: list[str] = []
    supplementary_missing: list[str] = []
    supplementary_coverage_ratio: float = 0.0


@lru_cache(maxsize=1)
def load_keywords() -> tuple[str, ...]:
    """加载 ATS 通用关键词词库，按分类展平并去重（保持大小写原貌）。

    词库扩容后 JSON 会明显变大，且每次检测都要用——所以结果缓存；文件本身随代码发布，
    不随请求变化。
    """
    data = json.loads(_ATS_KEYWORDS_PATH.read_text(encoding="utf-8"))
    categories = data.get("categories", {})
    words: list[str] = []
    seen: set[str] = set()
    for values in categories.values():
        for word in values:
            if not isinstance(word, str) or not word.strip():
                continue
            key = word.strip().lower()
            if key in seen:
                continue
            seen.add(key)
            words.append(word.strip())
    return tuple(words)


@lru_cache(maxsize=512)
def _keyword_pattern(needle: str) -> re.Pattern[str] | None:
    """英文关键词的词边界匹配器；中文词没有词边界，返回 None 走子串计数。"""
    if not _ASCII_KEYWORD_RE.match(needle):
        return None
    return re.compile(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])")


def keyword_count(text_lower: str, needle: str) -> int:
    """关键词在文本里出现的次数（英文按词边界，中文按子串）。

    别名算命中且**双向**：目标词是 ``PostgreSQL`` 时，简历里写 ``Postgres`` / ``pgsql``
    同样计数（反之亦然）——写法差异不该被当成"没写"。
    """
    if not needle:
        return 0
    total = 0
    for variant in alias_variants(needle):
        pattern = _keyword_pattern(variant)
        total += text_lower.count(variant) if pattern is None else len(pattern.findall(text_lower))
    return total


def _contains_keyword(text_lower: str, word: str) -> bool:
    return keyword_count(text_lower, word.lower()) > 0


def _jd_library_hits(jd_text: str, library: list[str] | tuple[str, ...]) -> list[str]:
    """从词库里挑出 JD 文本中出现的那些词（保持词库里的原大小写）。"""
    jd_lower = normalize_phrase_aliases(jd_text).lower()
    return [word for word in library if _contains_keyword(jd_lower, word.lower())]


def _dedupe_words(words: list[str]) -> list[str]:
    """按小写去重（保留第一次出现的原大小写与顺序）。"""
    result: list[str] = []
    seen: set[str] = set()
    for word in words:
        key = word.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(word.strip())
    return result


def _target_tiers(jd_text: str, library: list[str] | tuple[str, ...]) -> tuple[list[str], list[str]]:
    """本次检测的两档目标词：核心词（要求段里的词库/别名命中）与补充词（JD 抽取）。

    **没有 JD 就没有目标词**——不再拿内置词库顶替。词库只有技术领域，对兽医/医学/教育
    等岗位做分母等于系统性误判（覆盖率恒为 0，总分却被加权成一个看着很真的数字）。
    JD 里一个词都抽不到时同样返回空：没有目标就没有"未覆盖"，由上报口径说"需要 JD"。

    词库扫描只看要求段——「加分项：Kubernetes」里的词是建议不是门槛，进核心分母只会
    压低覆盖率。
    """
    if not jd_text.strip():
        return [], []
    core, supplemental = jd_keyword_tiers(jd_text, list(library))
    core = _dedupe_words(_jd_library_hits(required_jd_text(jd_text), library) + core)[
        :_MAX_TARGET_KEYWORDS
    ]
    supplemental = _dedupe_words(supplemental)[:_MAX_TARGET_KEYWORDS]
    return core, supplemental


def _target_keywords(jd_text: str, library: list[str] | tuple[str, ...]) -> list[str]:
    """两档目标词拼成的完整清单（核心词在前）。"""
    core, supplemental = _target_tiers(jd_text, library)
    return core + supplemental


def _keyword_analysis(resume: ResumeContent | dict, jd_text: str) -> KeywordAnalysis:
    """关键词命中清单 + 缺失清单 + 两档覆盖率。"""
    library = load_keywords()
    core, supplemental = _target_tiers(jd_text, library)
    resume_lower = _resume_text(resume)
    sections_lower = {name: text.lower() for name, text in _section_texts(resume).items()}
    hits: list[dict] = []
    matched: list[str] = []
    missing: list[str] = []
    for word, tier in [(word, "core") for word in core] + [
        (word, "supplementary") for word in supplemental
    ]:
        count = keyword_count(resume_lower, word.lower())
        hit = count > 0
        hits.append(
            {
                "keyword": word,
                "matched": hit,
                "count": count,
                "sections": [
                    name for name in sections_lower if _contains_keyword(sections_lower[name], word.lower())
                ],
                "tier": tier,
            }
        )
        (matched if hit else missing).append(word)
    core_matched = [hit["keyword"] for hit in hits if hit["tier"] == "core" and hit["matched"]]
    core_missing = [hit["keyword"] for hit in hits if hit["tier"] == "core" and not hit["matched"]]
    supp_matched = [
        hit["keyword"] for hit in hits if hit["tier"] == "supplementary" and hit["matched"]
    ]
    supp_missing = [
        hit["keyword"] for hit in hits if hit["tier"] == "supplementary" and not hit["matched"]
    ]
    # **分母口径（2026-11）**：核心词为空说明 JD 里没有可比对的词库词，这时退回
    # "核心 + 补充"（= 补充词）做分母——绝不能在没有分母的情况下记 100%；两者都为空
    # 才是"这份输入根本没有可比对的关键词"，覆盖率记 None，由前端如实说明。
    # 旧口径（核心词为空 → 1.0）会让覆盖率 0% 的简历拿到关键词 98 分、总分 92。
    denominator = core or supplemental
    denominator_matched = core_matched if core else supp_matched
    coverage: float | None = (
        len(denominator_matched) / len(denominator) if denominator else None
    )
    supp_coverage = len(supp_matched) / len(supplemental) if supplemental else 0.0
    return KeywordAnalysis(
        target=core + supplemental,
        hits=hits,
        matched=matched,
        missing=missing,
        coverage_ratio=coverage,
        core_target=core,
        core_missing=core_missing,
        supplementary_target=supplemental,
        supplementary_missing=supp_missing,
        supplementary_coverage_ratio=supp_coverage,
    )


def _missing_severity(missing_ratio: float) -> AtsSeverity:
    """按**缺失比例**给严重程度：缺得越多越该先补。

    缺 1 个和缺 12 个核心词只出一条 ``medium``（-12）是旧口径的第二个漏洞：覆盖率 0%
    与覆盖率 90% 在问题列表里长得一模一样。分档后"缺一大半"才会显眼。
    返回类型必须是 ``AtsSeverity`` 字面量联合——``AtsIssue.severity`` 只收字面量，
    标成 ``str`` 会让 pyright（CI 关卡）报错。
    """
    if missing_ratio >= _MISSING_HIGH_RATIO:
        return "high"
    if missing_ratio >= _MISSING_MEDIUM_RATIO:
        return "medium"
    return "low"


def _keyword_issues(analysis: KeywordAnalysis) -> list[AtsIssue]:
    """关键词类问题：只按**计分那一档**算覆盖不足；补充词仅作为提示出现在详情里。

    补充词来自 JD 的自由文本（项目名、口语描述），把它们算进扣分等于用噪音惩罚用户——
    所以它们不产生问题条目，只在详情里说明"另有 N 个补充词未命中"。**例外**：核心词
    一个都没有时，补充词就是覆盖率的分母（与 ``coverage_ratio`` 同口径），此时它们
    必须产生条目，否则分数掉了却没有任何解释。
    """
    issues: list[AtsIssue] = []
    # 计分档：有核心词就只算核心词，没有核心词才算补充词。
    scored_target = analysis.core_target or analysis.supplementary_target
    scored_missing = analysis.core_missing if analysis.core_target else analysis.supplementary_missing
    if scored_missing and analysis.coverage_ratio is not None:
        ratio_percent = round(analysis.coverage_ratio * 100)
        tier_label = "核心关键词" if analysis.core_target else "JD 关键词"
        extra = (
            f"；另有 {len(analysis.supplementary_missing)} 个 JD 补充词未命中，不计入覆盖率"
            if analysis.core_target and analysis.supplementary_missing
            else ""
        )
        issues.append(
            AtsIssue(
                category="keyword",
                severity=_missing_severity(1 - analysis.coverage_ratio),
                title="关键词覆盖不足",
                detail=(
                    f"有 {len(scored_missing)} 个{tier_label}未出现在简历中"
                    f"（共 {len(scored_target)} 个），"
                    f"关键词覆盖率 {ratio_percent}%，可能影响 ATS 匹配{extra}"
                ),
                evidence=scored_missing[:10],
                # 后端只写原因，不写"请"：祈使语气由前端 errorGuidance 统一给。
                suggestion="把真正掌握的缺失词写进技能或对应项目描述里，别硬凑。",
            )
        )
    stuffed = [hit for hit in analysis.hits if hit["count"] > _STUFFING_COUNT]
    if stuffed:
        issues.append(
            AtsIssue(
                category="keyword",
                severity="low",
                title=_STUFFING_TITLE,
                detail=(
                    f"有 {len(stuffed)} 个关键词出现超过 {_STUFFING_COUNT} 次，"
                    "重复堆砌会被 ATS 与 HR 判定为刻意塞词"
                ),
                evidence=[f"{hit['keyword']} ×{hit['count']}" for hit in stuffed[:5]],
                suggestion="每个关键词出现 2–3 次即可，把重复处换成具体的做法与结果。",
            )
        )
    return issues


__all__ = [
    "KeywordAnalysis",
    "_ALIASES",
    "_ATS_KEYWORDS_PATH",
    "_CHINESE_PHRASE_RE",
    "_CHINESE_SUFFIXES",
    "_CJK_RUN_RE",
    "_GENERIC_ABBREVIATIONS",
    "_JD_STOPWORDS",
    "_JD_TOKEN_RE",
    "_MAX_JD_PHRASES",
    "_MAX_JD_TOKENS",
    "_MAX_TARGET_KEYWORDS",
    "_MIN_WHITELIST_LEN",
    "_MISSING_HIGH_RATIO",
    "_MISSING_MEDIUM_RATIO",
    "_NOISE_WORDS",
    "_PHRASE_ALIASES",
    "_PHRASE_BAD_PREFIXES",
    "_PHRASE_GENERIC_ONLY",
    "_PHRASE_NOISE_CHARS",
    "_PHRASE_NOISE_PREFIXES",
    "_SECTION_ORDER",
    "_STUFFING_COUNT",
    "_STUFFING_TITLE",
    "_dedupe_words",
    "_header_text",
    "_jd_chinese_phrases",
    "_jd_library_hits",
    "_jd_tech_tokens",
    "_join_parts",
    "_keyword_analysis",
    "_keyword_issues",
    "_missing_severity",
    "_resume_text",
    "_section_texts",
    "_strip_phrase_noise",
    "_target_keywords",
    "_target_tiers",
    "alias_variants",
    "is_jd_token_allowed",
    "jd_keyword_tiers",
    "keyword_count",
    "load_keywords",
    "normalize_alias",
    "normalize_phrase_aliases",
    "required_jd_text",
    "split_compound",
]
