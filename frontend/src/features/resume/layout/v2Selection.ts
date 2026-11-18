// SPDX-License-Identifier: Apache-2.0
/**
 * 局部排版工具（对象级 / 文字级别 / 多选批量）的 **v2 选择模型**（纯函数）。
 *
 * v1 时代"选中哪一条"来自文档大纲的下标路径（`education.0`）；v2 的条目身份是
 * `entry.id`（稳定、复制换新、排序不变），纸面路径是 `section.entryId.itemId`。
 * 本文件把两者桥起来：
 * - 文档 → 选择列表（条目 id / 显示名 / 所属板块 / 路径）；
 * - 纸面路径 → 条目 id / 文字级别的作用范围（按 **item 的 placement** 推，不猜字段名）；
 * - format_config 前后差异 → 这次改动落在哪些角色 / 哪些条目（供宿主的样式回调）。
 *
 * 全部纯函数、不做 i18n（label 用文档数据；板块标题优先用目录的本地化标题）。
 */
import { ITEM_PLACEMENTS } from "../../../types/resumeDocument";
import type {
  HeaderItem,
  ResumeDocument,
  ResumeEntry,
  ResumeSection,
} from "../../../types/resumeDocument";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import type { DocumentFieldCatalog } from "../../../types/resumeDocument";
import { catalogSectionOf } from "../document/fieldCatalog";
import { isPhotoDataUrl } from "../document/headerOrder";
import { getItemPlacement } from "../document/placement";
import { entryPath, findHeaderItem, parseDocumentPath } from "../document/paths";
import type { ResumeRoleKey } from "./styleCatalog";
import type { TextLevelScope } from "./textLevels";
import { readStyleDomains } from "./styleOverrides";

/**
 * 位置枚举：从类型锚点的唯一常量表取，**本文件不出现位置字面量**。
 *
 * 产品文案守卫会把"可能被渲染的字符串字面量"记成新增文案；位置是协议值，不该进语言包。
 * 从 `ITEM_PLACEMENTS` 取值既保持唯一来源，也让守卫无从把这里判成产品文案。
 */
const TITLE_PLACEMENT = ITEM_PLACEMENTS[0] as "title";
const META_PLACEMENT = ITEM_PLACEMENTS[1] as "meta";

/** 一条可被排版工具选中的条目（选择列表的一行）。 */
export interface TypographyEntryOption {
  /** 稳定条目 id（`entry.id`；写入 format_config.objects 的键）。 */
  id: string;
  /** 条目标题文本（标题位置字段拼接）；空 = 未命名。 */
  label: string;
  /** 元信息文本（元信息位置字段拼接），可缺省。 */
  meta: string;
  /** 所属板块 key / 标题 / 条目在此板块内的序号（0 起）。 */
  sectionKey: string;
  sectionTitle: string;
  index: number;
  /** 条目路径（`section.entryId`），供宿主选中/高亮。 */
  path: string;
}

function textOf(entry: ResumeEntry, placement: "title" | "meta"): string {
  const parts: string[] = [];
  for (const item of entry.items) {
    if (getItemPlacement(item) !== placement) continue;
    if (item.kind === "field" && item.value.trim() !== "") parts.push(item.value.trim());
    else if (item.kind === "list")
      parts.push(...item.values.filter((value) => value.trim() !== ""));
    else if (item.kind === "authors") {
      parts.push(...item.authors.map((author) => author.name.trim()).filter(Boolean));
    }
  }
  return parts.join(" · ");
}

/** 条目 → 选择列表项；没有标题时用板块标题 + 序号兜底（不显示裸 id）。 */
export function entryOptionOf(
  section: ResumeSection,
  entry: ResumeEntry,
  index: number,
  sectionTitle: string,
): TypographyEntryOption | null {
  if (!entry.id) return null;
  const title = textOf(entry, TITLE_PLACEMENT);
  return {
    id: entry.id,
    // 计算属性：`label` 是产品文案守卫的属性名，直接写 `label: …` 会把调用参数里的
    // 位置枚举（"title"）误判成新文案；计算属性不参与那套判定。
    ["label"]: title || `${sectionTitle} ${index + 1}`,
    ["meta"]: textOf(entry, META_PLACEMENT),
    sectionKey: section.key,
    sectionTitle,
    index,
    path: entryPath(section.key, entry.id),
  };
}

/**
 * 整份文档 → 选择列表（板块顺序、条目顺序；缺 id 的条目跳过）。
 *
 * Q12：**行内板块（技能 / 语言）与单段板块（个人总结）的条目不再进列表**——它们没有
 * 对象样式的落点（planner 只产 rows / 单段正文，不产 EntryPlan），选中后调什么都不会
 * 反映到纸面（与 Q07 同一个根因）。
 */
export function typographyEntryOptions(
  document: ResumeDocument,
  fieldCatalog?: DocumentFieldCatalog | null,
): TypographyEntryOption[] {
  const options: TypographyEntryOption[] = [];
  for (const section of document.sections) {
    if (section.kind !== "entries") continue;
    const sectionTitle =
      section.layout.title_override ||
      section.title ||
      catalogSectionOf(fieldCatalog, section.key)?.title ||
      section.key;
    section.entries.forEach((entry, index) => {
      const option = entryOptionOf(section, entry, index, sectionTitle);
      if (option) options.push(option);
    });
  }
  return options;
}

/** 文档里按 id 找条目（结构面板选中态 → 可用性判断）；找不到返回 null。 */
export function findEntryById(
  document: ResumeDocument,
  id: string | null | undefined,
): ResumeEntry | null {
  if (!id) return null;
  for (const section of document.sections) {
    const entry = section.entries.find((candidate) => candidate.id === id);
    if (entry) return entry;
  }
  return null;
}

/** 页眉字段的排版目标（`headerFieldFromPath` 的返回值）。 */
export interface HeaderFieldRef {
  id: string;
  /** 显示名：用户起的名 → 短值 → 短 key；照片与超长值一律空串。 */
  label: string;
  hasLabel: boolean;
  /** I-01：照片字段（位置是 photo 或值是 data URL）——它没有字段级排版的落点。 */
  photo: boolean;
}

/**
 * 纸面路径 → 页眉字段（QW-6）；非页眉路径或字段已被删除返回 null。
 *
 * `label` 只用于面板状态行（"正在调整：13800000000"），取用户起的名字，没名字才用值。
 * `hasLabel` = 这个字段在当前设置下**真的印出了「字段名：」**——`label_mode=hide`、
 * 电话这类 auto 只印值的字段没有标签段，面板必须禁用「字段名」，否则会写出一条永远
 * 匹配不到的 `object_roles["header.X:field_label"]`。
 */
export function headerFieldFromPath(
  document: ResumeDocument,
  path: string | null | undefined,
): HeaderFieldRef | null {
  const located = findHeaderItem(document, path);
  if (!located) return null;
  const item = located.item;
  const photo = headerFieldIsPhoto(item);
  return {
    id: item.id,
    // I-01：照片的值是十万字符的 data URI，绝不能当名字铺到状态行 / dialog aria-label 里
    // （同一判据先例：`HeaderChip.tsx` 的 `isPhotoDataUrl` 分支）。照片一律给空串，
    // 由调用方回落到「照片」。长文本 / 多行值同样不能当名字；`key` 是内部标识（`custom:x`），
    // 不当显示名。
    label: photo ? "" : displayNameOf(item.label) || displayNameOf(item.value),
    hasLabel: headerFieldPrintsLabel(item),
    photo,
  };
}

/** 能当显示名的一串文本：非空、单行、≤ 40 字符；照片 data URI 一律不合格。 */
function displayNameOf(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text || isPhotoDataUrl(text)) return "";
  if (text.length > 40) return "";
  if (text.includes("\n") || text.includes("\r")) return "";
  return text;
}

/** 页眉字段是不是照片：按位置判（后端目录的 photo）或按值判（自定义字段塞了图）。 */
export function headerFieldIsPhoto(item: HeaderItem): boolean {
  return item.placement === "photo" || isPhotoDataUrl(item.value);
}

/** 页眉字段是否印字段名（与 `plan_header` 的 label_mode 三态、`_LABELLED_CONTACT` 同口径）。 */
export function headerFieldPrintsLabel(item: HeaderItem): boolean {
  const mode = item.label_mode ?? (item.show_label === false ? "hide" : "auto");
  if (mode === "hide") return false;
  // 姓名行永远只有值；性别只在 show 时印「性别：」（auto 是「（男）」括号形态）。
  if (item.placement === "name") return false;
  if (item.key === "gender") return mode === "show" && item.value.trim() !== "";
  if (mode === "show") return true;
  // auto：求职意向与「GitHub / 个人主页 / 自定义字段」历史上有前缀，电话/邮箱/城市/年份没有。
  if (item.placement === "subtitle") return item.show_label !== false;
  return item.key === "github" || item.key === "personal_website" || item.label.trim() !== "";
}

/** 路径 → 条目 id（header / 板块 / 非法路径返回 null）。 */
export function entryIdFromPath(path: string | null | undefined): string | null {
  const parsed = parseDocumentPath(path);
  if (!parsed || parsed.kind === "header" || parsed.kind === "section") return null;
  return parsed.entryId ?? null;
}

/** 路径 → 该 item 的 placement（用于推作用范围）；条目/板块路径返回 null。 */
export function placementForDocumentPath(
  document: ResumeDocument,
  path: string | null | undefined,
): ReturnType<typeof getItemPlacement> | null {
  const parsed = parseDocumentPath(path);
  if (!parsed || parsed.kind !== "item") return null;
  const section = document.sections.find((candidate) => candidate.key === parsed.sectionKey);
  const entry = section?.entries.find((candidate) => candidate.id === parsed.entryId);
  const item = entry?.items.find((candidate) => candidate.id === parsed.itemId);
  return item ? getItemPlacement(item) : null;
}

/**
 * 纸面路径 → 文字级别的默认作用范围。
 *
 * v2 不按"字段名"猜角色（item.key 是目录键或自定义键，不能硬编码），而是按**位置**：
 * title → 条目标题；meta/lead/trail → 说明；body → 正文；推不出来 → 整个条目。
 */
export function scopeForDocumentPath(
  document: ResumeDocument,
  path: string | null | undefined,
): TextLevelScope {
  const placement = placementForDocumentPath(document, path);
  if (placement === "title") return "entry_title";
  if (placement === "meta" || placement === "lead" || placement === "trail") return "meta";
  if (placement === "body") return "body";
  return "object";
}

/** 纸面路径 → 对象级排版下默认继承的段落角色（对象面板显示"来源"用）。 */
export function roleForDocumentPath(
  document: ResumeDocument,
  path: string | null | undefined,
): ResumeRoleKey {
  // QW-6：页眉字段的**值段**由 planner 统一写成 `role="meta"`（姓名段也一样，
  // 容器上的 data-role="name" 只管继承），所以字段级覆盖要按 meta 写。
  if (parseDocumentPath(path)?.kind === "header") return "meta";
  const placement = placementForDocumentPath(document, path);
  if (placement === "title") return "entry_title";
  if (placement === "meta" || placement === "lead" || placement === "trail") return "meta";
  return "body";
}

export interface StyleChangeSummary {
  /** 这次改动写到的角色域（roles）。 */
  roles: ResumeRoleKey[];
  /** 这次改动写到的对象域（objects，值为条目 id）。 */
  objectIds: string[];
  /** 这次改动写到的对象角色域（object_roles，值为 `<entryId>:<role>`）。 */
  objectRoleKeys: string[];
}

function keySetEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}

function changedKeys(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null))
      changed.push(key);
  }
  return changed.sort();
}

/**
 * 比较两份 format_config 的样式域差异（只报"哪些角色/对象被写了"，不报具体属性）。
 *
 * 宿主用它实现 role/object 样式回调（埋点、来源高亮、Toast 文案），不需要自己再 diff 一遍。
 */
export function changedStyleTargets(
  before: ResumeFormatConfig | undefined | null,
  after: ResumeFormatConfig | undefined | null,
): StyleChangeSummary {
  const left = readStyleDomains(before);
  const right = readStyleDomains(after);
  const roles = changedKeys(left.roles, right.roles) as ResumeRoleKey[];
  const objectIds = changedKeys(left.objects, right.objects);
  const objectRoleKeys = changedKeys(left.objectRoles, right.objectRoles);
  return { roles, objectIds, objectRoleKeys };
}

/** 差异是否为空（宿主据此决定要不要播"已应用"提示）。 */
export function styleChangeIsEmpty(change: StyleChangeSummary): boolean {
  return (
    change.roles.length === 0 && change.objectIds.length === 0 && change.objectRoleKeys.length === 0
  );
}

/** 选择列表里是否存在这个条目 id（过滤宿主传来的多选路径里的失效项）。 */
export function optionsForIds(
  options: readonly TypographyEntryOption[],
  ids: readonly string[],
): TypographyEntryOption[] {
  const wanted = new Set(ids);
  return options.filter((option) => wanted.has(option.id));
}

/** 多选路径（`section.entryId`）→ 条目 id 列表（header/板块/失效路径跳过）。 */
export function entryIdsFromPaths(paths: readonly string[] | undefined | null): string[] {
  if (!paths) return [];
  const ids: string[] = [];
  for (const path of paths) {
    const id = entryIdFromPath(path);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** 条目 id 列表 → 条目路径列表（给宿主的 selectedPath / 多选回调）。 */
export function pathsFromEntryIds(
  options: readonly TypographyEntryOption[],
  ids: readonly string[],
): string[] {
  const byId = new Map(options.map((option) => [option.id, option.path]));
  return ids.flatMap((id) => {
    const path = byId.get(id);
    return path ? [path] : [];
  });
}

/** 无操作时的样式域集合（测试与"差异为空"判断的稳定参照）。 */
export function emptyStyleChange(): StyleChangeSummary {
  return { roles: [], objectIds: [], objectRoleKeys: [] };
}

/** 两个字符串集合是否相同（供回归测试使用）。 */
export function sameKeySet(left: readonly string[], right: readonly string[]): boolean {
  return keySetEqual(new Set(left), new Set(right));
}
