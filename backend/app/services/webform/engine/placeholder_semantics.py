"""占位符语义与字段对消歧的支撑实现。

从 evidence.py 拆出（2026-10-07，接近 500 行预算时的预防性拆分）：这里放三块
被 ``evidence_key`` / ``competing_fields`` / ``has_ambiguous_field_evidence``
共用的**纯函数**——

- 同义词子串计分（``_longest_synonym``）；
- 占位符在全字段目录下的并列消歧（``_placeholder_leaders*``）；
- 「这对并列字段是否已由占位符之外的机制裁决」（``_pair_resolved_elsewhere``
  及其 start/end、逐条变体的识别辅助）。

公开判定（evidence_key / competing_fields / excluded_by_hints 等）仍在
``evidence.py``；本模块只服务它们，不反向依赖，避免环。
"""
from __future__ import annotations

from functools import lru_cache

from ..fields import FIELD_BLOCK_HINTS, FIELD_SYNONYMS


def _longest_synonym(hay: str, synonyms: tuple[str, ...]) -> int:
    """``hay`` 里命中的最长同义词长度；一个都没命中返回 0。"""
    best = 0
    for synonym in synonyms:
        needle = synonym.casefold()
        if needle and needle in hay:
            best = max(best, len(needle))
    return best


def _start_end_base(field_name: str) -> str | None:
    """``education_start`` → ``"education"``；非 start/end 配对字段返回 ``None``。"""
    if field_name.endswith(("_start", "_end")):
        return field_name.rsplit("_", 1)[0]
    return None


# 逐条资料字段的家族前缀，与 ``repeated_fields.py`` 里 ``family_for_field`` 的
# 家族列表保持一致（那边是权威，改家族时两边同步）。
_REPEATED_FAMILY_PREFIXES = (
    "experience_",
    "project_",
    "award_",
    "campus_",
    "education_",
    "academic_",
    "language_",
    "certificate_",
    "skill_",
    "contact_",
    "portfolio_",
    "social_",
)


def _repeated_variant_base(field_name: str) -> str | None:
    """逐条资料字段的主体名：``education_laboratory`` → ``"laboratory"``。

    逐条资料目录（``repeated_profile_additions.py``）是主字段目录的补充——同一份
    语义、不同的记录位置，字段名即「家族前缀 + 主字段名」。非逐条字段返回 ``None``。
    """
    for prefix in _REPEATED_FAMILY_PREFIXES:
        if field_name.startswith(prefix):
            return field_name[len(prefix) :]
    return None


def _pair_resolved_elsewhere(field_name: str, other_name: str) -> bool:
    """并列的两个字段是否已经由**占位符之外**的机制区分。

    有四种情形不必消歧——它们各有自己的裁决者，占位符并列是常态而非事故：

    - **start/end 家族**（``education_start`` ↔ ``education_end``，以及跨家族的
      ``education_start`` ↔ ``experience_start``）：这类字段的哲学本就是"文本说不清、
      靠结构裁决"——开始/结束靠 ``date_order``，跨区块靠区块机制，DOM 顺序兜底
      （"起止时间"写在好几个家族的同义词里，占位符写全它就必然并列）；
    - **同义冗余字段**（``courses`` ↔ ``education_courses``）：同义词逐字相同，
      资料值也是同一份，填谁都是对的；
    - **互不相同的区块限定**（``experience_description`` ↔ ``project_description``）：
      各自锁死在「实习经历」「项目经历」区块里，由区块机制区分；
    - **主字段 ↔ 逐条变体**（``laboratory`` ↔ ``education_laboratory``）：逐条资料
      目录是主目录的补充，同义词天然重叠（"请输入实验室"对两者同分）；填谁都是
      实验室，field_order/区块机制裁决即可。
    """
    my_base = _start_end_base(field_name)
    if my_base and _start_end_base(other_name):
        return True
    my_variant = _repeated_variant_base(field_name)
    if my_variant == other_name or _repeated_variant_base(other_name) == field_name:
        return True
    # 同义冗余按**集合**比（顺序无关）：逐条资料的 contact_* 组与主目录的
    # emergency_contact_* 是同一份紧急联系人数据的两个槽位，同义词几乎相同但
    # 各差一条——按元组逐字比认不出这对"同义冗余"，占位符「请输入与本人关系」
    # 会被两个并列最高分判成说不清，整框进"没认出来"（2026-10-06 实测）。
    if set(FIELD_SYNONYMS.get(field_name) or ()) == set(FIELD_SYNONYMS.get(other_name) or ()):
        return True
    my_block = FIELD_BLOCK_HINTS.get(field_name)
    other_block = FIELD_BLOCK_HINTS.get(other_name)
    return bool(my_block and other_block and my_block != other_block)


@lru_cache(maxsize=1024)
def _placeholder_leaders(placeholder: str) -> tuple[str, ...]:
    """占位符在全字段目录下的并列最高分字段。

    `_placeholder_leaders_conflict` 与 evidence 的 `_placeholder_owners_excluded`
    共用这一次全表计分（~136 个字段 × 各自同义词，按占位符原文缓存——同一页面
    上占位符高度重复，只算一次）。
    """
    scores = {
        name: _longest_synonym(placeholder, synonyms)
        for name, synonyms in FIELD_SYNONYMS.items()
    }
    top = max(scores.values(), default=0)
    if top <= 0:
        return ()
    return tuple(name for name, score in scores.items() if score == top)


@lru_cache(maxsize=1024)
def _placeholder_leaders_conflict(placeholder: str) -> bool:
    """占位符在**全字段目录**下的最高分，是否被多个互不配对的字段并列。

    占位符是仅次于 autocomplete 的权威信号——但权威性恰恰建立在"一对一"上。
    2026-10-05 拼多多页实测：占位符「请输入毕业学校专业」同时命中 school（"学校"
    2 字）与 major（"专业"2 字），同档同分，按 field_order 让 school 抢走，
    大学名被填进了专业框。两个不同字段对同一占位符并列最高分时，继续"择优"
    是猜，不是识别。

    返回 ``True`` 表示该占位符已说不清自己要什么：``evidence_key`` 对**所有**
    字段如实报"认不出"——宁可漏填，不可错填。
    """
    leaders = _placeholder_leaders(placeholder)
    if not leaders:
        return False
    for i, first in enumerate(leaders):
        for second in leaders[i + 1 :]:
            if not _pair_resolved_elsewhere(first, second):
                return True
    return False
