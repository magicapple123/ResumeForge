# SPDX-License-Identifier: Apache-2.0
"""ATS 检测的**关键词域**：词库加载、分区文本抽取、JD 抽词、覆盖率统计。

拆分自 ``services/ats_check.py``（原 834 行超预算）。本模块只做「词」相关的事：

- 加载 ``data/ats_keywords.json`` 词库（``load_keywords``）；
- 把简历拍平成可检索文本（页头 + 七个分区），并给出分区归属；
- 从 JD 里抽目标词（词库交集 + 英文技术 token + 中文短语后缀）；
- 统计命中/缺失/覆盖率（``KeywordAnalysis``）并生成关键词类问题。

规则判定（格式/日期/量化/位置/评分）住在 ``ats_rules.py``；对外编排仍在
``ats_check.py``（它 re-export 本模块的全部符号，历史上从 ``ats_check`` 直接
import 内部符号的调用点无需改动）。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import NamedTuple

from ..schemas.ats import AtsIssue
from ..schemas.resume import ResumeContent
from .ats_research import research_section_texts
from .resume.resume_rich_text import strip_markers

_ATS_KEYWORDS_PATH = Path(__file__).resolve().parent.parent / "data" / "ats_keywords.json"

# 同一个词出现超过这个次数就是堆砌（ATS 与 HR 都会判定为刻意塞词）。
_STUFFING_COUNT = 6
# JD 抽词的三个上限：技术 token 20、中文短语 20、目标词总数 40。
_MAX_JD_TOKENS = 20
_MAX_JD_PHRASES = 20
_MAX_TARGET_KEYWORDS = 40

# JD 里的英文技术词：C++ / C# / Node.js / CI/CD / scikit-learn 都应算一个 token。
_JD_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+#./-]{1,24}")

# 英文停用词：这些词在 JD 里高频出现，但对"ATS 关键词覆盖"没有区分度。
_JD_STOPWORDS = frozenset(
    {
        "a",
        "about",
        "ability",
        "able",
        "all",
        "also",
        "an",
        "and",
        "any",
        "applicant",
        "are",
        "as",
        "at",
        "be",
        "been",
        "benefits",
        "build",
        "building",
        "but",
        "by",
        "can",
        "candidate",
        "candidates",
        "company",
        "description",
        "etc",
        "excellent",
        "experience",
        "experiences",
        "familiar",
        "for",
        "from",
        "full",
        "get",
        "good",
        "has",
        "have",
        "help",
        "how",
        "if",
        "in",
        "is",
        "it",
        "job",
        "join",
        "knowledge",
        "location",
        "more",
        "must",
        "new",
        "not",
        "of",
        "on",
        "or",
        "other",
        "our",
        "part",
        "position",
        "preferred",
        "remote",
        "required",
        "requirements",
        "responsibilities",
        "salary",
        "should",
        "skill",
        "skills",
        "strong",
        "team",
        "than",
        "that",
        "the",
        "this",
        "time",
        "to",
        "us",
        "use",
        "used",
        "using",
        "we",
        "what",
        "when",
        "who",
        "why",
        "will",
        "with",
        "work",
        "would",
        "year",
        "years",
        "you",
        "your",
    }
)

# 中文短语的后缀：JD 里以这些词收尾的 2–8 字片段通常是可检索的技能/职责短语。
_CHINESE_SUFFIXES = (
    "开发",
    "设计",
    "优化",
    "架构",
    "测试",
    "运维",
    "分析",
    "管理",
    "算法",
    "数据",
    "系统",
    "平台",
    "服务",
    "接口",
    "性能",
    "安全",
    "部署",
    "监控",
    "调优",
    "建模",
    "挖掘",
    "推荐",
    "搜索",
    "风控",
    "增长",
    "运营",
    "产品",
    "项目",
    "团队",
    "沟通",
    "协作",
)
_CHINESE_PHRASE_RE = re.compile(r"([\u4e00-\u9fa5]{0,6}?(?:" + "|".join(_CHINESE_SUFFIXES) + r"))")
# 短语前常见的修饰词/虚词：剥掉之后才既能在简历里匹配到，又不至于都是同一个后缀。
_PHRASE_NOISE_PREFIXES = (
    "熟悉",
    "精通",
    "掌握",
    "了解",
    "具备",
    "具有",
    "要求",
    "负责",
    "参与",
    "至少",
    "相关",
    "以上",
    "能够",
    "可以",
    "良好",
    "扎实",
    "熟练",
    "使用",
    # "沟通能力和项目管理" → 先剥"能力"，再剥掉连词"和"，才剩下可匹配的"项目管理"。
    "能力",
)
_PHRASE_NOISE_CHARS = "的和与及在对为并或等有之其这那"

# 十个分区（同时也是 ``keyword_hits[*].sections`` 的取值集合；W14 加科研三栏目）。
_SECTION_ORDER = (
    "summary",
    "education",
    "experience",
    "campus_experience",
    "projects",
    "publications",
    "research_projects",
    "patents",
    "skills",
    "awards",
)


class KeywordAnalysis(NamedTuple):
    """关键词分析的完整结果（命中清单 / 缺失清单 / 覆盖率）。"""

    target: list[str]
    hits: list[dict]
    matched: list[str]
    missing: list[str]
    coverage_ratio: float


def load_keywords() -> list[str]:
    """加载 ATS 通用关键词词库，按分类展平并去重（保持大小写原貌）。"""
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
    return words


def _join_parts(*parts: str) -> str:
    """拼接可检索文本；**先剥字符级加粗标记**。

    关键词匹配比的是用户读到的字。``**Python**`` 里的标记会让 ``Python`` 与
    ``**Python**`` 变成两个不同的串，词库命中率凭空下降——同一个词在预览里加粗一次，
    ATS 分数就掉一档，这种"看不见的扣分"最难解释。
    """
    return strip_markers(" ".join(part for part in parts if part and part.strip()))


def _section_texts(resume: ResumeContent) -> dict[str, str]:
    """十个分区的可检索文本（保持字段原貌，匹配时再转小写）。

    分区的划分与简历模板一致：``sections`` 字段就是按这份清单报出来的，前端据此
    告诉用户"这个词出现在技能区"而不是笼统说"出现在简历里"。
    """
    return {
        "summary": strip_markers(resume.summary),
        "education": _join_parts(
            *[
                _join_parts(
                    item.school,
                    item.major,
                    item.degree,
                    item.gpa,
                    " ".join(item.courses),
                    " ".join(item.achievements),
                )
                for item in resume.education
            ]
        ),
        "experience": _join_parts(
            *[
                _join_parts(item.company, item.role, " ".join(item.description))
                for item in resume.experience
            ]
        ),
        "campus_experience": _join_parts(
            *[
                _join_parts(item.organization, item.role, " ".join(item.description))
                for item in resume.campus_experience
            ]
        ),
        "projects": _join_parts(
            *[
                _join_parts(
                    item.name,
                    item.role,
                    " ".join(item.tech_stack),
                    " ".join(item.description),
                    " ".join(item.highlights),
                )
                for item in resume.projects
            ]
        ),
        **research_section_texts(resume),
        "skills": _join_parts(*[_join_parts(item.name, item.level) for item in resume.skills]),
        "awards": _join_parts(
            *[_join_parts(item.name, item.description) for item in resume.awards]
        ),
    }


def _header_text(resume: ResumeContent) -> str:
    """页头字段（姓名/求职意向/联系方式/主页）：不含 photo，且不参与分区归属判断。"""
    return _join_parts(
        resume.name,
        resume.job_intent,
        resume.city,
        resume.phone,
        resume.email,
        resume.personal_website,
        resume.github,
    )


def _resume_text(resume: ResumeContent) -> str:
    """简历全量可检索文本（小写，排除 photo）。"""
    sections = _section_texts(resume)
    return f"{_header_text(resume)} {' '.join(sections.values())}".lower()


def _jd_library_hits(jd_text: str, library: list[str]) -> list[str]:
    """从词库里挑出 JD 文本中出现的那些词（保持词库里的原大小写）。"""
    jd_lower = jd_text.lower()
    return [word for word in library if word.lower() in jd_lower]


def _jd_tech_tokens(jd_text: str) -> list[str]:
    """JD 里出现的英文技术 token（小写去重、过滤停用词、最多 20 个）。"""
    tokens: list[str] = []
    seen: set[str] = set()
    for match in _JD_TOKEN_RE.finditer(jd_text):
        token = match.group(0).strip("-./").lower()
        if len(token) < 2 or token in _JD_STOPWORDS or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
        if len(tokens) >= _MAX_JD_TOKENS:
            break
    return tokens


def _strip_phrase_noise(phrase: str) -> str:
    """剥掉短语前的修饰词与虚词（"熟悉后端开发" → "后端开发"）。"""
    text = phrase
    changed = True
    while changed and len(text) > 2:
        changed = False
        for prefix in _PHRASE_NOISE_PREFIXES:
            if text.startswith(prefix) and len(text) - len(prefix) >= 2:
                text = text[len(prefix) :]
                changed = True
                break
        if changed:
            continue
        if text[0] in _PHRASE_NOISE_CHARS and len(text) > 2:
            text = text[1:]
            changed = True
    return text


def _jd_chinese_phrases(jd_text: str) -> list[str]:
    """从 JD 里按后缀抽 2–8 字中文短语（去重、最多 20 个）。"""
    phrases: list[str] = []
    seen: set[str] = set()
    for match in _CHINESE_PHRASE_RE.finditer(jd_text):
        phrase = _strip_phrase_noise(match.group(1))
        if not 2 <= len(phrase) <= 8 or phrase in seen:
            continue
        seen.add(phrase)
        phrases.append(phrase)
        if len(phrases) >= _MAX_JD_PHRASES:
            break
    return phrases


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


def _target_keywords(jd_text: str, library: list[str]) -> list[str]:
    """本次检测要考察的关键词：有 JD 时按 JD 抽词，没有 JD 时用通用词库。"""
    if not jd_text.strip():
        return library
    target = _dedupe_words(
        _jd_library_hits(jd_text, library) + _jd_tech_tokens(jd_text) + _jd_chinese_phrases(jd_text)
    )[:_MAX_TARGET_KEYWORDS]
    # JD 里一个词都抽不到（比如全是很短的中文句子）：退回通用覆盖，别什么都不报。
    return target or library


def _keyword_analysis(resume: ResumeContent, jd_text: str) -> KeywordAnalysis:
    """关键词命中清单 + 缺失清单 + 覆盖率。"""
    library = load_keywords()
    target = _target_keywords(jd_text, library)
    resume_lower = _resume_text(resume)
    sections_lower = {name: text.lower() for name, text in _section_texts(resume).items()}
    hits: list[dict] = []
    matched: list[str] = []
    missing: list[str] = []
    for word in target:
        needle = word.lower()
        # 大小写不敏感计数：ATS 自己也这么做，Pytest / pytest 不该算两个词。
        count = resume_lower.count(needle) if needle else 0
        hit = count > 0
        hits.append(
            {
                "keyword": word,
                "matched": hit,
                "count": count,
                "sections": [name for name in _SECTION_ORDER if needle in sections_lower[name]],
            }
        )
        (matched if hit else missing).append(word)
    coverage = len(matched) / len(target) if target else 0.0
    return KeywordAnalysis(
        target=target,
        hits=hits,
        matched=matched,
        missing=missing,
        coverage_ratio=coverage,
    )


def _keyword_issues(analysis: KeywordAnalysis) -> list[AtsIssue]:
    issues: list[AtsIssue] = []
    if analysis.missing:
        ratio_percent = round(analysis.coverage_ratio * 100)
        issues.append(
            AtsIssue(
                category="keyword",
                severity="medium",
                title="关键词覆盖不足",
                detail=(
                    f"有 {len(analysis.missing)} 个目标关键词未出现在简历中，"
                    f"当前覆盖率 {ratio_percent}%，可能影响 ATS 匹配"
                ),
                evidence=analysis.missing[:10],
                suggestion="把真正掌握的缺失词写进技能或对应项目描述里，别硬凑。",
            )
        )
    stuffed = [hit for hit in analysis.hits if hit["count"] > _STUFFING_COUNT]
    if stuffed:
        issues.append(
            AtsIssue(
                category="keyword",
                severity="low",
                title="关键词重复堆砌",
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
    "_STUFFING_COUNT",
    "_dedupe_words",
    "_header_text",
    "_jd_chinese_phrases",
    "_jd_library_hits",
    "_jd_tech_tokens",
    "_keyword_analysis",
    "_keyword_issues",
    "_resume_text",
    "_section_texts",
    "_strip_phrase_noise",
    "_target_keywords",
    "load_keywords",
]
