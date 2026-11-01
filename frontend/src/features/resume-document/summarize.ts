// SPDX-License-Identifier: Apache-2.0
/**
 * 结构视图的树（纯函数）：页/栏提示 → 板块 → 条目 → 位置分组 → item。
 *
 * **不做 i18n**：label 返回文档里的原始数据（板块标题 / 条目标题 / 字段 key / 位置枚举值），
 * 由组件用 `t()` 映射位置名与兜底文案。理由与 `fieldLayout` 一致——纯函数里拿不到语言，
 * 传一个 locale 参数又会让"同一份文档在不同语言下树结构相同"这条性质变得难测。
 */
import type {
  HeaderItem,
  HeaderPlacement,
  Placement,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
} from "../../types/resumeDocument";
import { getItemPlacement } from "./placement";

export type StructureNodeKind = "header-entry" | "section" | "entry" | "group" | "item";

export type StructureSource = "profile" | "manual";

/** 树节点：结构面板渲染与键盘导航都只读它。 */
export interface StructureNode {
  kind: StructureNodeKind;
  /** React key；同一份文档里唯一。 */
  key: string;
  /** 点击定位用的文档路径；分组节点为 null。 */
  path: string | null;
  /** 原始展示文本（位置分组给的是 placement 枚举值，由组件 t() 映射）。 */
  label: string;
  sectionKey?: string;
  entryId?: string;
  itemId?: string;
  placement?: Placement;
  headerPlacement?: HeaderPlacement;
  source?: StructureSource;
  hidden?: boolean;
  lock?: "content" | "layout" | null;
  itemKind?: ResumeItem["kind"];
  /**
   * item 的原始字段 key（Q20）：树行有值时不显示 key，只在目录/值都拿不到时兜底，
   * 或作为行上的 Tooltip 说明"这一行是哪个字段"。
   */
  itemKey?: string;
  /** 字段名的本地化显示（目录 label 优先，其次用户 label，最后 key）；行 Tooltip 用它，避免露出英文 key。 */
  fieldLabel?: string;
  /** 条目级断页（Q08）：结构树据此给条目行显示标记。 */
  startOnNewPage?: boolean;
  keepTogether?: boolean;
  children?: StructureNode[];
}

export interface StructureTree {
  header: StructureNode[];
  sections: StructureNode[];
}

/** 结构面板里位置分组的固定顺序（与用户手册的六个位置一一对应）。 */
export const STRUCTURE_PLACEMENT_ORDER: readonly Placement[] = [
  "title",
  "meta",
  "lead",
  "body",
  "trail",
  "hidden",
];

/** 页眉位置分组顺序。 */
export const STRUCTURE_HEADER_PLACEMENT_ORDER: readonly HeaderPlacement[] = [
  "name",
  "name_meta",
  "subtitle",
  "contact",
  "photo",
  "hidden",
];

/**
 * 页眉合成后的**唯一**分组键（R-09）：树里只有一行「基本信息」，`label` 也用它。
 *
 * 用常量而不是字面量：这是**协议值**（组件按它判定分组、搜索按它取显示文案），
 * 不是界面文案——界面文案是 `structure.node.header`（「基本信息」/「Basic information」）。
 */
export const HEADER_GROUP_KEY = "header";

/** 树行/下拉的条目名截断上限（按字符数，中文与 emoji 各算一个）。 */
export const ENTRY_LABEL_MAX_CHARS = 32;

/** 按字符截断并补省略号（`Array.from` 计数，避免代理对被算成 2 个）。 */
export function truncateLabel(value: string, max = ENTRY_LABEL_MAX_CHARS): string {
  const chars = Array.from(value.trim());
  if (chars.length <= max) return value.trim();
  return chars.slice(0, max - 1).join("") + "…";
}

/** item 的纯文本值（列表/作者各拼一行；字段直接取 value）。 */
function itemPlainValue(item: ResumeItem): string {
  switch (item.kind) {
    case "field":
      return item.value.trim();
    case "list":
      return item.values
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\u3001");
    case "authors":
      return item.authors
        .map((author) => author.name.trim())
        .filter(Boolean)
        .join(", ");
    case "text":
      return item.text.trim();
    default:
      return "";
  }
}

/**
 * 条目显示名（Q08 单一来源）：标题行字段值 → 首个非空正文/灰字/文本值截断。
 *
 * 结构树、分页面板、条目字段排版共用同一个函数——三处各拼一份时，同一份文档在
 * 三个面板里会显示成不同的名字（"未命名条目 3" vs 标题值 vs 正文首句）。
 */
export function entryDisplayLabel(entry: ResumeEntry): string {
  const title = entry.items
    .filter((item) => getItemPlacement(item) === "title")
    .map(itemPlainValue)
    .filter(Boolean)
    .join(" · ");
  // A title item is the entry label itself; truncation only applies to the body fallback.
  if (title) return title;
  for (const item of entry.items) {
    const placement = getItemPlacement(item);
    if (placement !== "body" && placement !== "lead" && placement !== "trail") continue;
    const value = itemPlainValue(item);
    if (value) return truncateLabel(value);
  }
  return "";
}

/**
 * 树行显示名：有值显示值；没有值才用字段目录标签兜底，目录也拿不到时才显示原始 key。
 *
 * resolver 由组件用 `DocumentFieldCatalog` 构造（纯函数层不 import 组件状态）。
 */
export type FieldLabelResolver = (key: string, sectionKey?: string) => string | undefined;

/** #11a：枚举字段值的显示名解析（sectionKey + fieldKey + 原值 → 本地化标签或原值）。 */
export type EnumValueResolver = (sectionKey: string, fieldKey: string, value: string) => string;

function itemLabel(
  item: ResumeItem,
  sectionKey: string,
  resolveLabel?: FieldLabelResolver,
  resolveEnumValue?: EnumValueResolver,
): string {
  if (item.kind === "text") return item.text;
  const catalogLabel = resolveLabel?.(item.key, sectionKey) ?? "";
  if (item.kind === "field") {
    // #11a：枚举字段显示本地化标签（与 chip 同源），没有匹配再落回原值。
    const value =
      item.format === "enum" && resolveEnumValue
        ? resolveEnumValue(sectionKey, item.key, item.value)
        : item.value;
    return item.label || value || catalogLabel || item.key;
  }
  return item.label || catalogLabel || item.key;
}

function itemNode(
  item: ResumeItem,
  sectionKey: string,
  entryId: string,
  resolveLabel?: FieldLabelResolver,
  resolveEnumValue?: EnumValueResolver,
): StructureNode {
  const placement = getItemPlacement(item);
  return {
    kind: "item",
    key: `${sectionKey}.${entryId}.${item.id}`,
    path: `${sectionKey}.${entryId}.${item.id}`,
    label: itemLabel(item, sectionKey, resolveLabel, resolveEnumValue),
    sectionKey,
    entryId,
    itemId: item.id,
    placement,
    source: item.kind === "field" && item.source ? "profile" : "manual",
    hidden: placement === "hidden",
    lock: null,
    itemKind: item.kind,
    itemKey: item.kind === "text" ? undefined : item.key,
    fieldLabel:
      item.kind === "text"
        ? undefined
        : item.label || resolveLabel?.(item.key, sectionKey) || item.key,
    children: [],
  };
}

function groupNodes(
  entry: ResumeEntry,
  sectionKey: string,
  entryId: string,
  options: { includeEmptyGroups: boolean },
  resolveLabel?: FieldLabelResolver,
  resolveEnumValue?: EnumValueResolver,
): StructureNode[] {
  const byPlacement = new Map<Placement, ResumeItem[]>();
  for (const placement of STRUCTURE_PLACEMENT_ORDER) byPlacement.set(placement, []);
  for (const item of entry.items) {
    const placement = getItemPlacement(item);
    (byPlacement.get(placement) ?? byPlacement.get("trail") ?? []).push(item);
  }
  return STRUCTURE_PLACEMENT_ORDER.flatMap((placement) => {
    const items = byPlacement.get(placement) ?? [];
    if (items.length === 0 && !options.includeEmptyGroups) return [];
    return [
      {
        kind: "group",
        key: `${sectionKey}.${entryId}.#${placement}`,
        path: null,
        label: placement,
        placement,
        children: items.map((item) =>
          itemNode(item, sectionKey, entryId, resolveLabel, resolveEnumValue),
        ),
      },
    ];
  });
}

/**
 * 分组节点：`key` 与原始 `label` 同值（label 是**协议键**，界面文案由组件用 t() 映射）。
 *
 * 单独抽出来还有一层原因：`label: "<字面量>"` 会被 i18n 的 product-copy 守卫判成
 * 新增界面文案（`label` 在 COPY_PROPERTIES 里）。走参数传值，那个位置就不是字面量。
 */
function groupNode(key: string, children: StructureNode[]): StructureNode {
  return { kind: "group", key, path: null, label: key, children };
}

function entryNode(
  entry: ResumeEntry,
  sectionKey: string,
  index: number,
  options: { includeEmptyGroups: boolean },
  resolveLabel?: FieldLabelResolver,
  resolveEnumValue?: EnumValueResolver,
): StructureNode {
  const entryId = entry.id ?? String(index);
  return {
    kind: "entry",
    key: `${sectionKey}.${entryId}`,
    path: entry.id ? `${sectionKey}.${entryId}` : null,
    label: entryDisplayLabel(entry),
    sectionKey,
    entryId,
    hidden: entry.hidden,
    lock: entry.lock_content ? "content" : entry.lock_layout ? "layout" : null,
    startOnNewPage: Boolean(entry.layout.start_on_new_page),
    keepTogether: Boolean(entry.layout.keep_together),
    children: groupNodes(entry, sectionKey, entryId, options, resolveLabel, resolveEnumValue),
  };
}

function sectionNode(
  section: ResumeSection,
  options: { includeEmptyGroups: boolean },
  resolveLabel?: FieldLabelResolver,
  resolveEnumValue?: EnumValueResolver,
): StructureNode {
  return {
    kind: "section",
    key: section.key,
    path: section.key,
    label: section.layout.title_override || section.title || section.key,
    sectionKey: section.key,
    children: section.entries.map((entry, index) =>
      entryNode(entry, section.key, index, options, resolveLabel, resolveEnumValue),
    ),
  };
}

function headerNode(item: HeaderItem, resolveLabel?: FieldLabelResolver): StructureNode {
  const catalogLabel = resolveLabel?.(item.key) ?? "";
  // 照片的值是 data URL：树行绝不能把 base64 当 label（Q20/Q23 同源问题）。
  const binaryValue = item.key === "photo" || item.value.startsWith("data:");
  return {
    kind: "item",
    key: `header.${item.id}`,
    path: `header.${item.id}`,
    label: binaryValue
      ? item.label || catalogLabel || item.key
      : item.label || item.value || catalogLabel || item.key,
    placement: undefined,
    headerPlacement: item.placement,
    itemId: item.id,
    hidden: item.placement === "hidden",
    lock: null,
    itemKind: "field",
    itemKey: item.key,
    fieldLabel: item.label || catalogLabel || item.key,
    children: [],
  };
}

export interface SummarizeOptions {
  /** 是否输出没有内容的 placement 分组（结构面板默认不输出）。 */
  includeEmptyGroups?: boolean;
  /** 是否包含页眉（基本信息）树；默认包含。 */
  includeHeader?: boolean;
  /**
   * 字段目录标签解析（Q20）：item 没有值/没有显式 label 时，用目录里的中文标签
   * 代替原始英文 key；目录拿不到才退回 key。
   */
  resolveFieldLabel?: FieldLabelResolver;
  /** #11a：枚举字段值的显示名解析（工作类型等四类枚举不再裸显 code）。 */
  resolveEnumValue?: EnumValueResolver;
}

/**
 * 生成结构树。
 *
 * - 板块 → 条目 → 位置分组（非空才输出）→ item；
 * - 页眉是**一个**「基本信息」分组（key = `header`），子节点按页眉位置顺序平铺；
 * - 条目/条目字段的隐藏与锁定标记都带上（结构面板的圆点 / 锁图标）。
 */
export function summarize(document: ResumeDocument, options: SummarizeOptions = {}): StructureTree {
  const settings = {
    includeEmptyGroups: options.includeEmptyGroups === true,
    includeHeader: options.includeHeader !== false,
    resolveFieldLabel: options.resolveFieldLabel,
    resolveEnumValue: options.resolveEnumValue,
  };
  const header: StructureNode[] = [];
  if (settings.includeHeader) {
    // R-09：页眉不再按位置拆成「姓名行 / 联系方式 / 照片 …」多个分组，而是合成**一个**
    // 「基本信息」分组，子节点按纸面顺序（STRUCTURE_HEADER_PLACEMENT_ORDER）平铺。
    // 位置枚举仍是排序依据（也仍写在每个 item 的 headerPlacement 上，供搜索与徽标判定）。
    const orderIndex = new Map<HeaderPlacement, number>(
      STRUCTURE_HEADER_PLACEMENT_ORDER.map((placement, position) => [placement, position]),
    );
    // 未知位置（未来新增枚举 / 旧文档）落在「隐藏」之后，而不是被丢掉。
    const rankOf = (placement: HeaderPlacement): number =>
      orderIndex.get(placement) ?? STRUCTURE_HEADER_PLACEMENT_ORDER.length;
    // `Array.prototype.sort` 自 ES2019 起稳定：同一位置内保持文档原序。
    const ordered = [...document.header.items].sort(
      (left, right) => rankOf(left.placement) - rankOf(right.placement),
    );
    if (ordered.length > 0) {
      header.push(
        groupNode(
          HEADER_GROUP_KEY,
          ordered.map((item) => headerNode(item, settings.resolveFieldLabel)),
        ),
      );
    }
  }
  return {
    header,
    sections: document.sections.map((section) =>
      sectionNode(section, settings, settings.resolveFieldLabel, settings.resolveEnumValue),
    ),
  };
}
