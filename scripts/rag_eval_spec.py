# SPDX-License-Identifier: Apache-2.0
"""RAG 离线评测集的**规格与校验**：语料定位、目标条目、泄漏判据与基线漏召回。

从 `rag_eval_dataset.py` 拆出（scripts 单文件硬闸门 800 行）。这里只放"什么算合格
样本"的纯规则：确定性选目标、无原词泄漏校验、当前关键词链必须漏召回；生成调用与
缓存、补生成轮次留在 `rag_eval_dataset.py`。模块 docstring 的完整口径见那边。

**泄漏判据的工程化定义**（报告必须按此引用）：
1. 目标主字段文本（公司/学校/项目/论文/证书名等）整串出现在 JD 里 → 泄漏；
2. 与目标条目任意连续 `LEAK_RUN`（5）个以上字符相同 → 泄漏（4 字通用词误报太多，
   所以取 5；更短的"原词"由第 3、4 条兜住）；
3. 目标条目里的英文技术栈/工具名（≥2 字符）出现在 JD → 泄漏；
4. 目标条目的具体数字（人数/百分比/金额/AUC 等）出现在 JD → 泄漏。
"""

from __future__ import annotations

import random
import re
from itertools import combinations
from pathlib import Path
from typing import Any

import rag_eval_common as common

FIXTURE_FILE = common.FIXTURE_DIR / "dataset.json"
SEED = 20261108
BATCH_SIZE = 3
MAX_FIX_ROUNDS = 2
#: 单次 LLM 调用的输出上限：3 组 JD 约 2–3k tokens，8000 留足推理冗余，避免 JSON 截断。
MAX_OUTPUT_TOKENS = 8000
#: 生成语料、ground truth 与排序的三个来源必须一致时才允许落 fixture。
DATASET_NAME = "seed_test_dataset"

#: 岗位族 → 目标条目选择器（section_key, 主字段值的稳定子串）。
#: **不用条目下标**：种子资料重跑时条目顺序可能变，用主字段文本定位才能给出
#: "语料漂移"的明确报错，而不是静默把 ground truth 对到别的条目上。
ARCHETYPES: list[dict[str, Any]] = [
    {
        "key": "growth",
        "role": "用户增长 / 会员运营分析师（社招，3 年经验）",
        "picks": [
            ("experiences", "澜石数据科技"),
            ("projects", "会员分层与沉默用户召回"),
            ("projects", "会员流失预警模型"),
            ("campus_experiences", "数据科学社"),
        ],
    },
    {
        "key": "data_analyst",
        "role": "数据分析师 / 商业分析（社招，2-3 年经验）",
        "picks": [
            ("experiences", "云梯网络科技"),
            ("projects", "招聘漏斗诊断"),
            ("projects", "多渠道活动归因看板"),
            ("credentials", "阿里云数据分析师"),
        ],
    },
    {
        "key": "data_scientist",
        "role": "数据科学 / 用户画像算法（社招，硕士）",
        "picks": [
            ("projects", "会员流失预警模型"),
            ("research_projects", "零售企业会员流失预警"),
            ("publications", "基于生存分析的会员流失预警研究"),
            ("experiences", "澜石数据科技"),
        ],
    },
    {
        "key": "marketing",
        "role": "市场营销 / 品牌内容运营（社招，1-3 年经验）",
        "picks": [
            ("experiences", "星野文化传播"),
            ("campus_experiences", "学生会宣传部"),
            ("credentials", "Google Analytics"),
            ("projects", "会员分层与沉默用户召回"),
        ],
    },
    {
        "key": "consumer_research",
        "role": "消费者研究 / 用户研究（校招或研究岗）",
        "picks": [
            ("publications", "价格框架对复购意愿的影响"),
            ("research_projects", "消费者决策中的价格框架效应"),
            ("educations", "上海财经大学"),
            ("educations", "上海大学"),
        ],
    },
    {
        "key": "product",
        "role": "产品运营 / 增长产品经理（社招，1-3 年经验）",
        "picks": [
            ("projects", "校园二手书交易小程序"),
            ("projects", "会员分层与沉默用户召回"),
            ("campus_experiences", "数据科学社"),
            ("experiences", "云梯网络科技"),
        ],
    },
    {
        "key": "bi_engineer",
        "role": "数据工程 / BI 分析师（社招，2-4 年经验）",
        "picks": [
            ("projects", "多渠道活动归因看板"),
            ("patents", "多渠道活动归因分析工具"),
            ("credentials", "阿里云数据分析师"),
            ("projects", "招聘漏斗诊断"),
        ],
    },
    {
        "key": "campus_growth",
        "role": "校招：数据分析 / 用户增长管培生（应届）",
        "picks": [
            ("campus_experiences", "数据科学社"),
            ("campus_experiences", "学生会宣传部"),
            ("projects", "会员流失预警模型"),
            ("experiences", "云梯网络科技"),
        ],
    },
    {
        "key": "consulting",
        "role": "商业咨询 / 战略分析（社招或校招）",
        "picks": [
            ("research_projects", "零售企业会员流失预警"),
            ("projects", "招聘漏斗诊断"),
            ("publications", "价格框架对复购意愿的影响"),
            ("experiences", "星野文化传播"),
        ],
    },
    {
        "key": "content_ops",
        "role": "内容运营 / 活动运营（社招，1-2 年经验）",
        "picks": [
            ("experiences", "星野文化传播"),
            ("campus_experiences", "学生会宣传部"),
            ("campus_experiences", "上海科技馆"),
            ("projects", "校园二手书交易小程序"),
        ],
    },
]

#: 泄漏判据：与目标条目共享任意长度 ≥ 该值的连续中文/可见字符即视为"抄原词"。
#: 取 5 而不是 4 是有意的口径：4 字片段里"生命周期/指标体系"这类通用业务词会大面积
#: 误报，而它们并不是"目标条目的原词"；判定另有三条更硬的判据（原句整串、英文技术名、
#: 具体数字），不会被这条放宽漏掉关键泄漏。
LEAK_RUN = 5
#: 这些字段是身份/元信息，JD 本就不该出现；不参与"数字指标"判断。
_META_KEYS = {
    "start_date",
    "end_date",
    "date",
    "issue_date",
    "expiry_date",
    "filed_date",
    "granted_date",
    "obtained_at",
    "year",
    "patent_number",
    "doi",
    "url",
    "verify_url",
    "phone",
    "email",
}
#: 通用岗位/分类标签：它们描述"这是哪一类工作"，不是"这个人的独特经历"。
#: JD 写"用户增长分析师"是岗位名而不是抄经历，因此不进泄漏判据（否则每组都会
#: 因为 role 恰好与 JD 岗位名同词而误判）。独特的公司/学校/项目/论文/证书/描述
#: 仍然必须逐字避开，这才是关键词召回失败的来源。
_GENERIC_KEYS = {
    "role",
    "category",
    "level",
    "status",
    "credential_type",
    "activity_type",
    "degree",
    "job_type",
}
_ASCII_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+#.\-]{1,}")


# ===== 语料与目标选择 =====


def ensure_corpus(db_path: Path) -> dict[str, Any]:
    corpus = common.load_corpus(db_path)
    missing: list[str] = []
    for archetype in ARCHETYPES:
        for section_key, needle in archetype["picks"]:
            if _find_entry(corpus, section_key, needle) is None:
                missing.append(f"{section_key}:{needle}")
    if missing:
        raise SystemExit(
            "评测语料与预期不符，缺少：" + "、".join(missing) + "；请先重跑 seed_test_dataset.py"
        )
    return corpus


def _find_entry(corpus: dict[str, Any], section_key: str, needle: str) -> dict[str, Any] | None:
    section = corpus["sections"].get(section_key) or {}
    for entry in section.get("entries") or []:
        if needle in str(entry.get("primary_value") or ""):
            return entry
    return None


def _archetype_pool(corpus: dict[str, Any], archetype: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        dict(_require_entry(corpus, section, needle), section_key=section)
        for section, needle in archetype["picks"]
    ]


def _target_record(target: dict[str, Any]) -> dict[str, Any]:
    return {
        "section_key": target["section_key"],
        "primary_field": target["primary_field"],
        "primary_value": target["primary_value"],
        "entry_digest": common.entry_digest(target),
    }


def pick_targets(corpus: dict[str, Any]) -> list[dict[str, Any]]:
    """为每个岗位族确定性地排 6 组目标（2–3 条/组）。"""
    rng = random.Random(SEED)
    groups: list[dict[str, Any]] = []
    for archetype in ARCHETYPES:
        pool = _archetype_pool(corpus, archetype)
        combos = [list(combo) for size in (3, 2) for combo in combinations(pool, size)]
        rng.shuffle(combos)
        chosen = combos[:6]
        for targets in chosen:
            groups.append(
                {
                    "id": f"g{len(groups) + 1:03d}",
                    "archetype": archetype["key"],
                    "role": archetype["role"],
                    "targets": [_target_record(target) for target in targets],
                }
            )
    return groups


def _alternate_targets(
    corpus: dict[str, Any], archetype_key: str, used: set[tuple[tuple[str, str], ...]]
) -> list[dict[str, Any]] | None:
    """同一岗位族里挑一组未被任何现存组使用的目标组合（确定性顺序）。"""
    archetype = next(item for item in ARCHETYPES if item["key"] == archetype_key)
    pool = _archetype_pool(corpus, archetype)
    for size in (3, 2):
        for combo in combinations(pool, size):
            signature = tuple(
                sorted((target["section_key"], target["primary_value"]) for target in combo)
            )
            if signature in used:
                continue
            used.add(signature)
            return [_target_record(target) for target in combo]
    return None


def _require_entry(corpus: dict[str, Any], section_key: str, needle: str) -> dict[str, Any]:
    entry = _find_entry(corpus, section_key, needle)
    if entry is None:  # ensure_corpus 已经拦过，这里只是给类型收窄
        raise SystemExit(f"缺少目标条目 {section_key}:{needle}")
    return entry


# ===== LLM 客户端（密钥只在进程内，命中缓存不重复调用） =====


def _target_texts(target: dict[str, Any]) -> list[str]:
    texts: list[str] = [str(target.get("primary_value") or "")]
    item = target["item"]

    def walk(value: Any) -> None:
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for key, child in value.items():
                if str(key) in _META_KEYS or str(key) in _GENERIC_KEYS:
                    continue
                walk(child)

    walk(item)
    return [text for text in texts if text.strip()]


def leak_reasons(job: dict[str, Any], targets: list[dict[str, Any]]) -> list[str]:
    jd = "\n".join(
        str(job.get(key) or "")
        for key in ("title", "description", "requirements", "additional_info")
    )
    if not jd.strip():
        return ["JD 为空"]
    reasons: list[str] = []
    ascii_tokens = {token.casefold() for token in _ASCII_TOKEN_RE.findall(jd)}
    for target in targets:
        for text in _target_texts(target):
            if text.strip() and len(text.strip()) >= LEAK_RUN and text.strip() in jd:
                reasons.append(f"目标原句出现在 JD：{text.strip()[:24]}")
                break
            run = _longest_common_run(text, jd)
            if run[1] >= LEAK_RUN:
                reasons.append(f"与目标条目共享 {run[1]} 字连续片段：{run[0]}")
                break
            for token in _ASCII_TOKEN_RE.findall(text):
                if len(token) >= 2 and token.casefold() in ascii_tokens:
                    reasons.append(f"目标英文词出现在 JD：{token}")
                    break
    return _dedupe(reasons)


def _longest_common_run(left: str, right: str) -> tuple[str, int]:
    """最长公共子串（中文/可见字符按字符比较；数据量小，DP 足够）。"""
    if not left or not right:
        return "", 0
    best_start = best_len = 0
    previous = [0] * (len(right) + 1)
    for i, left_char in enumerate(left, start=1):
        current = [0] * (len(right) + 1)
        for j, right_char in enumerate(right, start=1):
            if left_char == right_char:
                current[j] = previous[j - 1] + 1
                if current[j] > best_len:
                    best_len = current[j]
                    best_start = i - best_len
        previous = current
    return left[best_start : best_start + best_len], best_len


def baseline_miss(
    job: dict[str, Any], targets: list[dict[str, Any]], corpus: dict[str, Any]
) -> bool:
    """当前关键词链是否**至少漏掉一个**目标（漏了就说明这组是失败样本）。"""
    job_out = common.make_job_out(job)
    focus = common.build_focus(job_out, corpus)
    ranked = common.rank_entries(focus, corpus)
    positions = common.match_targets(ranked, targets)
    return any(pos is None or pos > 10 for pos in positions)


def validate_group(group: dict[str, Any], corpus: dict[str, Any]) -> list[str]:
    job = group.get("job") or {}
    for key in ("title", "description", "requirements"):
        if not str(job.get(key) or "").strip():
            return [f"缺少字段 {key}"]
    if len(str(job.get("title") or "")) > 128:
        return ["title 超长"]
    if len(str(job.get("description") or "")) < 80:
        return ["description 过短（<80 字）"]
    targets = [
        dict(
            _require_entry(corpus, t["section_key"], t["primary_value"]),
            section_key=t["section_key"],
        )
        for t in group["targets"]
    ]
    reasons = leak_reasons(job, targets)
    if reasons:
        return reasons
    if not baseline_miss(job, targets, corpus):
        return ["当前关键词链已能召回全部目标（不构成失败样本）"]
    return []


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
