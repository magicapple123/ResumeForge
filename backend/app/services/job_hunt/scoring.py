# SPDX-License-Identifier: Apache-2.0
"""LLM 语义评分（参考成熟实现的评分口径，代码为自研）。

与 ``services/match_scoring.py`` 的分工
--------------------------------------
``match_scoring`` 是**纯本地规则**：技能命中率、年限比对、关键词覆盖。它不需要模型，
但对「A 做过的事能不能迁移到 B 岗位」这类判断无能为力——只能按字面比对，结果往往是
中性分（实测无 JD 时恒为 50）。

本模块做**语义评估**：把完整简历 + 完整 JD 交给模型，按五个维度逐项打分，
并要求每条分数附具体证据。核心规则（证据四态、可迁移需行动支撑、封顶）来自
对成熟评分口径的参考，提示词见 ``prompts/job_hunt_scoring.md``。

两者并存：本地规则作为「模型不可用」时的兜底，语义评分作为主路径。
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# 五个维度的满分上限。模型必须按此给分，程序统一求和。
COMPONENT_LIMITS: dict[str, int] = {
    "core_duties": 40,
    "transferable_evidence": 25,
    "hard_requirements": 15,
    "tools_industry": 10,
    "practical_fit": 10,
}

# 维度 key -> 中文名（前端与报告展示用）。
COMPONENT_LABELS: dict[str, str] = {
    "core_duties": "核心职责匹配",
    "transferable_evidence": "可迁移证据",
    "hard_requirements": "硬性要求",
    "tools_industry": "工具与行业",
    "practical_fit": "实际条件",
}

# 封顶规则：命中后总分不得超过该值。
CAP_CEILINGS: dict[str, int] = {
    "technical_required": 55,
    "sales_acquisition_core": 65,
    "weak_core_transfer": 70,
}

# 模型偶尔把维度名写成别名（实测有模型简写），解析前归一。
_ALIASES = {
    "transferable": "transferable_evidence",
    "transferable_skills": "transferable_evidence",
    "hard_requirement": "hard_requirements",
    "core_duty": "core_duties",
    "tools": "tools_industry",
    "practical": "practical_fit",
}

_MARKDOWN_JSON_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.S)


@dataclass
class ScoredComponent:
    key: str
    label: str
    score: int
    limit: int
    evidence: str = ""


# 技能对比的三种状态（与提示词的取值域一致）。
SKILL_STATUS_MATCHED = "matched"
SKILL_STATUS_PARTIAL = "partial"
SKILL_STATUS_MISSING = "missing"
VALID_SKILL_STATUS = {SKILL_STATUS_MATCHED, SKILL_STATUS_PARTIAL, SKILL_STATUS_MISSING}

SKILL_COMPARE_LIMIT = 12


@dataclass
class SkillMatch:
    """JD 要求的一条技能与简历的比对结果。"""

    skill: str
    status: str
    resume_evidence: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "skill": self.skill,
            "status": self.status,
            "resume_evidence": self.resume_evidence,
        }


@dataclass
class SemanticScore:
    """一次语义评分的结论。"""

    total: int = 0
    raw_total: int = 0
    components: list[ScoredComponent] = field(default_factory=list)
    caps: list[str] = field(default_factory=list)
    hard_gaps: list[str] = field(default_factory=list)
    role_summary: str = ""
    reason: str = ""
    missing: str = ""
    ok: bool = False
    error: str = ""
    # JD 要求 ↔ 简历证据的逐条比对（最多 12 条）。
    skill_compare: list[SkillMatch] = field(default_factory=list)
    # 评分时用的是哪份简历（便于「同一岗位对比不同简历」）。
    resume_id: int | None = None
    resume_title: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "raw_total": self.raw_total,
            "components": [
                {
                    "key": c.key,
                    "label": c.label,
                    "score": c.score,
                    "limit": c.limit,
                    "evidence": c.evidence,
                }
                for c in self.components
            ],
            "caps": self.caps,
            "hard_gaps": self.hard_gaps,
            "role_summary": self.role_summary,
            "reason": self.reason,
            "missing": self.missing,
            "ok": self.ok,
            "error": self.error,
            "skill_compare": [item.as_dict() for item in self.skill_compare],
            "resume_id": self.resume_id,
            "resume_title": self.resume_title,
        }


def _strip_fences(raw: str) -> str:
    text = (raw or "").strip()
    match = _MARKDOWN_JSON_RE.match(text)
    if match:
        return match.group(1).strip()
    # 模型有时前后带解释；取第一个 { 到最后一个 }。
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return text


def _clamp(value: Any, lower: int, upper: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return lower
    return max(lower, min(upper, number))


def parse_semantic_score(raw: str) -> SemanticScore:
    """把模型输出解析成 :class:`SemanticScore`。

    解析纪律：
    - 五个维度缺任意一个 → ``ok=False``，不猜分；
    - 单项超上限 → 夹到上限（模型常见错误，不应整份作废）；
    - ``caps`` 只接受白名单里的值，未知 cap 丢弃（防模型自造规则）；
    - 总分 = 五项之和，再按最强的 cap 封顶。
    """
    score = SemanticScore()
    text = _strip_fences(raw)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        score.error = f"模型输出不是合法 JSON：{exc}"
        return score
    if not isinstance(payload, dict):
        score.error = "模型输出不是 JSON 对象"
        return score

    # 维度别名归一
    normalized: dict[str, Any] = {}
    for key, value in payload.items():
        normalized[_ALIASES.get(key, key)] = value

    components: list[ScoredComponent] = []
    for key, limit in COMPONENT_LIMITS.items():
        node = normalized.get(key)
        if not isinstance(node, dict):
            score.error = f"缺少维度 {key}"
            return score
        raw_score = node.get("score")
        if raw_score is None:
            score.error = f"维度 {key} 没有 score"
            return score
        components.append(
            ScoredComponent(
                key=key,
                label=COMPONENT_LABELS[key],
                score=_clamp(raw_score, 0, limit),
                limit=limit,
                evidence=str(node.get("evidence") or "").strip(),
            )
        )

    score.components = components
    score.raw_total = sum(c.score for c in components)

    caps_raw = normalized.get("caps") or []
    if isinstance(caps_raw, (list, tuple)):
        score.caps = [c for c in (str(x).strip() for x in caps_raw) if c in CAP_CEILINGS]

    gaps_raw = normalized.get("hard_gaps") or []
    if isinstance(gaps_raw, (list, tuple)):
        score.hard_gaps = [str(g).strip() for g in gaps_raw if str(g).strip()]

    score.skill_compare = _parse_skill_compare(normalized.get("skill_compare"))
    score.role_summary = str(normalized.get("role_summary") or "").strip()
    score.reason = str(normalized.get("reason") or "").strip()
    score.missing = str(normalized.get("missing") or "").strip()

    # 封顶：取所有命中 cap 里最严的那个。
    ceiling = min((CAP_CEILINGS[c] for c in score.caps), default=100)
    score.total = min(score.raw_total, ceiling)
    score.ok = True
    return score


def _parse_skill_compare(raw: Any) -> list[SkillMatch]:
    """解析技能对比列表。

    纪律：
    - 只接受三值状态，非法状态丢弃（不猜）
    - 空技能名丢弃
    - 最多 ``SKILL_COMPARE_LIMIT`` 条（模型偶尔会超出）
    """
    if not isinstance(raw, (list, tuple)):
        return []
    items: list[SkillMatch] = []
    for node in raw[: SKILL_COMPARE_LIMIT * 2]:  # 先多取，过滤后再截断
        if not isinstance(node, dict):
            continue
        skill = str(node.get("skill") or "").strip()
        status = str(node.get("status") or "").strip().lower()
        if not skill or status not in VALID_SKILL_STATUS:
            continue
        items.append(
            SkillMatch(
                skill=skill,
                status=status,
                resume_evidence=str(node.get("resume_evidence") or "").strip(),
            )
        )
        if len(items) >= SKILL_COMPARE_LIMIT:
            break
    return items


def build_scoring_prompt(
    *,
    resume: str,
    title: str,
    company: str,
    city: str = "",
    salary: str = "",
    experience: str = "",
    education: str = "",
    recruitment_type: str = "",
    jd: str = "",
    candidate_education: str = "",
    candidate_recruitment_type: str = "",
    target_cities: str = "",
    salary_min: float = 0,
    salary_max: float = 0,
    salary_ceil_ratio: float = 1.5,
    compact: bool = False,
) -> str:
    """拼装评分提示词（模板在 ``prompts/job_hunt_scoring.md``）。

    ``compact=True`` 时把「输出格式」那段换成精简版：只要五维分数 + 一句话理由，
    不要逐条 evidence 摘录、不要 skill_compare。

    为什么要这个开关（2026-11-11 实测）：完整格式要求模型输出 7000-14000 token 的
    evidence 与技能逐条比对（输入才 5000），而生成输出是逐 token 的——一轮 13 条
    候选要跑十分钟。候选阶段只需要**一个能排序的分数**，完整证据链是用户点开某条
    岗位时才需要的。省掉输出让单条从 ~45 秒降到 10 秒级。
    """
    from pathlib import Path

    template = (Path(__file__).resolve().parents[2] / "prompts" / "job_hunt_scoring.md").read_text(
        encoding="utf-8"
    )
    if compact:
        template = _apply_compact_output_spec(template)
    salary_ceil = salary_max * max(salary_ceil_ratio, 1.0) if salary_max > 0 else 0
    return template.format(
        resume=resume,
        title=title,
        company=company,
        city=city or "未识别",
        salary=salary or "未识别",
        experience=experience or "未识别",
        education=education or "未识别",
        recruitment_type=recruitment_type or "未识别",
        jd=jd or "（岗位未提供 JD 正文）",
        candidate_education=candidate_education or "未填写",
        candidate_recruitment_type=candidate_recruitment_type or "未填写",
        target_cities=target_cities or "未填写",
        salary_min=int(salary_min),
        salary_max=int(salary_max),
        salary_ceil=int(salary_ceil),
        salary_fit=salary_fit_summary(salary, salary_min, salary_max, salary_ceil),
    )


def _parse_salary_range(text: str) -> tuple[float, float] | None:
    """从 ``15-25K`` / ``1.2-1.5万`` / ``130-250元/天`` 里取月薪区间（单位 K）。"""
    raw = (text or "").strip()
    if not raw:
        return None
    numbers = re.findall(r"(\d+(?:\.\d+)?)", raw)
    if len(numbers) < 2:
        # 单值（如「10K以上」）：只取一个边界。
        if len(numbers) == 1:
            value = float(numbers[0])
            if "万" in raw:
                value *= 10
            return (value, value)
        return None
    low, high = float(numbers[0]), float(numbers[1])
    if "万" in raw:
        low, high = low * 10, high * 10
    elif "元/天" in raw or "/天" in raw:
        # 日薪折月（按 22 天）：130-250 元/天 ≈ 2.9-5.5K
        low, high = low * 22 / 1000, high * 22 / 1000
    return (low, high)


def _apply_compact_output_spec(template: str) -> str:
    """把模板里的输出格式段换成精简版（只要分 + 一句话理由）。

    实现方式是从「请严格输出一个 JSON 对象」切到模板末尾，整段替换——比在模板里塞
    两个 `{compact_*}` 占位符更省：那样两个版本会各自漂移，而这里只有一份维度定义
    （评分口径必须一致，否则精简模式和完整模式给出的分不可比）。
    """
    marker = "请严格输出一个 JSON 对象"
    cut = template.find(marker)
    if cut < 0:  # 模板改版后找不到标记：宁可给完整模板，也不要静默输出错格式
        return template
    return template[:cut] + COMPACT_OUTPUT_SPEC


# 精简输出格式：只要分数与理由。**five 个 score 的键名与完整版一致**，
# 这样 ``parse_semantic_score`` 不用分叉——它按同一套键解析。
COMPACT_OUTPUT_SPEC = """**这次只做快速排序评分，请务必简短。**

只输出一个 JSON 对象，不要 Markdown，不要额外说明。硬性约束：

1. 五个 `score` 必须是整数，各自不超过上限（核心职责 0-40、可迁移 0-25、
   硬性要求 0-15、工具行业 0-10、实际条件 0-10）。
2. `evidence` **每条最多 15 个字**，只写结论（如「本科满足」「无相关项目」），
   **不要**摘录 JD 原文、**不要**引用简历原句。
3. **不要输出** `skill_compare`、不要逐条列 JD 要求、不要解释评分过程。
4. 整份输出控制在 300 字以内。

{{
  "role_summary": "岗位核心工作（10 字内）",
  "hard_requirements": {{"evidence": "结论（15 字内）", "score": 0}},
  "core_duties": {{"evidence": "结论（15 字内）", "score": 0}},
  "transferable_evidence": {{"evidence": "结论（15 字内）", "score": 0}},
  "tools_industry": {{"evidence": "结论（15 字内）", "score": 0}},
  "practical_fit": {{"evidence": "结论（15 字内）", "score": 0}},
  "caps": [],
  "hard_gaps": [],
  "reason": "关键判断（20 字内）",
  "missing": "关键缺失（10 字内）"
}}

再强调一次：直接给 JSON，evidence 每条不超过 15 个字，不要摘录原文，不要 skill_compare。
"""


def salary_fit_summary(
    job_salary: str, salary_min: float, salary_max: float, salary_ceil: float
) -> str:
    """给模型的薪资核对结论（程序算好，不让模型自己算）。

    区间有交集即「可谈」，不因岗位下限低于期望就判不匹配。
    """
    parsed = _parse_salary_range(job_salary)
    if parsed is None:
        return "岗位薪资未能识别，不据此扣分"
    low, high = parsed
    if salary_max <= 0 and salary_min <= 0:
        return f"岗位 {low:g}K-{high:g}K；候选人未填写期望薪资，不据此扣分"
    expect_low = salary_min if salary_min > 0 else 0
    expect_high = salary_ceil if salary_ceil > 0 else salary_max
    if expect_high <= 0:
        return f"岗位 {low:g}K-{high:g}K；期望上限未设置，不据此扣分"
    if low <= expect_high and high >= expect_low:
        return f"岗位 {low:g}K-{high:g}K 与期望 {expect_low:g}K-{expect_high:g}K 有交集，可谈"
    if low > expect_high:
        return f"岗位 {low:g}K-{high:g}K 高于期望上限 {expect_high:g}K，属于超预期（不是不匹配）"
    return f"岗位 {low:g}K-{high:g}K 低于期望下限 {expect_low:g}K，需在「实际条件」扣分"


__all__ = [
    "SKILL_STATUS_MATCHED",
    "SKILL_STATUS_PARTIAL",
    "SKILL_STATUS_MISSING",
    "VALID_SKILL_STATUS",
    "SKILL_COMPARE_LIMIT",
    "SkillMatch",
    "COMPONENT_LIMITS",
    "COMPONENT_LABELS",
    "CAP_CEILINGS",
    "ScoredComponent",
    "SemanticScore",
    "parse_semantic_score",
    "build_scoring_prompt",
    "salary_fit_summary",
]
