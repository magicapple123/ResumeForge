# SPDX-License-Identifier: Apache-2.0
"""网申取数快照：当前组 scope + 消费视图 + 网申专用来源 + R-75 重叠值（F5 契约 §2）。

**为什么要有快照**：网申三处入口（整页批量预填 / 实时建议 / 人工清单）必须"同一屏同一次
取数看到同一份当前组与资料"。如果每个函数各自解析当前组、各自读资料，组在两次读取之间
被切换时，整页预填与清单会来自两个不同的组（用户在资料页切完组马上打开网申就能看到）。
快照把 scope / consumed / all_consumed / 网申专用来源 / R-75 重叠值一次冻结下来。

**简历侧按组裁剪**：consumed 由 F2 的 load_consumed_profile(scope) 给出，未参与分区整键
不出现（C1）。因此把快照交给 defined_fields 产出 data/catalog 时，组外分区在数据层就不存在。

**网申专用项不受组过滤**：wechat/出生/证件/籍贯/政治面貌/手机区号/家庭信息/期望薪资/QQ/
导师/研究方向/意向行业等来自独立的网申专用来源（extra_profile.list_entries 已封装新表 +
历史 user_profile 专用列的只读回退），整体放进 webform_extra，与简历侧分开合并。

**R-75 重叠字段只在 overlap_values 裁决**；本模块把结果冻结在 overlaps 里，写 data 时由
overlap_values.apply_overlap_values 统一覆盖，保证整页预填/实时/清单三处拿到同一个值。

**读路径不写库**：本模块只做 SELECT；bootstrap 修复由 F2 resolver 负责。

并行期说明（F2 未落库时）：F2 的 group_scope/profile_reader 由 reader-scope 并行交付，
这里用函数内延迟导入 + 可注入 loader，模块 import 不依赖它们，测试可以用假 loader 覆盖
整条取数链路；F2 落库后默认 loader 自动生效，无需改调用方。
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ....models.profile import UserProfile
from ....schemas.date_format import normalize_partial_date
from ....schemas.profile_projection import ConsumedProfile
from .defined_fields import DefinedFields, build_defined_fields
from .overlap_values import ResolvedValue, apply_overlap_values, resolve_overlap_values

ScopeLoader = Callable[[Session], Any]
ConsumedLoader = Callable[[Session, Any], ConsumedProfile]
AllConsumedLoader = Callable[[Session], ConsumedProfile]
WebformExtraLoader = Callable[[Session], Mapping[str, str]]


@dataclass(frozen=True)
class WebformProfileSnapshot:
    """一次网申取数的冻结快照；三处入口共用，禁止各自再查当前组/资料。"""

    consumed: ConsumedProfile
    all_consumed: ConsumedProfile
    webform_extra: Mapping[str, str]
    overlaps: Mapping[str, ResolvedValue]

    def defined_fields(self, *, job_title: str = "") -> DefinedFields:
        """简历侧三份输出（data/catalog/custom_labels 同源）——只含当前组参与分区。"""
        return build_defined_fields(self.consumed, job_title=job_title)

    def warnings(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(item.warning for item in self.overlaps.values() if item.warning))


def _default_scope_loader(db: Session) -> Any:
    from ...profile.group_scope import resolve_current_group_scope

    return resolve_current_group_scope(db)


def _default_consumed_loader(db: Session, scope: Any) -> ConsumedProfile:
    from ...profile.profile_reader import load_consumed_profile

    return load_consumed_profile(db, scope)


def _default_all_consumed_loader(db: Session) -> ConsumedProfile:
    from ...profile.profile_reader import load_all_consumed_profile

    return load_all_consumed_profile(db)


# 旧 user_profile 上"只服务网申、不参与简历组过滤"的专用列（R-39；R-46 说明这些列
# 不再被简历/生成链路读取，但网申侧继续只读使用，不做迁移也不复制到新简历模型）。
_LEGACY_DEDICATED_COLUMNS: Mapping[str, str] = {
    "birth_date": "birth_date",
    "birth_year": "birth_year",
    "country_region": "country_region",
    "native_place": "native_place",
    "political_status": "political_status",
    "id_type": "id_type",
    "id_number": "id_number",
    "phone_country_code": "phone_country_code",
    "family_info": "family_info",
    "salary": "expected_salary",
    "preferred_industry": "preferred_industry",
    "wechat": "wechat",
    "qq": "qq",
    "advisor": "advisor",
    "research_direction": "research_direction",
}


def _read_legacy_dedicated(db: Session) -> dict[str, str]:
    """只读旧库里网申专用列；不写库、不把值复制进新模型。"""
    profile = db.query(UserProfile).order_by(UserProfile.id).first()
    if profile is None:
        return {}
    values: dict[str, str] = {}
    for key, column in _LEGACY_DEDICATED_COLUMNS.items():
        raw = str(getattr(profile, column, "") or "").strip()
        if not raw:
            continue
        if key == "phone_country_code" and raw == "+86":
            continue  # 旧模型默认值，不等于用户主动填过
        if key == "birth_date":
            raw = normalize_partial_date(raw)
        values[key] = raw
    return values


def _default_webform_extra_loader(db: Session) -> Mapping[str, str]:
    """网申专用来源：旧 user_profile 专用列（先） + 「网申资料」新表/历史回退（后，覆盖旧列）。"""
    from ..extra_profile import list_entries

    values = _read_legacy_dedicated(db)
    values.update(dict(list_entries(db)))
    return values


def snapshot_from_profiles(
    consumed: ConsumedProfile,
    all_consumed: ConsumedProfile,
    webform_extra: Mapping[str, str],
) -> WebformProfileSnapshot:
    """不查库直接组快照（测试/F2 已提供消费视图的调用方用）。"""
    return WebformProfileSnapshot(
        consumed=consumed,
        all_consumed=all_consumed,
        webform_extra={str(key): str(value) for key, value in webform_extra.items()},
        overlaps=resolve_overlap_values(consumed, all_consumed, webform_extra),
    )


def load_webform_profile_snapshot(
    db: Session,
    *,
    scope_loader: ScopeLoader | None = None,
    consumed_loader: ConsumedLoader | None = None,
    all_consumed_loader: AllConsumedLoader | None = None,
    webform_extra_loader: WebformExtraLoader | None = None,
) -> WebformProfileSnapshot:
    """读取一次网申取数快照（不写库）。

    loader 可注入是为了在 F2 读取层并行交付期间就能对"组裁剪 + 专用项 + R-75"做端到端
    测试；生产路径一律用默认 loader（F2 唯一 resolver + reader），不接受请求体指定组。
    """
    scope = (scope_loader or _default_scope_loader)(db)
    consumed = (consumed_loader or _default_consumed_loader)(db, scope)
    all_consumed = (all_consumed_loader or _default_all_consumed_loader)(db)
    webform_extra = (webform_extra_loader or _default_webform_extra_loader)(db)
    return snapshot_from_profiles(consumed, all_consumed, webform_extra)


def snapshot_form_data(
    snapshot: WebformProfileSnapshot, *, job_title: str = ""
) -> tuple[dict[str, str], tuple[str, ...]]:
    """快照 → 网申 data：组内简历侧 + 网申专用项（专用项优先，沿用旧口径）+ R-75 覆盖。

    返回 (data, warnings)。warnings 由 overlap_values 给出（如"日精度不再显示"），
    调用方负责如实上报，不得静默吞掉。
    """
    data = dict(snapshot.defined_fields(job_title=job_title).data)
    data.update(
        {
            str(key): str(value)
            for key, value in snapshot.webform_extra.items()
            if str(value).strip()
        }
    )
    return apply_overlap_values(data, snapshot.overlaps)


__all__ = [
    "WebformProfileSnapshot",
    "load_webform_profile_snapshot",
    "snapshot_form_data",
    "snapshot_from_profiles",
]
