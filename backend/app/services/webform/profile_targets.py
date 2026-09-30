"""「记住这条」的保存目标：**只有「网申资料」**。

## 为什么这里看不到简历资料

这个模块曾经能把值写进 ``UserProfile`` 和它下面那几张子表（教育、实习、项目…）。
2026-09-28 收掉了。理由不是"少个功能"，而是两条各自都足够硬的：

1. **简历资料会被生成进简历正文。** 在网申表单上顺手按一下「记住这条」，值就改掉了
   你简历里的内容——而简历是要投出去的。用户要的是"下次填表能自动填"，不是
   "我的简历被顺手改了"。
2. **触发者不完全可信。** 落库的触发是页面里的 ``window.__rfRemember``，而那个全局
   变量**页面上的任何脚本都能写**。目标集里一旦包含 ``profile:*``，就等于给每个网申
   页面开了一条改你简历资料的通道。只收网申资料，这条通道根本不存在。

所以「网申资料」是**唯一**的落点。这不是界面上的限制（藏起来还能被绕过），是这里的
函数**结构上做不到**——本文件里没有任何一行能改 ``UserProfile``。

## 目标 ID

* ``extra:<field_key>``：网申资料里的一个字段，目录内的或已建立的自定义字段；
* ``custom``：按当前字段名新建一条自定义字段。

两个都落在 ``web_form_profile_entry`` 这一张表上。
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy.orm import Session

from ...models.web_form_profile import REUSE_GENERAL
from . import extra_profile
from .fields import FORM_FIELDS, SOURCE_EXTRA

MAX_MEMORY_VALUE_CHARS = 100_000

# 落点所在的那一区。恒为「网申资料」——留着它是为了让前端不必判断"有没有这一项"，
# 也让将来真出现第二种落点时，改动集中在 `_target()` 一处。
SOURCE_EXTRA_ONLY = "extra"


def _target(
    target_id: str,
    group: str,
    label: str,
    value: Any,
    kind: str = "text",
    field_key: str = "",
) -> dict[str, Any]:
    return {
        "target_id": target_id,
        "source": SOURCE_EXTRA_ONLY,
        "group": group,
        "label": label,
        "value": str(value or ""),
        "kind": kind,
        "field_key": field_key,
    }


def _extra_targets(db: Session) -> Iterable[dict[str, Any]]:
    values = extra_profile.list_entries(db)
    for field in FORM_FIELDS:
        if field.source != SOURCE_EXTRA:
            continue
        yield _target(
            f"extra:{field.key}",
            field.group,
            field.label,
            values.get(field.key, ""),
            field.kind,
            field.key,
        )

    groups: list[str] = []
    for field in extra_profile.custom_fields_of(db, groups):
        yield _target(
            f"extra:{field['key']}",
            field["group"],
            field["label"],
            values.get(field["key"], ""),
            field.get("kind", "text"),
            field["key"],
        )


def build_memory_targets(db: Session) -> list[dict[str, Any]]:
    """「记住这条」能选的全部落点。**都在「网申资料」里**（理由见模块说明）。"""
    return list(_extra_targets(db))


def resolve_default_target(db: Session, *, field_key: str, label: str = "") -> dict[str, str]:
    """为实时「记住这条」选一个默认落点：**只可能是网申资料**。

    网申资料里已经有这个字段（无论有没有值）就更新它，没有就按当前页面标签新建一条
    自定义字段。默认值也要走这条逻辑——用户按一下「记住这条」，不该需要先想
    "这属于哪个模块"。
    """
    key = str(field_key or "").strip()
    for target in build_memory_targets(db):
        if target.get("field_key") != key:
            continue
        return {
            "target_id": str(target.get("target_id") or ""),
            "label": str(target.get("label") or label or key),
            "location": " · ".join(
                part
                for part in (
                    "网申资料",
                    str(target.get("group") or ""),
                    str(target.get("label") or label or key),
                )
                if part
            ),
        }

    custom_label = str(label or key or "未命名字段").strip()
    return {
        "target_id": "custom",
        "label": custom_label,
        "location": f"网申资料 · 自定义 · {custom_label}",
    }


def _clean_value(value: str) -> str:
    return str(value or "").strip()[:MAX_MEMORY_VALUE_CHARS]


def remember_target(
    db: Session,
    *,
    target_id: str,
    value: str,
    label: str = "",
    reuse: str = REUSE_GENERAL,
) -> bool:
    """把一条用户明确选择的值写进「网申资料」；不会替换其他资料。

    **只认 ``extra:`` 与 ``custom``**，其余 target_id（包括 ``profile:*`` 这种改简历
    资料的形态）一律返回 False。这条边界是结构性的：函数里根本没有能改 ``UserProfile``
    的代码，所以即使页面伪造了一个 target_id 也落不下去。
    """
    cleaned = _clean_value(value)
    target_id = str(target_id or "").strip()
    if not cleaned or not target_id:
        return False

    if target_id == "custom":
        custom_label = str(label or "").strip()
        if not custom_label:
            return False
        return extra_profile.remember(
            db,
            key=extra_profile.custom_key(custom_label),
            value=cleaned,
            label=custom_label,
            source="manual",
            reuse=REUSE_GENERAL,
        )

    if target_id.startswith("extra:"):
        return extra_profile.remember(
            db,
            key=target_id.removeprefix("extra:"),
            value=cleaned,
            label=label,
            source="manual",
            reuse=REUSE_GENERAL,
        )

    return False


__all__ = [
    "MAX_MEMORY_VALUE_CHARS",
    "SOURCE_EXTRA_ONLY",
    "build_memory_targets",
    "remember_target",
    "resolve_default_target",
]
