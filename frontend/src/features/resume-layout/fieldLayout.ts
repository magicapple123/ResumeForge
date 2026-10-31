// SPDX-License-Identifier: Apache-2.0
/**
 * W4「条目字段排版」的**数据层**（纯函数，无 React）：`format_config.field_layout` 的读写与归一化。
 *
 * 为什么与面板拆开：面板需要导出常量/纯函数给测试用，而 React Fast Refresh 要求
 * `*.tsx` 只导出组件（`react-refresh/only-export-components`）。口径本身也不依赖渲染——
 * 后端 `resume_field_layout.py` 校验、四个渲染器装箱用的是同一套字段顺序与列数语义。
 *
 * 数据边界：
 * - 只写 `format_config.field_layout`，走既有 `withFormatDomain`（空域自动删键，R3）；
 * - 读侧做一次归一化：未知字段丢弃、未列出的补齐到末尾（与后端校验口径一致）；
 * - 列间距 `gap` 存**字号倍数**（0–30，1 位小数），不是像素——改字号 / 换模板后按比例
 *   跟随；`null` = 未设置，两种对齐模式各有兜底（equal 1.6 / flow 1.2），等于兜底时不落库；
 *   **`0` 是合法值**（两列完全紧挨），与 `null` 严格区分：全部判断都用 `=== null` / 数值比较，
 *   不用真值判断（`if (gap)` 会把 0 当成"没设置"，用户选"紧挨"就退回 1.6 兜底）；
 * - **条目级覆盖**（`entries.<分区>.<稳定 id>`）：单条条目可以有自己的列数 / 对齐 / 间距 /
 *   顺序 / 独占行，没写到的键继承分区默认；与分区默认等价时不落库（`entryPatchFromEffective`）；
 * - 全默认的分区视为"未配置"，不写空域（默认逐字段一行，产物零变化）。
 */
import { readFormatDomain, withFormatDomain } from "./formatDomains";
import type { MessageKey } from "../../i18n";
import type { ResumeLayout } from "../../types";
import {
  DEFAULT_META_POSITION,
  normalizeMetaPosition,
  storedEntryPatch,
} from "./fieldMetaPosition";
import type { FieldMetaPosition } from "./fieldMetaPosition";
import { FIELD_LABEL_KEYS, FIELD_LAYOUT_FIELDS } from "./fieldLayoutLabels";

export {
  DEFAULT_META_POSITION,
  FIELD_META_POSITIONS,
  META_POSITION_LABEL_KEYS,
} from "./fieldMetaPosition";
export type { FieldMetaPosition } from "./fieldMetaPosition";
export {
  ALIGN_LABEL_KEYS,
  COLUMN_LABEL_KEYS,
  FIELD_LABEL_KEYS,
  FIELD_LAYOUT_FIELDS,
  SECTION_LABEL_KEYS,
} from "./fieldLayoutLabels";
/** 允许调整字段排版的七个分区（与后端 `FIELD_LAYOUT_SECTIONS` 逐字一致）。 */
export const FIELD_LAYOUT_SECTIONS = [
  "education",
  "experience",
  "campus_experience",
  "projects",
  "awards",
  "publications",
  "research_projects",
] as const;

export type FieldLayoutSection = (typeof FIELD_LAYOUT_SECTIONS)[number];
export type FieldLayoutColumns = 1 | 2 | 3;

/**
 * 列内对齐方式（与后端 `FIELD_LAYOUT_ALIGNS` 逐字一致）。
 *
 * - `equal`：等宽分栏（一个 entry 一个共享 CSS Grid，列宽内容自适应），同一个 grid 内
 *   跨行第 2 列起点相同 → 跨行对齐，且 `column-gap` 就是真实的两列间距；
 * - `flow`：按内容顺排（改造前的 flex 行为），列宽随内容长短浮动。
 */
export type FieldLayoutAlign = "equal" | "flow";

/**
 * 列间距范围（字号倍数，与后端 `GAP_MIN` / `GAP_MAX` 一致；0 = 两列完全紧挨、30 = 30 个
 * 字号的空隙，双列时几乎把两栏推到纸边）。步长 0.5：0–30 的区间用 0.1 拖动太细。
 */
export const GAP_MIN = 0;
export const GAP_MAX = 30;
/**
 * 滑杆步长 0.2：0–30 的区间用 0.1 有 300 档、拖起来太细；但步长必须是 0.4 的约数
 * （gcd(1.6, 1.2) = 0.4），否则两种对齐模式的**兜底值 1.6 / 1.2 会落在栅格外**——rc-slider
 * 会把受控值量化到最近的步进点，用户什么都没拖就看到"1.5 / 1.0"，与配置不符。
 */
export const GAP_STEP = 0.2;
/** 两种对齐模式各自的兜底间距（与后端 `DEFAULT_GAP_EQUAL` / `DEFAULT_GAP_FLOW` 一致）。 */
export const DEFAULT_GAP_EQUAL = 1.6;
export const DEFAULT_GAP_FLOW = 1.2;
/** 旧版字符串枚举 → 倍数（`normal` 不在表里 = 未设置，走兜底）。 */
export const LEGACY_GAP_VALUES: Record<string, number> = { narrow: 0.8, wide: 3 };

export const FIELD_LAYOUT_ALIGNS: readonly FieldLayoutAlign[] = ["equal", "flow"];

export const DEFAULT_FIELD_LAYOUT_ALIGN: FieldLayoutAlign = "equal";

/** 该对齐模式的兜底列间距：flow 用 1.2（改造前观感），equal 用 1.6。 */
export function defaultGapFor(align: FieldLayoutAlign): number {
  return align === "flow" ? DEFAULT_GAP_FLOW : DEFAULT_GAP_EQUAL;
}

/** 一个分区的排版设置：列数 + 对齐方式 + 列间距 + 全量字段顺序 + 独占行字段。 */
export interface SectionFieldLayout {
  columns: FieldLayoutColumns;
  align: FieldLayoutAlign;
  /** 字号倍数；`null` = 未设置（渲染端按 align 的兜底值，两种模式不同）。 */
  gap: number | null;
  /** 补充字段相对正文的位置（below 默认 / above 置顶）。 */
  metaPosition: FieldMetaPosition;
  order: string[];
  solo: string[];
  /** 不在纸面上显示的字段（数据保留；渲染端过滤，AI 回填照常写内容）。 */
  hidden: string[];
}

export type FieldLayoutMap = Partial<Record<FieldLayoutSection, SectionFieldLayout>>;

/**
 * **条目级**覆盖：只含"相对分区默认改过"的键（`entries.<分区>.<id>`）。
 *
 * 条目 id 是 W01 稳定身份（`[A-Za-z0-9_-]{8,32}`，只在**同一数组内**唯一，跨分区可重复），
 * 所以存储必须是两层（分区 → id → 覆盖），不能拍平成一层的 id 键。
 * 没写到的键继承分区默认——这也是"只存显式改过的键"的原因：少存一份就少一处会过期的数据。
 */
export interface EntryFieldLayoutPatch {
  columns?: FieldLayoutColumns;
  align?: FieldLayoutAlign;
  gap?: number;
  metaPosition?: FieldMetaPosition;
  order?: string[];
  solo?: string[];
  hidden?: string[];
}

/** 条目级覆盖表：`{分区: {条目 id: 覆盖}}`（没有覆盖的分区缺键）。 */
export type EntryFieldLayoutMap = Partial<
  Record<FieldLayoutSection, Record<string, EntryFieldLayoutPatch>>
>;

/** 落库形状（域内每个分区一个对象；与默认相同的键不写）。 */
interface StoredSectionFieldLayout {
  columns?: number;
  align?: FieldLayoutAlign;
  gap?: number;
  meta_position?: FieldMetaPosition;
  order?: string[];
  solo?: string[];
  hidden?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function clampColumns(raw: unknown): FieldLayoutColumns {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(Math.trunc(raw), 3)) as FieldLayoutColumns;
}

/** 未知 / 非字符串的对齐方式落回 `equal`（与后端 `_validated_align` 同口径）。 */
function normalizeAlign(raw: unknown): FieldLayoutAlign {
  return raw === "flow" ? "flow" : DEFAULT_FIELD_LAYOUT_ALIGN;
}

/**
 * 列间距归一成字号倍数（1 位小数）；`null` = 未设置（渲染端按 align 的兜底值）。
 *
 * 与后端 `_validated_gap` 同口径：布尔 / 非数字 / NaN → `null`；字符串查
 * `LEGACY_GAP_VALUES`（`narrow`→0.8、`wide`→3；`normal` 与未知串 → `null`）；
 * 数值夹取到 `[GAP_MIN, GAP_MAX]` 后保留 1 位小数，**`0` 原样返回**（合法值 = 完全紧挨，
 * 不是"未设置"；`-1` 夹到下限 0，不是夹到旧下限 0.2）。
 */
export function normalizeGap(raw: unknown): number | null {
  if (typeof raw === "string") return LEGACY_GAP_VALUES[raw] ?? null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const clamped = Math.max(GAP_MIN, Math.min(raw, GAP_MAX));
  return Math.round(clamped * 10) / 10;
}

/** `gap` 与当前 align 的兜底值一致（= 未设置语义）；浮点比较留与后端同量级的容差。 */
function gapIsDefault(gap: number | null, align: FieldLayoutAlign): boolean {
  return gap === null || Math.abs(gap - defaultGapFor(align)) < 1e-6;
}

/** 该分区没有任何自定义（列数 1、等宽对齐、兜底间距、默认顺序、无独占行）。 */
export function isSectionDefault(section: FieldLayoutSection, config: SectionFieldLayout): boolean {
  return (
    config.columns === 1 &&
    config.align === DEFAULT_FIELD_LAYOUT_ALIGN &&
    gapIsDefault(config.gap, config.align) &&
    config.metaPosition === DEFAULT_META_POSITION &&
    config.solo.length === 0 &&
    config.hidden.length === 0 &&
    sameOrder(config.order, FIELD_LAYOUT_FIELDS[section])
  );
}

export function defaultSectionLayout(section: FieldLayoutSection): SectionFieldLayout {
  return {
    columns: 1,
    align: DEFAULT_FIELD_LAYOUT_ALIGN,
    gap: null,
    metaPosition: DEFAULT_META_POSITION,
    order: [...FIELD_LAYOUT_FIELDS[section]],
    solo: [],
    hidden: [],
  };
}

/** 读侧归一化：未知/重复字段丢弃，未列出的按默认顺序补末尾，solo 收敛为 order 子集。 */
export function normalizeSectionLayout(
  section: FieldLayoutSection,
  raw: unknown,
): SectionFieldLayout {
  if (!isRecord(raw)) return defaultSectionLayout(section);
  const defaults = FIELD_LAYOUT_FIELDS[section];
  const order: string[] = [];
  for (const item of Array.isArray(raw.order) ? raw.order : []) {
    if (typeof item === "string" && defaults.includes(item) && !order.includes(item)) {
      order.push(item);
    }
  }
  for (const field of defaults) {
    if (!order.includes(field)) order.push(field);
  }
  const rawSolo = Array.isArray(raw.solo) ? raw.solo : [];
  const solo = order.filter((field) => rawSolo.some((item) => item === field));
  const rawHidden = Array.isArray(raw.hidden) ? raw.hidden : [];
  const hidden = order.filter((field) => rawHidden.some((item) => item === field));
  return {
    columns: clampColumns(raw.columns),
    align: normalizeAlign(raw.align),
    gap: normalizeGap(raw.gap),
    metaPosition: normalizeMetaPosition(raw.meta_position),
    order,
    solo,
    hidden,
  };
}

/** 读当前配置：只返回**有自定义**的分区（全默认的分区视为未配置）。 */
export function readFieldLayout(
  layout: Pick<ResumeLayout, "format_config"> | null | undefined,
): FieldLayoutMap {
  const domain = readFormatDomain(layout?.format_config, "field_layout");
  if (!domain) return {};
  const result: FieldLayoutMap = {};
  for (const section of FIELD_LAYOUT_SECTIONS) {
    const raw = domain[section];
    if (!isRecord(raw)) continue;
    const normalized = normalizeSectionLayout(section, raw);
    if (!isSectionDefault(section, normalized)) result[section] = normalized;
  }
  return result;
}

/**
 * 写入一个分区的设置（`null` = 恢复默认），返回**新的** ResumeLayout。
 *
 * 目录为空时 `withFormatDomain(null)` 会删掉整个域（R3：空域不落库）——所以"恢复默认"
 * 最终确实回到"从未设置"的产物（默认逐字段一行）。**条目级覆盖原样保留**：分区 reset
 * 是"整栏回到默认"，不该顺手清掉用户给某一条单独设的排版。
 */
export function withSectionFieldLayout(
  layout: ResumeLayout,
  section: FieldLayoutSection,
  next: SectionFieldLayout | null,
): ResumeLayout {
  const current = readFieldLayout(layout);
  if (next === null || isSectionDefault(section, next)) {
    delete current[section];
  } else {
    current[section] = next;
  }
  return writeFieldLayout(layout, current, readEntryFieldLayout(layout));
}

/** 一个分区 → 落库形状（只写与默认不同的键）。 */
function storedSection(
  section: FieldLayoutSection,
  config: SectionFieldLayout,
): StoredSectionFieldLayout {
  const entry: StoredSectionFieldLayout = { columns: config.columns };
  // align / gap / meta_position 与 order 同口径：只有非默认才写，默认值永远能从常量重建。
  if (config.align !== DEFAULT_FIELD_LAYOUT_ALIGN) entry.align = config.align;
  if (config.metaPosition !== DEFAULT_META_POSITION) entry.meta_position = config.metaPosition;
  // gap 的"默认"取决于当前 align（equal 1.6 / flow 1.2），所以判据不是固定常数；
  // 写入前再归一一次：滑杆的浮点步进（1.6+0.1）会带出 1.7000000000000002 这类噪声，
  // 落库必须是干净的 1 位小数（与后端 round(…, 1) 同口径）。
  const gap = config.gap === null ? null : normalizeGap(config.gap);
  if (gap !== null && !gapIsDefault(gap, config.align)) entry.gap = gap;
  if (!sameOrder(config.order, FIELD_LAYOUT_FIELDS[section])) entry.order = config.order;
  if (config.solo.length > 0) entry.solo = config.solo;
  if (config.hidden.length > 0) entry.hidden = config.hidden;
  return entry;
}

/**
 * 把"分区级 + 条目级"两份合成一个域写回（`field_layout` 的唯一写入口）。
 *
 * 必须一次写整个域：`withFormatDomain` 是整域替换，分区与条目各写一次会互相覆盖。
 * 两段都空 → `null` → 删域（R3）。
 */
function writeFieldLayout(
  layout: ResumeLayout,
  sections: FieldLayoutMap,
  entries: EntryFieldLayoutMap,
): ResumeLayout {
  const stored: Record<string, unknown> = {};
  for (const key of FIELD_LAYOUT_SECTIONS) {
    const config = sections[key];
    if (config) stored[key] = storedSection(key, config);
  }
  const storedEntries: Record<string, Record<string, EntryFieldLayoutPatch>> = {};
  for (const key of FIELD_LAYOUT_SECTIONS) {
    const map = entries[key];
    if (!map) continue;
    const patches: Record<string, EntryFieldLayoutPatch> = {};
    for (const [entryId, patch] of Object.entries(map)) {
      if (entryId && Object.keys(patch).length > 0) patches[entryId] = storedEntryPatch(patch);
    }
    if (Object.keys(patches).length > 0) storedEntries[key] = patches;
  }
  // 空段不落库：没有任何条目覆盖时连 `entries` 这个键都不出现（与后端同口径）。
  if (Object.keys(storedEntries).length > 0) stored["entries"] = storedEntries;
  const domain = Object.keys(stored).length > 0 ? stored : null;
  return {
    ...layout,
    format_config: withFormatDomain(layout.format_config, "field_layout", domain),
  };
}

/** 条目覆盖的读侧归一化：非法形状丢弃，order 补全量、solo 收敛为 order 子集。 */
function normalizeEntryPatch(
  section: FieldLayoutSection,
  raw: unknown,
): EntryFieldLayoutPatch | null {
  if (!isRecord(raw)) return null;
  const normalized = normalizeSectionLayout(section, raw);
  const patch: EntryFieldLayoutPatch = {};
  if ("columns" in raw) patch.columns = normalized.columns;
  if ("align" in raw) patch.align = normalized.align;
  if ("gap" in raw) {
    const gap = normalizeGap(raw.gap);
    if (gap !== null) patch.gap = gap;
  }
  if ("meta_position" in raw) patch.metaPosition = normalized.metaPosition;
  if ("order" in raw) patch.order = normalized.order;
  if ("solo" in raw) patch.solo = normalized.solo;
  if ("hidden" in raw) patch.hidden = normalized.hidden;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** 读条目级覆盖：`{分区: {条目 id: 覆盖}}`（只返回真的有键的那些，非法形状丢弃）。 */
export function readEntryFieldLayout(
  layout: Pick<ResumeLayout, "format_config"> | null | undefined,
): EntryFieldLayoutMap {
  const domain = readFormatDomain(layout?.format_config, "field_layout");
  const raw = domain?.["entries"];
  if (!isRecord(raw)) return {};
  const result: EntryFieldLayoutMap = {};
  for (const section of FIELD_LAYOUT_SECTIONS) {
    const sectionRaw = raw[section];
    if (!isRecord(sectionRaw)) continue;
    const patches: Record<string, EntryFieldLayoutPatch> = {};
    for (const [entryId, value] of Object.entries(sectionRaw)) {
      const patch = normalizeEntryPatch(section, value);
      if (patch) patches[entryId] = patch;
    }
    if (Object.keys(patches).length > 0) result[section] = patches;
  }
  return result;
}

/**
 * 写入一条条目的覆盖（`null` = 恢复继承），返回**新的** ResumeLayout。
 *
 * 只动 `entries.<分区>.<id>`，分区级一个字节都不碰；覆盖被清空（或空 patch）时该条
 * 整条删掉，`entries.<分区>` 与 `entries` 依次自动消失（空段不落库）。
 */
export function withEntryFieldLayout(
  layout: ResumeLayout,
  section: FieldLayoutSection,
  entryId: string,
  patch: EntryFieldLayoutPatch | null,
): ResumeLayout {
  const entries = readEntryFieldLayout(layout);
  const sectionEntries: Record<string, EntryFieldLayoutPatch> = { ...(entries[section] ?? {}) };
  if (patch === null || Object.keys(patch).length === 0) {
    delete sectionEntries[entryId];
  } else {
    sectionEntries[entryId] = patch;
  }
  if (Object.keys(sectionEntries).length > 0) {
    entries[section] = sectionEntries;
  } else {
    delete entries[section];
  }
  return writeFieldLayout(layout, readFieldLayout(layout), entries);
}

/**
 * 某条条目**实际生效**的配置（分区默认 ← 条目覆盖），面板展示用。
 *
 * 与后端 `merge_entry_layout` 同一套语义：`undefined` 的键继承 base（`gap` 用
 * `patch.gap ?? base.gap`，`null` 同样表示"未设置、走兜底"）。
 */
export function effectiveSectionLayout(
  section: FieldLayoutSection,
  base: SectionFieldLayout,
  patch?: EntryFieldLayoutPatch | null,
): SectionFieldLayout {
  if (!patch) return base;
  const order =
    patch.order && patch.order.length > 0
      ? normalizeSectionLayout(section, { order: patch.order }).order
      : [...base.order];
  const wanted = patch.solo ?? base.solo;
  const hiddenWanted = patch.hidden ?? base.hidden;
  return {
    columns: patch.columns ?? base.columns,
    align: patch.align ?? base.align,
    gap: patch.gap ?? base.gap,
    metaPosition: patch.metaPosition ?? base.metaPosition,
    order,
    solo: order.filter((field) => wanted.includes(field)),
    hidden: order.filter((field) => hiddenWanted.includes(field)),
  };
}

function sameFieldSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((field) => right.includes(field));
}

/**
 * 由"这条实际生效的配置"反推**最小覆盖**：只保留与分区默认不同的键。
 *
 * 改回与分区默认一致时返回 `null`（= 该条不再需要覆盖），这样"调回原样"不会在库里留下
 * 一条什么都不改的记录，与后端"等价继承整条丢弃"的校验口径一致。
 */
export function entryPatchFromEffective(
  base: SectionFieldLayout,
  effective: SectionFieldLayout,
): EntryFieldLayoutPatch | null {
  const patch: EntryFieldLayoutPatch = {};
  if (effective.columns !== base.columns) patch.columns = effective.columns;
  if (effective.align !== base.align) patch.align = effective.align;
  if (effective.metaPosition !== base.metaPosition) patch.metaPosition = effective.metaPosition;
  // 判"间距改过"用生效值：省略与"恰好等于该对齐模式的兜底值"在纸面上完全一样。
  const fallback = defaultGapFor(effective.align);
  const baseGap = base.gap ?? fallback;
  const nextGap = effective.gap ?? fallback;
  if (Math.abs(baseGap - nextGap) > 1e-6) {
    const gap = normalizeGap(nextGap);
    if (gap !== null) patch.gap = gap;
  }
  if (!sameOrder(effective.order, base.order)) patch.order = [...effective.order];
  if (!sameFieldSet(effective.solo, base.solo)) patch.solo = [...effective.solo];
  if (!sameFieldSet(effective.hidden, base.hidden)) patch.hidden = [...effective.hidden];
  return Object.keys(patch).length > 0 ? patch : null;
}

/** 字段上移/下移一格（越界返回原顺序，调用方已按边界禁用按钮）。 */
export function moveField(order: readonly string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function fieldLabelKey(section: FieldLayoutSection, field: string): MessageKey {
  return FIELD_LABEL_KEYS[`${section}:${field}`] ?? "editor.field.summary";
}
