# SPDX-License-Identifier: Apache-2.0
"""人工挑选完整清单：与 data 同源的 defined 目录 + 网申专用项 + 网申自有补充。

**为什么不再是"另一个 mapping"**（F5 契约 §2）：旧实现从 get_profile_detail() 再展开一份
清单，与 data 那份各自维护、字段增减要改两处。现在清单从同一份 WebformProfileSnapshot
派生：简历侧用 defined_fields 的同一次遍历结果，网申专用项来自 snapshot.webform_extra，
R-75 重叠字段带来源标注，补充记录来自 repeated_profile。因此"当前组不含实习"时，清单里
也不会出现实习条目——不是靠前端过滤。

清单的 key 与 data 的键一一对应（未映射字段用 CUSTOM_<field_id>），所以人工挑选的行可以
被 related_entries 正确排序，也不会出现"清单显示一条、整页预填却取不到"的裂缝。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .. import extra_profile, repeated_profile
from ..fields import FORM_FIELDS
from .overlap_values import catalog_entries as overlap_catalog_entries
from .profile_map import _as_block_text
from .profile_snapshot import WebformProfileSnapshot, load_webform_profile_snapshot


def build_catalog(
    db: Session,
    *,
    job_title: str = "",
    snapshot: WebformProfileSnapshot | None = None,
) -> list[dict[str, str]]:
    """返回完整可挑选目录：组内简历侧 + 网申专用项 + 补充记录（同一次取数）。"""
    snap = snapshot or load_webform_profile_snapshot(db)
    entries: list[dict[str, str]] = [
        dict(row) for row in snap.defined_fields(job_title=job_title).catalog
    ]
    # R-75 重叠字段：带来源标注（我的资料 / 教育经历 N / 网申资料），前端据此说清来源。
    entries.extend(overlap_catalog_entries(snap.overlaps))
    entries.extend(repeated_profile.catalog_entries(db))
    known_keys = {str(entry.get("key") or "") for entry in entries}

    values = snap.webform_extra
    for field in FORM_FIELDS:
        value = str(values.get(field.key, "") or "").strip()
        if not value or field.key in known_keys:
            continue
        entries.append(
            {
                "group": field.group,
                "label": field.label,
                "value": _as_block_text(value),
                "key": field.key,
                "source": "extra",
            }
        )
        known_keys.add(field.key)

    custom_groups: list[str] = []
    details = extra_profile.list_details(db)
    for field in extra_profile.custom_fields_of(db, custom_groups):
        key = field["key"]
        value = str(values.get(key, "") or "").strip()
        if not value or key in known_keys:
            continue
        entries.append(
            {
                "group": field["group"],
                "label": field["label"],
                "value": _as_block_text(value),
                "key": key,
                "source": "extra",
                "reuse": details.get(key, {}).get("reuse", "general"),
            }
        )
        known_keys.add(key)
    return entries


__all__ = ["build_catalog"]
