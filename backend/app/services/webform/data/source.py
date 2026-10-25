# SPDX-License-Identifier: Apache-2.0
"""网申填表的 DB 取数：按当前组裁剪的简历侧 + 网申专用项 + 同一快照的 data/catalog。

**为什么先冻结一份快照**（F5 契约 §2）：整页批量预填、实时建议、人工清单必须来自同一次
取数——当前组、简历侧条目、网申专用项、R-75 重叠值都在一份 WebformProfileSnapshot 里冻结，
三处入口只是从它派生不同输出。各自再查一次库会出现"整页预填按 A 组、人工清单按 B 组"
（用户在资料页切完组马上开网申正好命中）。

**组过滤在数据层就成立**：简历侧来自 F2 的 load_consumed_profile(scope)，未参与分区整键
不出现；这里不做第二套组判断。**网申专用项（微信/证件/籍贯/家庭/期望薪资/导师等）来自
独立的旧专用列与「网申资料」表，不受组过滤**（R-39），它们不参与简历侧裁剪。

**旧补充事实不再进入取数**（F5 契约 §4）：旧表保留、备份继续覆盖，但网申
data/catalog/custom_labels 不再读它；新模型字段（含自建字段）替代候选：有网申目录键的
直接落键，其余以 CUSTOM_<field_id> + 标签进入放宽模式。

**读路径不写库**：只有 scope 解析的幂等 bootstrap 可能写（F2 负责），本模块只读。
"""
from __future__ import annotations

import logging
import unicodedata
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ....models.web_form_profile import CUSTOM_KEY_PREFIX
from .. import extra_profile, repeated_profile
from ..fields import FIELD_SYNONYMS, FORM_FIELDS, SOURCE_EXTRA
from .catalog import build_catalog
from .profile_snapshot import (
    WebformProfileSnapshot,
    load_webform_profile_snapshot,
    snapshot_form_data,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WebformDataView:
    """一份冻结快照产出的三份输出（live_routes/fill_routes 共用，禁止各自再查一次）。"""

    snapshot: WebformProfileSnapshot
    data: dict[str, str]
    catalog: list[dict[str, str]]
    custom_labels: dict[str, str]
    warnings: tuple[str, ...] = ()


def _log_warnings(warnings: tuple[str, ...]) -> None:
    """R-75 的精度提示不能静默丢：响应形态本期不动，先如实写进后端日志。"""
    for message in warnings:
        logger.warning("网申重叠字段提示：%s", message)


def _merged_data(
    db: Session, snapshot: WebformProfileSnapshot, *, job_title: str
) -> tuple[dict[str, str], tuple[str, ...]]:
    """快照 data（组内简历侧 + 专用项 + R-75 覆盖）+ 网申自有补充记录（只补缺）。"""
    data, warnings = snapshot_form_data(snapshot, job_title=job_title)
    # 补充记录（网申侧自己维护的多条经历）：与旧口径一致，只补简历侧没有的键。
    for key, value in repeated_profile.expand_form_data(db).items():
        data.setdefault(key, value)
    return data, warnings


def _combine_profile_and_extra_data(
    db: Session,
    *,
    job_title: str,
    reusable_only: bool,
    snapshot: WebformProfileSnapshot | None = None,
) -> dict[str, str]:
    """合并简历侧与网申资料；由调用方明确选择走批量（reusable）还是实时口径。"""
    snap = snapshot or load_webform_profile_snapshot(db)
    data, warnings = _merged_data(db, snap, job_title=job_title)
    _log_warnings(warnings)
    if reusable_only:
        return _custom_label_values_for_batch(db, data)
    return _with_unique_custom_label_values(db, data)


def build_form_data(
    db: Session,
    *,
    job_title: str = "",
    snapshot: WebformProfileSnapshot | None = None,
) -> dict[str, str]:
    """整页批量预填使用的资料：当前组简历侧 + 网申专用项 + 网申资料（通用档）。

    「一次性」值（内推码、某家的申请编号）不出现在历史接口语义里，这里保持旧口径不变。
    """
    return _combine_profile_and_extra_data(
        db, job_title=job_title, reusable_only=True, snapshot=snapshot
    )


def build_live_form_data(
    db: Session,
    *,
    job_title: str = "",
    snapshot: WebformProfileSnapshot | None = None,
) -> dict[str, str]:
    """「点哪个填哪个」实时资料：与批量同源，额外允许唯一自定义标签的精确别名。"""
    return _combine_profile_and_extra_data(
        db, job_title=job_title, reusable_only=False, snapshot=snapshot
    )


def _extra_custom_labels(db: Session) -> dict[str, str]:
    """「网申资料」里用户自定义 key 的显示名（放宽模式按它匹配）。"""
    details = extra_profile.list_details(db)
    return {
        key: str(detail.get("label") or "")
        for key, detail in details.items()
        if key.startswith(CUSTOM_KEY_PREFIX) and str(detail.get("label") or "").strip()
    }


def build_webform_view(
    db: Session,
    *,
    job_title: str = "",
    live: bool = False,
    snapshot: WebformProfileSnapshot | None = None,
) -> WebformDataView:
    """一次刷新只冻结一份快照，产出 data + catalog + custom_labels（三处同源）。

    live_routes 的初始取数与每次聚焦刷新、fill_routes 的预览都走它；不接受调用方指定组。
    """
    snap = snapshot or load_webform_profile_snapshot(db)
    data, warnings = _merged_data(db, snap, job_title=job_title)
    _log_warnings(warnings)
    if live:
        data = _with_unique_custom_label_values(db, data)
    else:
        data = _custom_label_values_for_batch(db, data)
    defined = snap.defined_fields(job_title=job_title)
    custom_labels = dict(defined.custom_labels)
    custom_labels.update(_extra_custom_labels(db))
    return WebformDataView(
        snapshot=snap,
        data=data,
        catalog=build_catalog(db, job_title=job_title, snapshot=snap),
        custom_labels=custom_labels,
        warnings=warnings,
    )


def _normalize_field_label(label: str) -> str:
    """忽略标签中的空白与标点，同时统一全角字符和拉丁字母大小写。"""
    compatible = unicodedata.normalize("NFKC", label)
    folded = unicodedata.normalize("NFKC", compatible.casefold())
    return "".join(char for char in folded if char.isalnum())


def _apply_custom_label_aliases(
    db: Session, data: dict[str, str], *, extra_source_only: bool
) -> dict[str, str]:
    """唯一精确匹配的自定义标签 → 唯一标准字段；歧义不猜、已有值优先。

    批量与实时共用这一处唯一性判定，差别只在候选字段范围：实时只看 source=extra 的
    网申资料字段（理由见旧实现：页面识别出的规范键才有机会从自定义标签补值），批量
    沿用历史口径覆盖整个 FORM_FIELDS。标准字段 label 普遍也出现在自己的同义词表里，
    所以唯一性按字段 key 去重后再判定。
    """
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
        if extra_source_only and field.source != SOURCE_EXTRA:
            continue
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
        if (result.get(field_key) or "").strip():
            continue
        value = str(details[custom_keys[0]].get("value") or "").strip()
        if value:
            result[field_key] = value
    return result


def _custom_label_values_for_batch(db: Session, data: dict[str, str]) -> dict[str, str]:
    """批量预填：整个 FORM_FIELDS 范围的历史映射口径。"""
    return _apply_custom_label_aliases(db, data, extra_source_only=False)


def _with_unique_custom_label_values(
    db: Session, data: dict[str, str]
) -> dict[str, str]:
    """实时逐框建议：只看 source=extra 的网申资料字段（旧行为保持不变）。"""
    return _apply_custom_label_aliases(db, data, extra_source_only=True)


__all__ = [
    "WebformDataView",
    "build_form_data",
    "build_live_form_data",
    "build_webform_view",
]
