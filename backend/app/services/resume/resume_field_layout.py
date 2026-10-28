# SPDX-License-Identifier: Apache-2.0
"""W4「条目字段排版」：format_config.field_layout 域的校验、解析与共享 CSS（单一来源）。

**解决什么**：教育 / 实习 / 项目等条目的补充字段（学习形式、学位类型、院系、成绩排名、
导师、研究方向…）此前在 HTML / PDF / Word / Markdown 里一律「每字段一行、全部左对齐」。
字段一多，纸面左边挤成一列、右半边空着。这个域让用户按分区设置：每行几列（1–3）、
字段顺序、哪些字段必须独占一行。

**四个渲染器只能从这里取**：行装箱（columns / order / solo）是同一件事，HTML / PDF /
Word / Markdown 各写一遍必然漂移。HTML 模板拿到的是 `profile_field_rows` 预先算好的
行；PDF / Word / Markdown 直接消费同一份函数。

**默认 = 现状**：域为空（或某分区没配置）时解析结果为空字典，四个格式走它们**原有**的
逐字段一行路径，产物逐字节不变（HTML 甚至保留原来的标记，不进入 `.sub-row` 分支）。

数据形状（version 1）::

    {
      "version": 1,
      "education": {
        "columns": 2,
        "order": ["gpa", ...],   # 只存"与默认不同"的规范化顺序（去重）
        "solo": ["research_direction"],
      },
      ...
    }

* 分区键 ∈ `FIELD_LAYOUT_SECTIONS`（七个承载补充字段的分区）；
* `order` 只含该分区 `PROFILE_FIELD_ORDER` 里的字段名，未知键丢弃、去重，
  未列出的字段按默认顺序补在末尾；
* `solo` 是 order 的子集，表示"必须独占一行"；
* `columns` 夹取到 1–3；
* 与默认完全相同的分区不落库（空分区 = 没有调整），整域为空时返回 None（契约 R3）。
"""

from __future__ import annotations

from .profile_field_lines import PROFILE_FIELD_ORDER, ROW_SEPARATOR
from .resume_config_domains import domain_version, is_supported

FIELD_LAYOUT_DOMAIN = "field_layout"
FIELD_LAYOUT_VERSION = 1

# 七个承载"补充字段"的分区（ResumeContent 字段名，与四个渲染器的分区键一致）。
# skills / credentials 的补充字段走行内渲染（技能分类 / 证书类型），不属于本域：
# 它们本来就和主字段同一行，没有"分行/占位"可调。
FIELD_LAYOUT_SECTIONS: tuple[str, ...] = (
    "education",
    "experience",
    "campus_experience",
    "projects",
    "awards",
    "publications",
    "research_projects",
)

DEFAULT_COLUMNS = 1
MAX_COLUMNS = 3


def default_order(section_key: str) -> tuple[str, ...]:
    """该分区补充字段的默认顺序（= F8 契约顺序 = 现状逐行顺序）。"""
    return PROFILE_FIELD_ORDER.get(section_key, ())


def _validated_columns(raw: object) -> int:
    """columns 夹取到 1–3；非数字 / 布尔 / NaN 一律回默认 1（不抛异常）。"""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return DEFAULT_COLUMNS
    if raw != raw:  # NaN
        return DEFAULT_COLUMNS
    return max(DEFAULT_COLUMNS, min(int(raw), MAX_COLUMNS))


def _validated_order(raw: object, section_key: str) -> tuple[str, ...]:
    """未知/重复字段丢弃；未列出的字段按默认顺序补在末尾（返回全量顺序）。"""
    fields = default_order(section_key)
    if not isinstance(raw, (list, tuple)):
        return fields
    seen: set[str] = set()
    order: list[str] = []
    for item in raw:
        if isinstance(item, str) and item in fields and item not in seen:
            seen.add(item)
            order.append(item)
    order.extend(field for field in fields if field not in seen)
    return tuple(order)


def _validated_solo(raw: object, order: tuple[str, ...]) -> tuple[str, ...]:
    """solo 必须是 order 的子集；重复项丢弃（按 order 的先后输出）。"""
    if not isinstance(raw, (list, tuple)):
        return ()
    wanted = {item for item in raw if isinstance(item, str)}
    return tuple(field for field in order if field in wanted)


def _validate_section(raw: object, section_key: str) -> dict | None:
    """单个分区的规范化结果；与默认完全一致时返回 None（空分区不落库）。"""
    if not isinstance(raw, dict):
        return None
    columns = _validated_columns(raw.get("columns"))
    order = _validated_order(raw.get("order"), section_key)
    solo = _validated_solo(raw.get("solo"), order)
    if columns == DEFAULT_COLUMNS and order == default_order(section_key) and not solo:
        return None
    cleaned: dict = {"columns": columns}
    # 只存与默认不同的顺序：默认顺序永远能从 PROFILE_FIELD_ORDER 重建，少存一份就少
    # 一处可能过期的数据；解析时缺键 = 用默认顺序。
    if order != default_order(section_key):
        cleaned["order"] = list(order)
    if solo:
        cleaned["solo"] = list(solo)
    return cleaned


def validate_field_layout_domain(raw: object) -> dict | None:
    """W4 白名单校验：返回可落库的域（含 version）或 None（空域 / 版本不支持）。

    与其它域同口径：未知段键 / 未知字段键**丢弃而不 422**（format_config 是用户可以
    随手改的 JSON）。列数越界**夹取**而不是丢弃：它是枚举语义，夹到最近的合法值对用户
    更友好，渲染端本来也必须防御非法列数。
    """
    version = domain_version(raw)
    if not is_supported(FIELD_LAYOUT_DOMAIN, version):
        return None
    if not isinstance(raw, dict):
        return None
    sections: dict[str, dict] = {}
    for section_key in FIELD_LAYOUT_SECTIONS:
        cleaned = _validate_section(raw.get(section_key), section_key)
        if cleaned is not None:
            sections[section_key] = cleaned
    if not sections:
        return None
    return {"version": FIELD_LAYOUT_VERSION, **sections}


def _resolved_section(payload: dict, section_key: str) -> dict:
    """把落库的紧凑形状展开成渲染端可直接用的完整形状（order 全量、solo 为列表）。"""
    order = _validated_order(payload.get("order"), section_key)
    return {
        "columns": _validated_columns(payload.get("columns")),
        "order": list(order),
        "solo": list(_validated_solo(payload.get("solo"), order)),
    }


def resolve_field_layout(format_config: dict | None) -> dict[str, dict]:
    """从 format_config 读 field_layout 域（已校验或原始形状都能吃，畸形输入按空域）。

    Returns:
        `{section_key: {"columns": int, "order": list[str], "solo": list[str]}}`；
        空字典 = 没有配置（调用方走默认逐字段一行路径）。
    """
    if not isinstance(format_config, dict):
        return {}
    raw = format_config.get(FIELD_LAYOUT_DOMAIN)
    if not isinstance(raw, dict):
        return {}
    if not is_supported(FIELD_LAYOUT_DOMAIN, domain_version(raw)):
        return {}
    resolved: dict[str, dict] = {}
    for section_key in FIELD_LAYOUT_SECTIONS:
        payload = _validate_section(raw.get(section_key), section_key)
        if payload is None:
            continue
        resolved[section_key] = _resolved_section(payload, section_key)
    return resolved


def field_layout_css(layout: dict | None) -> str:
    """HTML 侧共享样式：只有存在配置时才注入（默认产物一个字符都不多）。

    行容器沿用各模板既有的 `.entry .sub` 外观（字号 / 颜色 / 上下间距），这里只补
    flex 布局。calc(var(--fs) * …) 与模板自己的尺寸同口径，不写死像素。
    """
    if not layout:
        return ""
    return (
        ".sub.sub-row { display: flex; flex-wrap: wrap;"
        " column-gap: calc(var(--fs) * 1.2); }\n"
        ".sub-row .sub-cell { flex: 0 1 auto; min-width: 0; }"
    )


__all__ = [
    "DEFAULT_COLUMNS",
    "FIELD_LAYOUT_DOMAIN",
    "FIELD_LAYOUT_SECTIONS",
    "FIELD_LAYOUT_VERSION",
    "MAX_COLUMNS",
    "ROW_SEPARATOR",
    "default_order",
    "field_layout_css",
    "resolve_field_layout",
    "validate_field_layout_domain",
]
