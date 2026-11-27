# SPDX-License-Identifier: Apache-2.0
"""岗位匹配（**文本级**）：拿外部简历的正文对 JD 做纯字面比对（R-31 / T34）。

## 为什么外部简历只能走"文本级"

外部简历是上传的原件快照，只有 ``text``（上传时本地提取的正文）与块，**没有**
``resume_record.content`` 那套条目 / 字段 / 纸面位置。结构化匹配读的是结构化字段与版式，
拿一份只有正文的文件去喂它，只能得到满屏"资料中未提供"——那不是结论，是口径错配。
所以这里另立一套口径：

- **输入**只有两串字：JD 正文、外部简历正文字；
- **判断**只有一种：JD 抽出来的词，在正文字里出现了没有；
- **输出**只有词表与计数，**没有**准入闸门、五类状态、百分比分数。

## 为什么不让模型来做

同一份 JD + 同一份正文必须每次给出同一份词表，否则用户"再点一次"就换一批结论。
而且这一步只值几毫秒——调模型会把一个"立刻能看到"的检查变成一次十几秒的等待，还会在
没配 Key 时不可用。所以：抽词复用 ATS 的 JD 抽词器（``services.ats_keywords``），命中判断
复用它的别名双向计数（``Postgres`` / ``PostgreSQL`` 算同一个词），全程本地、确定性。

## 不落库

结果不写 ``job_match_analysis``。理由有两条：一是它可由两份文本随时重算，没有存储价值；
二是**共用一张表就等于给出"外部结论覆盖内部结论"的路径**——一次文本级比对不该让结构化
匹配的历史结论消失。前端两个口径因此天然分块，不存在混排的可能。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ...models.external_resume import ExternalResume
from ...models.job import Job
from ...models.profile import utcnow
from ...schemas.job_match_text import (
    MAX_HIGHLIGHT_CHARS,
    MAX_HIGHLIGHTS,
    MAX_NOTE_CHARS,
    MAX_NOTES,
    MAX_WORD_CHARS,
    MAX_WORDS,
    TextLevelHighlight,
    TextLevelMatchOut,
)
from ..ats_keywords import jd_keyword_tiers, keyword_count, load_keywords
from .job_match import job_payload

# 正文只读这么多字：外部简历的正文本身在上传时已截断（与材料文本同口径），这里再兜一次
# 上限，避免手工改库塞进巨型文本后每次比对都全量扫描。
_MAX_TEXT_CHARS = 40_000

# JD 文本里参与抽词的字段。**不含**薪资 / 地点 / 岗位类型：这些词抽出来当关键词没有意义
# （正文里出现"杭州"不代表匹配），只会把分母搅浑。
_JD_FIELDS = ("title", "company", "description", "requirements", "additional_info")

# 判"有没有 JD"只看这三段正文：只有标题的岗位抽出来的只是岗位名与公司名，比出来没意义。
_JD_BODY_FIELDS = ("description", "requirements", "additional_info")

# 口径说明（服务端写、界面原样展示，与 `JobMatchResult.notes` 同一定位）。
_NOTE_CALIBER = (
    "文本级：只比对 JD 抽词与简历正文字面覆盖，不读结构化字段与版式，不作为投递准入门槛。"
)
_NOTE_NO_SCORE = "与「结构化匹配」不可比较：那一边读的是内部简历的字段与版式，分母不同。"
_NOTE_ALIAS = "同义词按别名表双向计入（例如 Postgres 与 PostgreSQL 视为同一个词）。"

# 三条"接下来怎么办"的建议，按缺失结构分派（不猜分数、不编能力）。
_ADVICE_ALL_HIT = "JD 抽到的词在正文里都出现了；是否够格仍要看结构化匹配与实际项目细节。"
_ADVICE_CORE_MISS_ALL = "JD 的核心要求词一个都没在正文里出现：先确认这份正文是不是你要投的那一版，再考虑按核心词补相关经历。"
_ADVICE_PARTIAL_MISS = (
    "缺失的词只代表正文里没写，不代表没有这个能力：先看是不是换了一种说法，再决定要不要补一句。"
)


@dataclass(frozen=True)
class _Tiers:
    """JD 抽出的两档目标词（核心词 = 要求段里的词库/别名命中）。"""

    core: list[str] = field(default_factory=list)
    supplementary: list[str] = field(default_factory=list)

    @property
    def all(self) -> list[str]:
        """完整目标词表（核心在前）——界面按这个顺序展示，读的人先看到硬要求。"""
        return [*self.core, *self.supplementary]


def _trim(word: str) -> str:
    """词表里的词统一裁到 schema 允许的长度，避免脏 JD 把校验打挂。"""
    return word.strip()[:MAX_WORD_CHARS]


def _dedupe(words: list[str]) -> list[str]:
    """按小写去重，保留第一次出现的写法与顺序。"""
    result: list[str] = []
    seen: set[str] = set()
    for word in words:
        trimmed = _trim(word)
        key = trimmed.lower()
        if not trimmed or key in seen:
            continue
        seen.add(key)
        result.append(trimmed)
    return result


def jd_text(job: Job) -> str:
    """参与抽词的 JD 文本（标题 + 公司 + 描述 + 要求 + 补充信息）。"""
    payload = job_payload(job)
    return "\n".join(str(payload.get(name) or "") for name in _JD_FIELDS).strip()


def jd_body(job: Job) -> str:
    """JD 的**正文**（描述 + 要求 + 补充信息），不含标题与公司。

    判"这个岗位有没有 JD"只看正文：一个只有标题的岗位拿去抽词，抽出来的只是公司名与
    岗位名，比出来的东西没有任何意义——那种情况要明确说"还没有 JD 正文"。
    """
    payload = job_payload(job)
    return "\n".join(str(payload.get(name) or "") for name in _JD_BODY_FIELDS).strip()


def _tiers(jd: str) -> _Tiers:
    """JD → 两档目标词；两档都去重并裁到上限。"""
    if not jd:
        return _Tiers()
    core, supplementary = jd_keyword_tiers(jd, list(load_keywords()))
    return _Tiers(
        core=_dedupe(core)[:MAX_WORDS],
        supplementary=_dedupe(supplementary)[:MAX_WORDS],
    )


def _matched(words: list[str], text_lower: str) -> list[str]:
    """目标词里在正文中出现过的那些（别名双向计入，复用 ATS 同一份实现）。"""
    return [word for word in words if keyword_count(text_lower, word.lower()) > 0]


def _hits_in_line(line_lower: str, matched: list[str]) -> list[str]:
    """这一行命中了哪些目标词（保序、去重）。"""
    return _dedupe([word for word in matched if keyword_count(line_lower, word.lower()) > 0])


def _highlights(text: str, matched: list[str]) -> list[TextLevelHighlight]:
    """挑命中最多的几行正文做证据（同分按原文顺序，结果可复现）。

    只摘原文、不改写：用户要能回到那份简历里核对"这句真的在"。
    """
    if not matched or not text.strip():
        return []
    scored: list[tuple[int, int, str]] = []
    for index, raw_line in enumerate(text.splitlines()):
        line = raw_line.strip()
        if not line:
            continue
        hits = _hits_in_line(line.lower(), matched)
        if hits:
            scored.append((-len(hits), index, line))
    ordered = sorted(scored, key=lambda item: (item[0], item[1]))[:MAX_HIGHLIGHTS]
    return [
        TextLevelHighlight(
            text=line[:MAX_HIGHLIGHT_CHARS],
            words=_hits_in_line(line.lower(), matched)[:MAX_WORDS],
        )
        for _neg, _index, line in ordered
    ]


def _notes(tiers: _Tiers, missing: list[str]) -> list[str]:
    """口径说明 + 一条"接下来怎么办"的动作建议（不猜、不说分数）。"""
    notes = [_NOTE_CALIBER, _NOTE_NO_SCORE]
    if tiers.core:
        notes.append(_NOTE_ALIAS)
    if not missing:
        notes.append(_ADVICE_ALL_HIT)
    elif tiers.core and all(word in tiers.core for word in missing):
        notes.append(_ADVICE_CORE_MISS_ALL)
    else:
        notes.append(_ADVICE_PARTIAL_MISS)
    return [note[:MAX_NOTE_CHARS] for note in notes][:MAX_NOTES]


def analyze_text_level(db: Session, job: Job, external_resume_id: int) -> TextLevelMatchOut:
    """用一份外部简历的正文字对 JD 做文本级比对。

    三类不可用的情况都**抛 ``ValueError`` 并给出"为什么 + 怎么办"**（路由转 400）：
    没有这份外部简历、这份没有正文（扫描件）、岗位没有 JD 正文。静默返回空结果会让用户
    以为"匹配度是 0"，那是最坏的一种诚实。
    """
    resume = db.get(ExternalResume, external_resume_id)
    if resume is None or resume.deleted_at is not None:
        raise ValueError("这份外部简历不存在或已被删除，请重新选择简历")
    text = (resume.text or "")[:_MAX_TEXT_CHARS]
    if not text.strip():
        raise ValueError(
            "这份外部简历没有可用正文（扫描件或缺文字层），无法做文本比对："
            "先在外部简历详情里做文本检查或补录正文，或换一份有文字的简历"
        )
    jd = jd_text(job)
    if not jd_body(job):
        raise ValueError("这个岗位还没有 JD 正文（描述与要求都为空），无法做文本比对")

    tiers = _tiers(jd)
    text_lower = text.lower()
    core_matched = _matched(tiers.core, text_lower)
    supplementary_matched = _matched(tiers.supplementary, text_lower)
    matched = [*core_matched, *supplementary_matched]
    matched_keys = {word.lower() for word in matched}
    missing = [word for word in tiers.all if word.lower() not in matched_keys]

    return TextLevelMatchOut(
        job_id=job.id,
        job_title=job.title or "",
        company=job.company or "",
        external_resume_id=resume.id,
        resume_name=resume.name or "",
        text_chars=resume.text_chars or len(text),
        target_words=tiers.all[:MAX_WORDS],
        matched_words=matched[:MAX_WORDS],
        missing_words=missing[:MAX_WORDS],
        core_target=tiers.core,
        core_matched=core_matched,
        supplementary_target=tiers.supplementary,
        supplementary_matched=supplementary_matched,
        target_count=len(tiers.all),
        matched_count=len(matched),
        highlights=_highlights(text, matched),
        notes=_notes(tiers, missing),
        generated_at=utcnow(),
    )


__all__ = ["analyze_text_level", "jd_body", "jd_text"]
