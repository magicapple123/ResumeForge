// SPDX-License-Identifier: Apache-2.0
/**
 * 文档内容写入（纯函数，不可变）：item / entry / section / header 的定点更新。
 *
 * 所有函数**找不到路径就返回原文档引用**（调用方用 `=== before` 判断"没改成"），
 * 不抛错——路径可能来自纸面 DOM / 结构树，永远当外部输入。
 */
import type {
  AuthorsItem,
  EntryLayout,
  FieldItem,
  HeaderItem,
  ListItem,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
  SectionLayout,
  TextItem,
} from "../../types/resumeDocument";
import { locatePath } from "./paths";

function replaceSectionAt(
  document: ResumeDocument,
  sectionIndex: number,
  section: ResumeSection,
): ResumeDocument {
  const sections = document.sections.slice();
  sections[sectionIndex] = section;
  return { ...document, sections } as ResumeDocument;
}

function replaceEntryAt(
  document: ResumeDocument,
  sectionIndex: number,
  entryIndex: number,
  entry: ResumeEntry,
): ResumeDocument {
  const section = document.sections[sectionIndex];
  const entries = section.entries.slice();
  entries[entryIndex] = entry;
  return replaceSectionAt(document, sectionIndex, { ...section, entries });
}

/** 定点替换一条 item（整条换掉；类型由调用方保证）。路径不是 item 返回原引用。 */
export function replaceItem(
  document: ResumeDocument,
  path: string,
  next: ResumeItem,
): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return document;
  const items = located.entry.items.slice();
  items[located.itemIndex] = next;
  return replaceEntryAt(document, located.sectionIndex, located.entryIndex, {
    ...located.entry,
    items,
  });
}

function patchItemByKind<K extends ResumeItem["kind"]>(
  document: ResumeDocument,
  path: string,
  kind: K,
  patch: Record<string, unknown>,
): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item" || located.item.kind !== kind) return document;
  return replaceItem(document, path, { ...located.item, ...patch } as ResumeItem);
}

/** 更新字段 item 的值 / 标签 / 位置 / 格式等；不是 field 类型则原引用。 */
export function updateFieldItem(
  document: ResumeDocument,
  path: string,
  patch: Partial<FieldItem>,
): ResumeDocument {
  return patchItemByKind(document, path, "field", patch as Record<string, unknown>);
}

export function updateListItem(
  document: ResumeDocument,
  path: string,
  patch: Partial<ListItem>,
): ResumeDocument {
  return patchItemByKind(document, path, "list", patch as Record<string, unknown>);
}

export function updateAuthorsItem(
  document: ResumeDocument,
  path: string,
  patch: Partial<AuthorsItem>,
): ResumeDocument {
  return patchItemByKind(document, path, "authors", patch as Record<string, unknown>);
}

export function updateTextItem(
  document: ResumeDocument,
  path: string,
  patch: Partial<TextItem>,
): ResumeDocument {
  return patchItemByKind(document, path, "text", patch as Record<string, unknown>);
}

/** 切换 item 隐藏：field/list/authors 改 placement，text 改 hidden 布尔。 */
export function toggleItemHidden(document: ResumeDocument, path: string): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return document;
  const item = located.item;
  if (item.kind === "text") {
    return replaceItem(document, path, { ...item, hidden: !item.hidden } as ResumeItem);
  }
  const hidden = item.placement === "hidden";
  if (hidden) {
    // 恢复隐藏前的位置；旧数据（没有 hidden_from）仍回落到 trail 安全默认。
    const restored = item.hidden_from && item.hidden_from !== "hidden" ? item.hidden_from : "trail";
    return replaceItem(document, path, {
      ...item,
      placement: restored,
      hidden_from: null,
    } as ResumeItem);
  }
  return replaceItem(document, path, {
    ...item,
    placement: "hidden",
    hidden_from: item.placement,
  } as ResumeItem);
}

/** 新增一条 item 到条目末尾（顺序由 planner 按 placement 分组，末尾 = 该组末尾）。 */
export function addItem(
  document: ResumeDocument,
  sectionKey: string,
  entryId: string,
  item: ResumeItem,
): ResumeDocument {
  const sectionIndex = document.sections.findIndex((section) => section.key === sectionKey);
  if (sectionIndex < 0) return document;
  const section = document.sections[sectionIndex];
  const entryIndex = section.entries.findIndex((entry) => entry.id === entryId);
  if (entryIndex < 0) return document;
  const entry = section.entries[entryIndex];
  return replaceEntryAt(document, sectionIndex, entryIndex, {
    ...entry,
    items: [...entry.items, item],
  });
}

export function removeItem(document: ResumeDocument, path: string): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return document;
  const items = located.entry.items.filter((_, index) => index !== located.itemIndex);
  return replaceEntryAt(document, located.sectionIndex, located.entryIndex, {
    ...located.entry,
    items,
  });
}

export interface EntryPatch {
  hidden?: boolean;
  lock_content?: boolean;
  lock_layout?: boolean;
  layout?: Partial<EntryLayout>;
}

export function updateEntry(
  document: ResumeDocument,
  path: string,
  patch: EntryPatch,
): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind === "header" || located.kind === "section") return document;
  const entry = located.entry;
  return replaceEntryAt(document, located.sectionIndex, located.entryIndex, {
    ...entry,
    ...patch,
    layout: patch.layout ? { ...entry.layout, ...patch.layout } : entry.layout,
  } as ResumeEntry);
}

/** 条目头布局三选一（split / stacked / meta_first）。 */
export function setEntryHeadLayout(
  document: ResumeDocument,
  path: string,
  head: EntryLayout["head"],
): ResumeDocument {
  return updateEntry(document, path, { layout: { head } });
}

export interface SectionPatch {
  title?: string;
  kind?: ResumeSection["kind"];
  layout?: Partial<SectionLayout>;
}

export function updateSection(
  document: ResumeDocument,
  sectionKey: string,
  patch: SectionPatch,
): ResumeDocument {
  const sectionIndex = document.sections.findIndex((section) => section.key === sectionKey);
  if (sectionIndex < 0) return document;
  const section = document.sections[sectionIndex];
  return replaceSectionAt(document, sectionIndex, {
    ...section,
    ...patch,
    layout: patch.layout ? { ...section.layout, ...patch.layout } : section.layout,
  } as ResumeSection);
}

/** 新增一个板块（自建板块用：key 形如 `custom:<id>`，由调用方生成）。 */
export function addSection(document: ResumeDocument, section: ResumeSection): ResumeDocument {
  if (document.sections.some((candidate) => candidate.key === section.key)) return document;
  return { ...document, sections: [...document.sections, section] } as ResumeDocument;
}

export function removeSection(document: ResumeDocument, sectionKey: string): ResumeDocument {
  const sections = document.sections.filter((section) => section.key !== sectionKey);
  return sections.length === document.sections.length
    ? document
    : ({ ...document, sections } as ResumeDocument);
}

/** 按给定 key 顺序重排板块；缺失/未知 key 忽略，未列出的板块按原顺序补末尾。 */
export function reorderSections(
  document: ResumeDocument,
  order: readonly string[],
): ResumeDocument {
  const byKey = new Map(document.sections.map((section) => [section.key, section]));
  const sections: ResumeSection[] = [];
  for (const key of order) {
    const section = byKey.get(key);
    if (section && !sections.includes(section)) sections.push(section);
  }
  for (const section of document.sections) {
    if (!sections.includes(section)) sections.push(section);
  }
  if (sections.every((section, index) => section === document.sections[index])) return document;
  return { ...document, sections } as ResumeDocument;
}

/** 上移 / 下移一个板块；越界或 key 不存在返回原文档引用。 */
export function moveSection(
  document: ResumeDocument,
  sectionKey: string,
  direction: "up" | "down",
): ResumeDocument {
  const index = document.sections.findIndex((section) => section.key === sectionKey);
  const target = index + (direction === "up" ? -1 : 1);
  if (index < 0 || target < 0 || target >= document.sections.length) return document;
  const sections = document.sections.slice();
  [sections[index], sections[target]] = [sections[target], sections[index]];
  return { ...document, sections } as ResumeDocument;
}

export function addHeaderItem(document: ResumeDocument, item: HeaderItem): ResumeDocument {
  return {
    ...document,
    header: { ...document.header, items: [...document.header.items, item] },
  } as ResumeDocument;
}

export function updateHeaderItem(
  document: ResumeDocument,
  path: string,
  patch: Partial<HeaderItem>,
): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "header") return document;
  const items = document.header.items.slice();
  items[located.index] = { ...located.item, ...patch } as HeaderItem;
  return { ...document, header: { ...document.header, items } } as ResumeDocument;
}

export function removeHeaderItem(document: ResumeDocument, path: string): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "header") return document;
  const items = document.header.items.filter((_, index) => index !== located.index);
  return { ...document, header: { ...document.header, items } } as ResumeDocument;
}
