# SPDX-License-Identifier: Apache-2.0
"""R-75 重叠字段的唯一取值实现：政治面貌 / 出生日期年月 / 导师 / 研究方向。

**为什么单独一个模块**（F5 契约 §3）：这四类字段同时有"新资料模型"与"旧网申专用来源"
两份可能的值，取值规则必须只有一处实现。散落在 source/catalog/profile_map 里各写一份，
就会出现"整页批量预填用了新值、人工清单还显示旧值"这种同一屏内自相矛盾。

**权威规则**（需求 v3 R-75）：
1. 单值字段（政治面貌、出生）新基本条目**显式写入后以它为准**，两处读写指向同一值；
   显式清空 = 用户要清空，**不回落旧值**；尚未接管时读取既有网申来源并标注来源。
2. 出生日期保留真实精度：网申来源有完整日期且与资料侧年月一致时保留日；资料侧只有
   年月/年时**不伪造日**，覆盖掉原有日精度时给出 warning（不静默丢）。
3. 导师/研究方向取**全量新教育**里最近一段（进行中优先 → 可解析结束时间 → 开始时间 →
   显式条目序号；不可解析日期不猜），值为空才回落网申单值；它属于网申专用输出，
   不因教育分区未入当前组而消失，也不顺带恢复该教育条目的其它派生字段。

本模块是纯函数：只读传入的消费 DTO 与"网申专用来源"字典，不查库、不写库。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from ....schemas.date_format import normalize_partial_date
from ....schemas.profile_projection import ConsumedEntry, ConsumedProfile

# 这些 key 是"网申 data 字典"里的最终字段名（与 FORM_FIELDS 对齐）。
POLITICAL_STATUS = "political_status"
BIRTH_DATE = "birth_date"
BIRTH_YEAR = "birth_year"
BIRTH_MONTH = "birth_month"
ADVISOR = "advisor"
RESEARCH_DIRECTION = "research_direction"

# 只把 webform 目录里真实存在的键写回 data；birth_month 仅用于来源说明。
WEBFORM_DATA_KEYS = (
    POLITICAL_STATUS,
    BIRTH_DATE,
    BIRTH_YEAR,
    ADVISOR,
    RESEARCH_DIRECTION,
)

_ONGOING_KEY = (9999, 12, 31)


@dataclass(frozen=True)
class ResolvedValue:
    """一个重叠字段的最终值 + 来源；source 为 profile/webform/education/none。"""

    value: str
    source: str = "none"
    source_detail: str = ""
    warning: str = ""


@dataclass(frozen=True)
class SelectedEducation:
    """最近一段教育经历（R-75 规则 3）；position 是资料里的展示序号（1-based）。"""

    entry: ConsumedEntry
    position: int
    detail: str


def _date_key(raw: str) -> tuple[int, int, int] | None:
    """把 YYYY / YYYY-MM / YYYY-MM-DD 变成可比较元组；认不出返回 None（不猜）。"""
    text = normalize_partial_date(raw)
    if not text or text == "至今":
        return None
    parts = text.split("-")
    try:
        year = int(parts[0])
        month = int(parts[1]) if len(parts) > 1 else 0
        day = int(parts[2]) if len(parts) > 2 else 0
    except (ValueError, IndexError):
        return None
    if year < 1 or not 0 <= month <= 12 or not 0 <= day <= 31:
        return None
    return (year, month, day)


def _is_ongoing(raw: str) -> bool:
    return normalize_partial_date(raw) == "至今"


def _field_value(entry: ConsumedEntry, field_id: str) -> str:
    return str(entry.values.get(field_id) or "").strip()


def _section_entries(
    consumed: ConsumedProfile | None, section_key: str
) -> tuple[ConsumedEntry, ...]:
    if consumed is None:
        return ()
    section = consumed.sections.get(section_key)
    return () if section is None else section.entries


def _ordered_entries(entries: Sequence[ConsumedEntry]) -> list[ConsumedEntry]:
    """按显式条目序号稳定排序（序号相同按 entry_id，避免随查询顺序漂移）。"""
    return sorted(entries, key=lambda item: (int(item.sort_order or 0), item.entry_id))


def select_recent_education(consumed: ConsumedProfile | None) -> SelectedEducation | None:
    """从全量消费快照里选"最近一段教育经历"（R-75 规则 3）。

    排序优先级：进行中（结束时间为"至今"）> 可解析结束时间 > 可解析开始时间 >
    显式条目序号。结束/开始时间都不可解析时不猜日期，直接落到稳定的条目序号。
    """
    entries = _ordered_entries(_section_entries(consumed, "educations"))
    if not entries:
        return None

    best: tuple[tuple[int, tuple[int, int, int]], int, ConsumedEntry] | None = None
    for position, entry in enumerate(entries, start=1):
        end_raw = _field_value(entry, "educations.end_date")
        start_raw = _field_value(entry, "educations.start_date")
        end_key = _date_key(end_raw)
        start_key = _date_key(start_raw)
        if _is_ongoing(end_raw):
            rank: tuple[int, tuple[int, int, int]] = (3, _ONGOING_KEY)
        elif end_key is not None:
            rank = (2, end_key)
        elif start_key is not None:
            rank = (1, start_key)
        else:
            rank = (0, (0, 0, 0))
        candidate = (rank, position, entry)
        if best is None or (candidate[0], -candidate[1]) > (best[0], -best[1]):
            best = candidate
    assert best is not None
    _rank, position, entry = best
    school = _field_value(entry, "educations.school")
    detail = f"教育经历 {position}" + (f"（{school}）" if school else "")
    return SelectedEducation(entry=entry, position=position, detail=detail)


def _takeover(
    profile_present: bool,
    profile_value: str,
    webform_value: str,
    *,
    profile_detail: str,
    webform_detail: str = "网申资料",
) -> ResolvedValue:
    """单值字段的权威规则：新资料显式写入（含显式空串）后不再回落旧来源。"""
    if profile_present:
        return ResolvedValue(value=profile_value, source="profile", source_detail=profile_detail)
    text = str(webform_value or "").strip()
    if text:
        return ResolvedValue(value=text, source="webform", source_detail=webform_detail)
    return ResolvedValue(value="", source="none")


def resolve_political_status(
    consumed: ConsumedProfile, webform_values: Mapping[str, str]
) -> ResolvedValue:
    """政治面貌：新基本条目显式写入即接管；否则读网申专用来源并标注来源。"""
    entries = _section_entries(consumed, "basic_info")
    entry = entries[0] if entries else None
    field_id = "basic_info.political_status"
    if entry is not None and field_id in entry.values:
        return ResolvedValue(
            value=str(entry.values.get(field_id) or "").strip(),
            source="profile",
            source_detail="我的资料 · 基本信息",
        )
    return _takeover(
        False,
        "",
        webform_values.get(POLITICAL_STATUS, ""),
        profile_detail="我的资料 · 基本信息",
    )


def resolve_birth_values(
    consumed: ConsumedProfile, webform_values: Mapping[str, str]
) -> dict[str, ResolvedValue]:
    """出生日期/年份：资料侧年月不伪造日；完整日期在年月兼容时保留精度。

    资料侧显式写入 birth_month 后接管；显式清空不回落网申旧值（规则 1）。
    资料侧只有年月、而网申来源有完整日期且前缀一致时，保留完整日期（规则 2）。
    两处不一致时以资料侧为准，并给出"日精度不再可见"的 warning，不静默丢弃。
    """
    entries = _section_entries(consumed, "basic_info")
    entry = entries[0] if entries else None
    field_id = "basic_info.birth_month"
    profile_present = entry is not None and field_id in entry.values
    profile_month = normalize_partial_date(_field_value(entry, field_id)) if entry else ""
    webform_date = normalize_partial_date(webform_values.get(BIRTH_DATE, ""))
    webform_year = str(webform_values.get(BIRTH_YEAR, "") or "").strip()

    if not profile_present:
        year = webform_year or (webform_date[:4] if webform_date else "")
        month = webform_date[:7] if len(webform_date) >= 7 else year
        source = "webform" if (webform_date or webform_year) else "none"
        detail = "网申资料" if source == "webform" else ""
        return {
            BIRTH_DATE: ResolvedValue(webform_date, source, detail),
            BIRTH_YEAR: ResolvedValue(year, source, detail),
            BIRTH_MONTH: ResolvedValue(month, source, detail),
        }

    detail = "我的资料 · 基本信息"
    if not profile_month:
        warning = ""
        if webform_date or webform_year:
            warning = "资料侧已清空出生年月，网申里原有的出生日期不再使用"
        return {
            BIRTH_DATE: ResolvedValue("", "profile", detail, warning),
            BIRTH_YEAR: ResolvedValue("", "profile", detail, warning),
            BIRTH_MONTH: ResolvedValue("", "profile", detail, warning),
        }

    year = profile_month[:4]
    if webform_date and webform_date.startswith(profile_month):
        return {
            BIRTH_DATE: ResolvedValue(webform_date, "webform", "网申资料（保留日精度）"),
            BIRTH_YEAR: ResolvedValue(year, "profile", detail),
            BIRTH_MONTH: ResolvedValue(profile_month, "profile", detail),
        }
    warning = ""
    if len(webform_date) > len(profile_month):
        warning = (
            f"资料侧只记录到{profile_month}，网申里原来的完整出生日期"
            f"{webform_date} 的日精度不再显示"
        )
    return {
        BIRTH_DATE: ResolvedValue(profile_month, "profile", detail, warning),
        BIRTH_YEAR: ResolvedValue(year, "profile", detail),
        BIRTH_MONTH: ResolvedValue(profile_month, "profile", detail),
    }


def resolve_education_values(
    all_consumed: ConsumedProfile, webform_values: Mapping[str, str]
) -> dict[str, ResolvedValue]:
    """导师/研究方向：取全量新教育里最近一段；为空才回落网申单值。

    **只读这两个字段**：不因要取导师就把该教育条目的学校/专业等派生字段也带回网申，
    也不受当前组是否参与教育经历影响（R-75 规则 3/4）。
    """
    selected = select_recent_education(all_consumed)
    result: dict[str, ResolvedValue] = {}
    for key, field_id in (
        (ADVISOR, "educations.advisor"),
        (RESEARCH_DIRECTION, "educations.research_direction"),
    ):
        if selected:
            profile_value = _field_value(selected.entry, field_id)
            if profile_value:
                result[key] = ResolvedValue(profile_value, "education", selected.detail)
                continue
        result[key] = _takeover(False, "", webform_values.get(key, ""), profile_detail="我的资料")
    return result


def resolve_overlap_values(
    consumed: ConsumedProfile,
    all_consumed: ConsumedProfile,
    webform_values: Mapping[str, str],
) -> dict[str, ResolvedValue]:
    """全部 R-75 重叠字段的最终值与来源（供 data 覆盖 + 前端来源标注）。"""
    resolved: dict[str, ResolvedValue] = {
        POLITICAL_STATUS: resolve_political_status(consumed, webform_values),
        ADVISOR: ResolvedValue(""),
        RESEARCH_DIRECTION: ResolvedValue(""),
    }
    resolved.update(resolve_birth_values(consumed, webform_values))
    resolved.update(resolve_education_values(all_consumed, webform_values))
    return resolved


_CATALOG_LABELS: Mapping[str, str] = {
    POLITICAL_STATUS: "政治面貌",
    BIRTH_DATE: "出生日期",
    BIRTH_YEAR: "出生年份",
    ADVISOR: "导师",
    RESEARCH_DIRECTION: "研究方向",
}


def catalog_entries(resolved: Mapping[str, ResolvedValue]) -> list[dict[str, str]]:
    """人工清单里的重叠字段行：值 + 来源标注（资料条目 / 网申资料），供前端标来源。"""
    rows: list[dict[str, str]] = []
    for key, label in _CATALOG_LABELS.items():
        item = resolved.get(key)
        if item is None or not item.value.strip():
            continue
        source = "extra" if item.source == "webform" else "profile"
        rows.append(
            {
                "group": "网申资料" if source == "extra" else "基本信息",
                "label": label,
                "value": item.value.strip(),
                "key": key,
                "source": source,
                "source_detail": item.source_detail,
            }
        )
    return rows


def apply_overlap_values(
    data: Mapping[str, str], resolved: Mapping[str, ResolvedValue]
) -> tuple[dict[str, str], tuple[str, ...]]:
    """把重叠字段写回网申 data（覆盖旧来源），并收集需要如实提示的 warning。"""
    result = dict(data)
    warnings: list[str] = []
    for key in WEBFORM_DATA_KEYS:
        item = resolved.get(key)
        value = (item.value if item is not None else "").strip()
        if value:
            result[key] = value
        else:
            result.pop(key, None)
        if item is not None and item.warning:
            warnings.append(item.warning)
    return result, tuple(dict.fromkeys(warnings))


__all__ = [
    "ADVISOR",
    "BIRTH_DATE",
    "BIRTH_MONTH",
    "BIRTH_YEAR",
    "POLITICAL_STATUS",
    "RESEARCH_DIRECTION",
    "ResolvedValue",
    "SelectedEducation",
    "WEBFORM_DATA_KEYS",
    "apply_overlap_values",
    "catalog_entries",
    "resolve_birth_values",
    "resolve_education_values",
    "resolve_overlap_values",
    "resolve_political_status",
    "select_recent_education",
]
