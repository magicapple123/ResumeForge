// SPDX-License-Identifier: Apache-2.0
/**
 * v2 文档的稳定路径（与后端 planner 的 `path` 同一套写法）。
 *
 * - header item：`header.{item_id}`
 * - section：`{section_key}`
 * - entry：`{section_key}.{entry_id}`
 * - item：`{section_key}.{entry_id}.{item_id}`
 *
 * 三段都只由 id / key 组成（不出现点号），因此路径可以用点号直接切分；这也是预览
 * `data-resume-path` 的来源，编辑器 / 结构面板 / 预览联动共用同一份解析。
 */
import type {
  HeaderItem,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
} from "../../types/resumeDocument";

export const HEADER_PATH_PREFIX = "header";

export function headerPath(itemId: string): string {
  return `${HEADER_PATH_PREFIX}.${itemId}`;
}

export function sectionPath(sectionKey: string): string {
  return sectionKey;
}

export function entryPath(sectionKey: string, entryId: string): string {
  return `${sectionKey}.${entryId}`;
}

export function itemPath(sectionKey: string, entryId: string, itemId: string): string {
  return `${sectionKey}.${entryId}.${itemId}`;
}

export type ParsedDocumentPath =
  | { kind: "header"; itemId: string }
  | { kind: "section"; sectionKey: string }
  | { kind: "entry"; sectionKey: string; entryId: string }
  | { kind: "item"; sectionKey: string; entryId: string; itemId: string };

/** 解析路径；无法识别返回 `null`（不抛错：路径可能来自纸面 DOM，永远当外部输入）。 */
export function parseDocumentPath(path: string | null | undefined): ParsedDocumentPath | null {
  if (!path) return null;
  const parts = path.split(".");
  if (parts.some((part) => part.length === 0)) return null;
  if (parts[0] === HEADER_PATH_PREFIX) {
    return parts.length === 2 ? { kind: "header", itemId: parts[1] } : null;
  }
  if (parts.length === 1) return { kind: "section", sectionKey: parts[0] };
  if (parts.length === 2) return { kind: "entry", sectionKey: parts[0], entryId: parts[1] };
  if (parts.length === 3) {
    return { kind: "item", sectionKey: parts[0], entryId: parts[1], itemId: parts[2] };
  }
  return null;
}

/** 路径所属板块的 key（header 路径返回 null）；用于"选中项属于哪个页签"的自动切换。 */
export function sectionKeyOfPath(path: string | null | undefined): string | null {
  const parsed = parseDocumentPath(path);
  if (!parsed || parsed.kind === "header") return null;
  return parsed.sectionKey;
}

export type LocatedPath =
  | { kind: "header"; item: HeaderItem; index: number }
  | { kind: "section"; section: ResumeSection; sectionIndex: number }
  | {
      kind: "entry";
      section: ResumeSection;
      sectionIndex: number;
      entry: ResumeEntry;
      entryIndex: number;
    }
  | {
      kind: "item";
      section: ResumeSection;
      sectionIndex: number;
      entry: ResumeEntry;
      entryIndex: number;
      item: ResumeItem;
      itemIndex: number;
    };

/** 一次解析出路径目标与它的全部上下文（编辑器定位 / 目录操作共用）。 */
export function locatePath(
  document: ResumeDocument,
  path: string | null | undefined,
): LocatedPath | null {
  const parsed = parseDocumentPath(path);
  if (!parsed) return null;
  if (parsed.kind === "header") {
    const index = document.header.items.findIndex((item) => item.id === parsed.itemId);
    if (index < 0) return null;
    return { kind: "header", item: document.header.items[index], index };
  }
  const sectionIndex = document.sections.findIndex((section) => section.key === parsed.sectionKey);
  if (sectionIndex < 0) return null;
  const section = document.sections[sectionIndex];
  if (parsed.kind === "section") return { kind: "section", section, sectionIndex };
  const entryIndex = section.entries.findIndex((entry) => entry.id === parsed.entryId);
  if (entryIndex < 0) return null;
  const entry = section.entries[entryIndex];
  if (parsed.kind === "entry") return { kind: "entry", section, sectionIndex, entry, entryIndex };
  const itemIndex = entry.items.findIndex((item) => item.id === parsed.itemId);
  if (itemIndex < 0) return null;
  return {
    kind: "item",
    section,
    sectionIndex,
    entry,
    entryIndex,
    item: entry.items[itemIndex],
    itemIndex,
  };
}

export function findSection(
  document: ResumeDocument,
  pathOrKey: string | null | undefined,
): ResumeSection | null {
  if (!pathOrKey) return null;
  const parsed = parseDocumentPath(pathOrKey);
  const key = parsed && parsed.kind !== "header" ? parsed.sectionKey : pathOrKey;
  return document.sections.find((section) => section.key === key) ?? null;
}

export function findEntry(
  document: ResumeDocument,
  path: string | null | undefined,
): { section: ResumeSection; entry: ResumeEntry; entryIndex: number } | null {
  const located = locatePath(document, path);
  if (!located || located.kind === "header" || located.kind === "section") return null;
  return { section: located.section, entry: located.entry, entryIndex: located.entryIndex };
}

export function findItem(
  document: ResumeDocument,
  path: string | null | undefined,
): { section: ResumeSection; entry: ResumeEntry; item: ResumeItem; itemIndex: number } | null {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return null;
  return {
    section: located.section,
    entry: located.entry,
    item: located.item,
    itemIndex: located.itemIndex,
  };
}

export function findHeaderItem(
  document: ResumeDocument,
  path: string | null | undefined,
): { item: HeaderItem; index: number } | null {
  const located = locatePath(document, path);
  return located?.kind === "header" ? { item: located.item, index: located.index } : null;
}
