# SPDX-License-Identifier: Apache-2.0
"""W4「条目字段排版」：format_config.field_layout 域的校验、解析与共享 CSS（单一来源）。

**解决什么**：教育 / 实习 / 项目等条目的补充字段（学习形式、学位类型、院系、成绩排名、
导师、研究方向…）此前在 HTML / PDF / Word / Markdown 里一律「每字段一行、全部左对齐」。
字段一多，纸面左边挤成一列、右半边空着。这个域让用户按分区设置：每行几列（1–3）、
列内对齐方式、列间距、字段顺序、哪些字段必须独占一行。

**四个渲染器只能从这里取**：行装箱（columns / order / solo）是同一件事，HTML / PDF /
Word / Markdown 各写一遍必然漂移。HTML 模板拿到的是 `profile_field_rows` 预先算好的
行；PDF / Word / Markdown 直接消费同一份函数。

**默认 = 现状**：域为空（或某分区没配置）时解析结果为空字典，四个格式走它们**原有**的
逐字段一行路径，产物逐字节不变（HTML 甚至保留原来的标记，不进入 `.sub-row` 分支）。

数据形状（version 1，**向后兼容**：条目级只是新增的可选段，旧数据一个字节都不用改）::

    {
      "version": 1,
      "education": {
        "columns": 2,
        "align": "equal",        # 只存"与默认不同"的值（默认 equal，不落库）
        "gap": 1.8,              # 字号倍数；等于当前 align 的兜底值时不落库
        "order": ["gpa", ...],   # 只存"与默认不同"的规范化顺序（去重）
        "solo": ["research_direction"],
      },
      "entries": {               # 条目级：只覆盖"这一条"（键 = W01 稳定 id）
        "education": {"aBc12345": {"columns": 3}, "dEf67890": {"gap": 4.0}},
      },
    }

* `entries` 是**两层**的（分区 → 条目 id → 显式改过的键）：条目 id 只在同一数组内唯一、
  跨分区可以重复（见 `document_identity`），不能拍平成一层的 id 键；
* 条目层**只存显式改过的键**，没写到的继承分区默认；叠上覆盖后与分区解析结果完全相同的
  整条丢弃（= "没改过"），`entries` 整段为空时不写这个键（空域不落库）；
* 条目 id 必须匹配 `OBJECT_ID_PATTERN`，不合法的整条丢弃——这也是 `field_layout_css`
  敢把 id 拼进 CSS 类名的前提；
* 分区键 ∈ `FIELD_LAYOUT_SECTIONS`（七个承载补充字段的分区）；
* `order` 只含该分区 `PROFILE_FIELD_ORDER` 里的字段名，未知键丢弃、去重，
  未列出的字段按默认顺序补在末尾；
* `solo` 是 order 的子集，表示"必须独占一行"；
* `columns` 夹取到 1–3；
* `align` ∈ `FIELD_LAYOUT_ALIGNS`（`equal` 等宽分栏 / `flow` 按内容顺排），缺省 `equal`；
* `gap` 是**字号倍数**（`0`–`30.0`，1 位小数），不是像素：存 px 会让"改字号 / 换模板
  后间距错位"，也违反"模板不写死像素"的既有约定。缺省 = 未设置，两种对齐模式各有兜底
  （`equal` 1.6 / `flow` 1.2，见 `default_gap`）；与当前 align 的兜底值相同时不落库。
  `0` 是**合法值**（两列完全紧挨），必须与"未设置"（`None`）区分开：所有判断都走
  `is None` / 数值比较，绝不用真值判断（`0` 为假会把用户的选择退回兜底）；
  旧版的字符串枚举仍能读（`narrow`→0.8、`wide`→3.0、`normal`→未设置），写回一律是数值，
  不会再产出字符串；未知值 / 坏值一律当未设置（不 422）；
* 与默认完全相同的分区不落库（空分区 = 没有调整），整域为空时返回 None（契约 R3）。

`align` 缺省为 `equal` 是**有意的**：多列时旧的 `{"columns": 2}` 配置解析出来就是等宽
分栏，用户不用迁移也能拿到对齐的版面；想还原"按内容顺排"的人显式选 `flow` 即可。
"""

from __future__ import annotations

from .document_identity import OBJECT_ID_PATTERN
from .profile_field_lines import PROFILE_FIELD_ORDER, ROW_SEPARATOR
from .resume_config_domains import domain_version, is_supported

FIELD_LAYOUT_DOMAIN = "field_layout"
FIELD_LAYOUT_VERSION = 1

# 条目级覆盖所在的两层段键：`entries.<section>.<entry_id> = {显式改过的键}`。
ENTRIES_KEY = "entries"

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

# 列内的对齐方式：equal = 等宽分栏（跨行对齐，多列的默认值）；flow = 按内容顺排（旧行为）。
FIELD_LAYOUT_ALIGNS: tuple[str, ...] = ("equal", "flow")

DEFAULT_ALIGN = "equal"

# 列间距是**字号倍数**（不是像素）：改字号 / 换模板后按比例跟随，模板不写死像素。
# 区间取 0–30（面板滑杆同范围，步长 0.5）：`0` = 两列完全紧挨（用户要的"紧挨"），`30` = 30
# 个字号宽的空隙，双列时几乎把两栏推到纸边。此前是 0.2–8.0：下限 0.2 不够紧、上限 8 用户
# 两轮反馈"拉开得不过瘾"，这次两头一起放开。
# **`0` 是合法值，不是"未设置"**：本模块所有判断都是 `is None` / 数值比较，没有真值判断
# （`if gap:` 会把 0 当成没填，用户选"紧挨"就退回 1.6 兜底）。
GAP_MIN = 0.0
GAP_MAX = 30.0
# 两种对齐模式各有兜底间距：等宽分栏用 1.6（足够区分两列），按内容顺排沿用改造前的 1.2。
DEFAULT_GAP_EQUAL = 1.6
DEFAULT_GAP_FLOW = 1.2
# 旧版字符串枚举 → 倍数。`normal` 不在表里 = "未设置"（走兜底），与旧语义一致。
LEGACY_GAP_VALUES: dict[str, float] = {"narrow": 0.8, "wide": 3.0}


def default_gap(align: str) -> float:
    """该对齐模式的兜底列间距（字号倍数）：flow 用 1.2，其余（equal）用 1.6。"""
    return DEFAULT_GAP_FLOW if align == "flow" else DEFAULT_GAP_EQUAL


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


def _validated_align(raw: object) -> str:
    """align 只接受 `FIELD_LAYOUT_ALIGNS` 里的字符串；未知值 / 非字符串落回默认。

    与 `_validated_columns` 同口径：format_config 是用户可以随手改的 JSON，坏值由渲染端
    的默认行为兜住，**不抛异常也不 422**（多列旧配置因此自动拿到 `equal`）。
    """
    if isinstance(raw, str) and raw in FIELD_LAYOUT_ALIGNS:
        return raw
    return DEFAULT_ALIGN


def _validated_gap(raw: object) -> float | None:
    """gap 归一成字号倍数（1 位小数）；`None` = 未设置（渲染端按 align 的兜底值）。

    取值口径（全部**不抛异常、不 422**，format_config 是用户可以随手改的 JSON）：
    * 布尔 / 非数字 / NaN → `None`；
    * 字符串先查 `LEGACY_GAP_VALUES`（`narrow`→0.8、`wide`→3.0；`normal` 与未知串 → `None`）；
    * 数值夹取到 `[GAP_MIN, GAP_MAX]` 后 `round(…, 1)`；`0` 原样保留（合法值 = 完全紧挨）。
    """
    if isinstance(raw, bool):
        return None
    if isinstance(raw, str):
        return LEGACY_GAP_VALUES.get(raw)
    if not isinstance(raw, (int, float)):
        return None
    value = float(raw)
    if value != value:  # NaN
        return None
    return round(max(GAP_MIN, min(value, GAP_MAX)), 1)


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
    align = _validated_align(raw.get("align"))
    gap = _validated_gap(raw.get("gap"))
    order = _validated_order(raw.get("order"), section_key)
    solo = _validated_solo(raw.get("solo"), order)
    # 「gap 与默认一致」= 未设置，或恰好等于**当前对齐模式**的兜底值（两种模式兜底不同）。
    gap_is_default = gap is None or abs(gap - default_gap(align)) < 1e-9
    if (
        columns == DEFAULT_COLUMNS
        and align == DEFAULT_ALIGN
        and gap_is_default
        and order == default_order(section_key)
        and not solo
    ):
        return None
    cleaned: dict = {"columns": columns}
    # align / gap 与 order 一样只存与默认不同的值：默认值永远能从常量重建，少存一份就少
    # 一处可能过期的数据；解析时缺键 = 用默认值。
    if align != DEFAULT_ALIGN:
        cleaned["align"] = align
    if not gap_is_default and gap is not None:
        cleaned["gap"] = gap
    # 只存与默认不同的顺序：默认顺序永远能从 PROFILE_FIELD_ORDER 重建，少存一份就少
    # 一处可能过期的数据；解析时缺键 = 用默认顺序。
    if order != default_order(section_key):
        cleaned["order"] = list(order)
    if solo:
        cleaned["solo"] = list(solo)
    return cleaned


def _validate_entry(raw: object, section_key: str, baseline: dict) -> dict | None:
    """单条条目覆盖的规范化结果；与分区解析结果等价时返回 None（整条不落库）。

    `baseline` 是该分区的完整形状。判断"改过"用**生效值**而不是字面值：`gap` 省略与
    "恰好等于该对齐模式的兜底值"在纸面上完全一样，落库只会留下一条什么都没改变的记录。
    显式 `gap: null`（手改 JSON 才可能出现）按当前 align 的兜底值存成数值——域里不产生
    null，与其它键同口径。
    """
    if not isinstance(raw, dict):
        return None
    base_order = tuple(baseline.get("order") or ())
    base_solo = tuple(baseline.get("solo") or ())
    columns = _validated_columns(raw.get("columns")) if "columns" in raw else baseline["columns"]
    align = _validated_align(raw.get("align")) if "align" in raw else baseline["align"]
    # gap 的"生效值"：未设置 = 该对齐模式的兜底值（与渲染端同一条 `default_gap` 规则）。
    raw_gap = _validated_gap(raw.get("gap")) if "gap" in raw else baseline.get("gap")
    gap = float(default_gap(align)) if raw_gap is None else float(raw_gap)
    base_gap = baseline.get("gap")
    base_gap = float(default_gap(align)) if base_gap is None else float(base_gap)
    order = _validated_order(raw.get("order"), section_key) if "order" in raw else base_order
    if "solo" in raw:
        solo = _validated_solo(raw.get("solo"), order)
    else:
        solo = _validated_solo(list(base_solo), order)
    cleaned: dict = {}
    if columns != baseline.get("columns"):
        cleaned["columns"] = columns
    if align != baseline.get("align"):
        cleaned["align"] = align
    if abs(gap - base_gap) > 1e-9:
        cleaned["gap"] = gap
    if order != base_order:
        cleaned["order"] = list(order)
    # solo 比集合而不是序列：order 变化时同一组字段的先后可能跟着变，那不是"独占行改过"。
    if set(solo) != set(base_solo):
        cleaned["solo"] = list(solo)
    return cleaned or None


def _validate_entries(raw: object, section_key: str, baseline: dict) -> dict[str, dict]:
    """一个分区的条目级覆盖表：非法 id / 等价继承整条丢弃（返回已清理的 `{id: cfg}`）。"""
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, dict] = {}
    for entry_id, config in raw.items():
        # id 是拼进 CSS 类名的字符串（`field_layout_css`），只接受 W01 的字符集。
        if not isinstance(entry_id, str) or not OBJECT_ID_PATTERN.fullmatch(entry_id):
            continue
        patch = _validate_entry(config, section_key, baseline)
        if patch is not None:
            cleaned[entry_id] = patch
    return cleaned


def validate_field_layout_domain(raw: object) -> dict | None:
    """W4 白名单校验：返回可落库的域（含 version）或 None（空域 / 版本不支持）。

    与其它域同口径：未知段键 / 未知字段键**丢弃而不 422**（format_config 是用户可以
    随手改的 JSON）。列数越界**夹取**而不是丢弃：它是枚举语义，夹到最近的合法值对用户
    更友好，渲染端本来也必须防御非法列数。

    条目级（`entries.<分区>.<id>`）逐条清理：分区键必须 ∈ `FIELD_LAYOUT_SECTIONS`、id 必须
    匹配 `OBJECT_ID_PATTERN`，各键沿用分区级同一套校验；只保留显式改过的键。**条目级可以
    独立于分区级存在**（用户只调了"上海大学这一条"），这是本批次的核心诉求。
    """
    version = domain_version(raw)
    if not is_supported(FIELD_LAYOUT_DOMAIN, version):
        return None
    if not isinstance(raw, dict):
        return None
    raw_entries = raw.get(ENTRIES_KEY)
    entries_source = raw_entries if isinstance(raw_entries, dict) else None
    sections: dict[str, dict] = {}
    entries: dict[str, dict[str, dict]] = {}
    for section_key in FIELD_LAYOUT_SECTIONS:
        payload = _validate_section(raw.get(section_key), section_key)
        if payload is not None:
            sections[section_key] = payload
        entry_map = _validate_entries(
            entries_source.get(section_key) if entries_source is not None else None,
            section_key,
            _resolved_section(payload if payload is not None else {}, section_key),
        )
        if entry_map:
            entries[section_key] = entry_map
    if not sections and not entries:
        return None
    domain: dict = {"version": FIELD_LAYOUT_VERSION, **sections}
    if entries:
        domain[ENTRIES_KEY] = entries
    return domain


def _resolved_section(payload: dict, section_key: str) -> dict:
    """把落库的紧凑形状展开成渲染端可直接用的完整形状（order 全量、solo 为列表）。"""
    order = _validated_order(payload.get("order"), section_key)
    return {
        "columns": _validated_columns(payload.get("columns")),
        "align": _validated_align(payload.get("align")),
        "gap": _validated_gap(payload.get("gap")),
        "order": list(order),
        "solo": list(_validated_solo(payload.get("solo"), order)),
    }


def resolve_field_layout(format_config: dict | None) -> dict[str, dict]:
    """从 format_config 读 field_layout 域（已校验或原始形状都能吃，畸形输入按空域）。

    Returns:
        `{section_key: {"columns": int, "align": str, "gap": float | None,
        "order": list[str], "solo": list[str], "entries": {entry_id: {...}}}}`；
        `gap is None` = 未设置（渲染端按 align 的兜底值）。`entries` 只在**该分区有条目级
        覆盖时**出现（缺键 = 没有条目覆盖），值是**显式改过的键**；要用"这条实际生效的"
        配置请走 `merge_entry_layout`。空字典 = 没有配置（调用方走默认逐字段一行路径）。

    **只有条目级覆盖的分区也会出现在返回值里**（用默认分区形状兜住）：模板靠
    `field_layout.get(section_key)` 决定是否走 `.sub-row` 标记，不放进来条目级就永不生效。
    """
    if not isinstance(format_config, dict):
        return {}
    raw = format_config.get(FIELD_LAYOUT_DOMAIN)
    if not isinstance(raw, dict):
        return {}
    if not is_supported(FIELD_LAYOUT_DOMAIN, domain_version(raw)):
        return {}
    raw_entries = raw.get(ENTRIES_KEY)
    entries_source = raw_entries if isinstance(raw_entries, dict) else None
    resolved: dict[str, dict] = {}
    for section_key in FIELD_LAYOUT_SECTIONS:
        payload = _validate_section(raw.get(section_key), section_key)
        baseline = _resolved_section(payload if payload is not None else {}, section_key)
        entry_map = _validate_entries(
            entries_source.get(section_key) if entries_source is not None else None,
            section_key,
            baseline,
        )
        if payload is None and not entry_map:
            continue
        section = dict(baseline)
        if entry_map:
            section[ENTRIES_KEY] = entry_map
        resolved[section_key] = section
    return resolved


def merge_entry_layout(
    section_cfg: object, entry_cfg: object, section_key: str = ""
) -> dict | None:
    """把条目级覆盖叠到分区配置上，返回**完整形状**（columns / align / gap / order / solo）。

    `section_cfg` 是 `resolve_field_layout` 给的分区配置（可带 `entries` 附带信息，本函数
    只读 columns / align / gap / order / solo）；`entry_cfg` 是该条目的显式键。两者都空 →
    `None`（调用方走"每字段一行"的默认路径）。`section_key` 只用于在 `section_cfg` 为空时
    重建默认顺序（缺省空串时 order 为空 —— `_ordered_fields` 会把未列出的字段补在末尾，
    与全量默认顺序等价）。
    """
    has_section = isinstance(section_cfg, dict)
    entry = entry_cfg if isinstance(entry_cfg, dict) else None
    if not has_section and not entry:
        return None
    base = section_cfg if has_section else {}
    if has_section:
        order = list(_validated_order(base.get("order"), section_key))
        columns = _validated_columns(base.get("columns"))
        align = _validated_align(base.get("align"))
        gap = _validated_gap(base.get("gap"))
        solo = list(_validated_solo(base.get("solo"), tuple(order)))
    else:
        order = list(default_order(section_key))
        columns, align, gap, solo = DEFAULT_COLUMNS, DEFAULT_ALIGN, None, []
    if entry:
        if "columns" in entry:
            columns = _validated_columns(entry.get("columns"))
        if "align" in entry:
            align = _validated_align(entry.get("align"))
        if "gap" in entry:
            gap = _validated_gap(entry.get("gap"))
        if "order" in entry:
            order = list(_validated_order(entry.get("order"), section_key))
        if "solo" in entry:
            solo = list(_validated_solo(entry.get("solo"), tuple(order)))
    return {"columns": columns, "align": align, "gap": gap, "order": order, "solo": solo}


def field_layout_css(layout: dict | None) -> str:
    """HTML 侧共享样式：只有存在配置时才注入（默认产物一个字符都不多）。

    行容器沿用各模板既有的 `.entry .sub` 外观（字号 / 颜色 / 上下间距），这里只补布局。

    **等宽模式（`align == "equal"`）= 内容自适应列宽 + 每 entry 一个共享 grid**：
    列宽用 `repeat(var(--sub-cols), minmax(0, auto))`，并且**必须**配 `justify-content: start`
    ——grid 的"拉伸 auto 轨道"步骤会把剩余空间平均分给 `auto` 轨道（`justify-content`
    缺省值 `normal` 在 grid 里等价于 `stretch`），不写这一条 `auto` 就还是"每列占一半"，
    与 `minmax(0, 1fr)` 的观感几乎一样（实测：Chromium 下 595px 容器、两列内容各 ~128px，
    1.6→4.0 的可见间距只从 180.7px 变成 197.5px，仍然"几乎没动"）。加上之后 `auto` 轨道
    真正贴合内容，`column-gap` 就是**真实的列间距**：同一组数据实测 22.4px → 56px（+150%）。
    轨道最小值写 0（而不是裸 `auto` 的 min-content）：3 列 + 长文本时轨道总和可能超过容器
    宽度，`minmax(0, auto)` 让轨道能收缩、cell 内文字自己折行，不会横向溢出。
    跨行列宽一致靠**同一个 grid 容器**（模板里一个 entry 一个 `.sub-grid`，所有 cell 平铺
    进去）：每行各一个 grid 的话，列宽按各行内容各算，跨行又不对齐了。

    只剩一个 cell 的行（独占行 / 末行余一个）加 `.sub-cell-solo` 占满整行
    （`grid-column: 1 / -1`，grid 的自动放置因此换行），否则它会被挤在第一列、
    看起来像"内容偏左"。`align == "flow"` 保持改造前的 flex 顺排（想还原的用户）。

    列间距走**一个** `--sub-gap` 变量：基础规则里 flex 与 grid 两条 `column-gap` 各自带
    兜底（1.2 / 1.6 倍 `--fs`，即两种对齐模式的默认间距），用户调过的值由**分区级**规则
    `.sub-row.sub-gap-<section_key>` 覆盖变量，再由**条目级**规则
    `.sub-row.sub-gap-<section_key>-<entry_id>` 进一步覆盖（只对配了 gap 的那一条产出，模板把
    两个类名都挂在容器上）。分区级必须写在条目级**之前**：特异性都是 2 个类选择器，靠顺序定胜负。

    **两条 display 规则靠书写顺序分胜负**：两种模式的容器都带 `sub-row` 类，`.sub.sub-row`
    （flex）与 `.sub.sub-grid`（grid）特异性相同，所以 flex 规则必须写在前面、让 grid 覆盖它。

    注入安全：分区键只可能来自 `FIELD_LAYOUT_SECTIONS` 白名单，`gap` 已夹取到
    `[GAP_MIN, GAP_MAX]` 并转成 1 位小数；条目 id 的字符集由 W01 保证、校验层已把不合法的
    整条丢弃，这里再 `fullmatch` 兜一次——规则里不会出现用户可控的任意字符串。
    """
    if not layout:
        return ""
    rules = [
        # 按内容顺排（旧行为）：逐行 flex，`flex: 0 1 auto` 让 cell 宽度随内容浮动。
        ".sub.sub-row { display: flex; flex-wrap: wrap; align-items: start;"
        f" column-gap: var(--sub-gap, calc(var(--fs) * {DEFAULT_GAP_FLOW})); }}",
        ".sub-row .sub-cell { flex: 0 1 auto; min-width: 0; }",
        # 等宽分栏：共享 grid + 内容自适应列宽 → `column-gap` 就是真实的两列间距。
        # `justify-content: start` 不能省：缺省的 `normal` 在 grid 里会拉伸 `auto` 轨道，
        # 剩余空间被平摊进列宽，gap 就又淹没在"列内留白"里（详见本函数 docstring）。
        # 轨道写 `minmax(0, auto)` 而不是裸 `auto`：`auto` 的最小值是 min-content，3 列 +
        # 长文本时轨道总和可能超过容器宽度而横向溢出；`min(0)` 允许轨道收缩、cell 内文字
        # 自己折行。空间充足时 `max = auto` 仍是 max-content，贴合内容的效果完全一致。
        ".sub.sub-grid { display: grid; align-items: start; justify-content: start;"
        " grid-template-columns: repeat(var(--sub-cols, 1), minmax(0, auto));"
        f" column-gap: var(--sub-gap, calc(var(--fs) * {DEFAULT_GAP_EQUAL})); }}",
        ".sub-row.sub-cols-2 { --sub-cols: 2; }",
        ".sub-row.sub-cols-3 { --sub-cols: 3; }",
        ".sub-grid .sub-cell { min-width: 0; overflow-wrap: anywhere; }",
        ".sub-grid .sub-cell-solo { grid-column: 1 / -1; }",
    ]
    # 分区级间距：只有用户明确调过（gap 非 None）的分区才产出规则；未设置的分区走兜底。
    for section_key, config in layout.items():
        gap = config.get("gap") if isinstance(config, dict) else None
        if isinstance(gap, (int, float)) and not isinstance(gap, bool):
            rules.append(
                f".sub-row.sub-gap-{section_key} {{ --sub-gap: calc(var(--fs) * {gap}); }}"
            )
    # 条目级间距：写在**所有**分区级规则之后（同特异性靠顺序覆盖），只对配了 gap 的条目产出。
    for section_key, config in layout.items():
        entries = config.get(ENTRIES_KEY) if isinstance(config, dict) else None
        if not isinstance(entries, dict):
            continue
        for entry_id, entry_cfg in entries.items():
            gap = entry_cfg.get("gap") if isinstance(entry_cfg, dict) else None
            if not isinstance(gap, (int, float)) or isinstance(gap, bool):
                continue
            if not isinstance(entry_id, str) or not OBJECT_ID_PATTERN.fullmatch(entry_id):
                continue
            rules.append(
                f".sub-row.sub-gap-{section_key}-{entry_id}"
                f" {{ --sub-gap: calc(var(--fs) * {gap}); }}"
            )
    return "\n".join(rules)


__all__ = [
    "DEFAULT_ALIGN",
    "DEFAULT_COLUMNS",
    "DEFAULT_GAP_EQUAL",
    "DEFAULT_GAP_FLOW",
    "ENTRIES_KEY",
    "FIELD_LAYOUT_ALIGNS",
    "FIELD_LAYOUT_DOMAIN",
    "FIELD_LAYOUT_SECTIONS",
    "FIELD_LAYOUT_VERSION",
    "GAP_MAX",
    "GAP_MIN",
    "LEGACY_GAP_VALUES",
    "MAX_COLUMNS",
    "ROW_SEPARATOR",
    "default_gap",
    "default_order",
    "field_layout_css",
    "merge_entry_layout",
    "resolve_field_layout",
    "validate_field_layout_domain",
]
