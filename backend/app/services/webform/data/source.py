"""网申填表的 DB 取数与资料合并（职责③）。

从 ``webform/data.py`` 拆出：合并简历资料（``UserProfile``）与网申补充资料，
产出整页批量预填（``build_form_data``）与实时建议（``build_live_form_data``）
两档口径的字段字典。
"""

from __future__ import annotations

import unicodedata

from sqlalchemy.orm import Session

from ....models.web_form_profile import CUSTOM_KEY_PREFIX
from ...profile.profile_service import get_profile_detail
from .. import extra_profile, repeated_profile
from ..extra_profile import list_entries
from ..fields import FIELD_SYNONYMS, FORM_FIELDS, SOURCE_EXTRA
from .profile_map import profile_to_form_data


def _combine_profile_and_extra_data(
    db: Session, *, job_title: str, reusable_only: bool
) -> dict[str, str]:
    """合并简历资料与网申资料；由调用方明确选择是否过滤「本次」档位。"""
    profile_data = profile_to_form_data(get_profile_detail(db), job_title=job_title)
    # 简历资料里的基础经历与网申资料里的补充字段按同一条记录序号展开；两者仍然
    # 分开存储，所以这里是网申填表取数时才发生的合并。
    for key, value in repeated_profile.expand_form_data(db).items():
        # 同一序号既有简历记录又有网申记录时，简历里的基础内容优先；独有的
        # 网申经历仍能补齐简历资料里没有的学校、单位或项目字段。
        profile_data.setdefault(key, value)
    return {**profile_data, **list_entries(db, reusable_only=reusable_only)}


def _custom_label_values_for_batch(db: Session, data: dict[str, str]) -> dict[str, str]:
    """将唯一自定义标签映射到唯一标准字段，供批量填表使用。"""
    details = extra_profile.list_details(db)
    custom_keys_by_label: dict[str, list[str]] = {}
    for key, detail in details.items():
        if not key.startswith(CUSTOM_KEY_PREFIX):
            continue
        normalized = _normalize_field_label(detail.get("label", ""))
        if normalized:
            custom_keys_by_label.setdefault(normalized, []).append(key)

    field_keys_by_label: dict[str, set[str]] = {}
    for field in FORM_FIELDS:
        for candidate in (field.label, *FIELD_SYNONYMS.get(field.key, ())):
            normalized = _normalize_field_label(candidate)
            if normalized:
                field_keys_by_label.setdefault(normalized, set()).add(field.key)

    result = dict(data)
    for normalized, custom_keys in custom_keys_by_label.items():
        field_keys = field_keys_by_label.get(normalized, set())
        if len(custom_keys) != 1 or len(field_keys) != 1:
            continue
        field_key = next(iter(field_keys))
        if result.get(field_key, "").strip():
            continue
        value = str(details[custom_keys[0]].get("value", "") or "").strip()
        if value:
            result[field_key] = value
    return result


def build_form_data(db: Session, *, job_title: str = "") -> dict[str, str]:
    """读取整页批量预填使用的资料，并排除只供本次使用的值。

    简历资料（``UserProfile``）与**网申资料**（``web_form_profile_entry``）在这里合并：
    后者是用户专门为网申填的补充项（四六级分数、档案所在地、紧急联系人…），**简历里没有**。
    ``reuse="once"`` 的内推码、某家的申请编号等只记不进入批量预填。

    ⚠️ **这条合并只发生在网申填表取数中**。简历生成读的是 ``get_profile_detail()`` →
    ``UserProfile``，完全不经过本函数——所以"生成简历不读网申资料"是结构保证的，不靠约定。
    """
    return _custom_label_values_for_batch(
        db, _combine_profile_and_extra_data(db, job_title=job_title, reusable_only=True)
    )


def build_live_form_data(db: Session, *, job_title: str = "") -> dict[str, str]:
    """读取「点哪个填哪个」的实时资料，包括档位为「本次」的已保存字段。

    这些值只作为当前输入框的建议；实时面板仍要求用户明确点击「填入」，不会自动写入页面。
    整页批量预填继续使用 ``build_form_data()``，不受此路径影响。
    """
    data = _combine_profile_and_extra_data(db, job_title=job_title, reusable_only=False)
    return _with_unique_custom_label_values(db, data)


def _normalize_field_label(label: str) -> str:
    """忽略标签中的空白与标点，同时统一全角字符和拉丁字母大小写。"""
    compatible = unicodedata.normalize("NFKC", label)
    folded = unicodedata.normalize("NFKC", compatible.casefold())
    return "".join(char for char in folded if char.isalnum())


def _with_unique_custom_label_values(
    db: Session, data: dict[str, str]
) -> dict[str, str]:
    """仅为实时逐框建议，把唯一精确匹配的自定义标签映射到预设网申字段。

    AI/规则仍负责识别页面字段；这里仅解决识别结果已有规范键、而资料以同名自定义字段
    保存时取不到值的问题。歧义标签不猜，已有规范字段值优先，批量预填不走本函数。
    """
    details = extra_profile.list_details(db)
    custom_keys_by_label: dict[str, list[str]] = {}
    for key, detail in details.items():
        if not key.startswith(CUSTOM_KEY_PREFIX):
            continue
        normalized_label = _normalize_field_label(detail.get("label", ""))
        if normalized_label:
            custom_keys_by_label.setdefault(normalized_label, []).append(key)

    field_keys_by_label: dict[str, list[str]] = {}
    for field in FORM_FIELDS:
        if field.source != SOURCE_EXTRA:
            continue
        for candidate in (field.label, *FIELD_SYNONYMS.get(field.key, ())):
            normalized_label = _normalize_field_label(candidate)
            if normalized_label:
                field_keys_by_label.setdefault(normalized_label, []).append(field.key)

    result = dict(data)
    for normalized_label, custom_keys in custom_keys_by_label.items():
        # 标准字段的 label 普遍也出现在自己的同义词表里，同一字段会对同一标签
        # 贡献两次；唯一性判定针对「字段」，按 key 去重后再看是否恰好一个。
        field_keys = set(field_keys_by_label.get(normalized_label, []))
        if len(custom_keys) != 1 or len(field_keys) != 1:
            continue

        field_key = next(iter(field_keys))
        if (result.get(field_key) or "").strip():
            continue
        value = (details[custom_keys[0]].get("value") or "").strip()
        if value:
            result[field_key] = value
    return result

