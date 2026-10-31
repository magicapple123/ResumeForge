// SPDX-License-Identifier: Apache-2.0
/**
 * 条目级操作（纯函数，不可变）：新增 / 删除 / 排序 / 复制 / 隐藏 / 锁定。
 *
 * 复制是**身份全新**的深拷贝：entry.id 与每个 item.id 都换新（与 W01 的稳定 id 规则一致），
 * 否则历史快照、预览高亮、对象级排版会把"复制出来的第二条"当成第一条。
 */
import type { ResumeDocument, ResumeEntry, ResumeItem } from "../../types/resumeDocument";
import { emptyEntry } from "./defaults";
import { newObjectId } from "./identity";
import { locatePath } from "./paths";

type IdFactory = () => string;

function replaceEntry(
  document: ResumeDocument,
  sectionIndex: number,
  entryIndex: number,
  entry: ResumeEntry,
): ResumeDocument {
  const section = document.sections[sectionIndex];
  const entries = section.entries.slice();
  entries[entryIndex] = entry;
  const sections = document.sections.slice();
  sections[sectionIndex] = { ...section, entries };
  return { ...document, sections } as ResumeDocument;
}

/** 定位"路径所属的条目"：entry 路径、item 路径都可以。 */
function locateEntry(document: ResumeDocument, path: string) {
  const located = locatePath(document, path);
  if (!located || located.kind === "header" || located.kind === "section") return null;
  return located;
}

/** 新增一条空条目，追加到板块末尾；返回新文档与新条目 id。 */
export function addEntry(
  document: ResumeDocument,
  sectionKey: string,
  entry: ResumeEntry = emptyEntry(),
  idFactory: IdFactory = newObjectId,
): { document: ResumeDocument; entryId: string } {
  const sectionIndex = document.sections.findIndex((section) => section.key === sectionKey);
  const entryId = entry.id ?? idFactory();
  if (sectionIndex < 0) return { document, entryId };
  const section = document.sections[sectionIndex];
  const sections = document.sections.slice();
  sections[sectionIndex] = { ...section, entries: [...section.entries, { ...entry, id: entryId }] };
  return { document: { ...document, sections } as ResumeDocument, entryId };
}

/** 删除一条条目；路径不存在返回原引用。 */
export function removeEntry(document: ResumeDocument, path: string): ResumeDocument {
  const located = locateEntry(document, path);
  if (!located) return document;
  const section = document.sections[located.sectionIndex];
  const entries = section.entries.filter((_, index) => index !== located.entryIndex);
  const sections = document.sections.slice();
  sections[located.sectionIndex] = { ...section, entries };
  return { ...document, sections } as ResumeDocument;
}

export type MoveEntryTarget = number | "up" | "down";

/**
 * 移动条目：`"up"` / `"down"` 移一位，数字 = 目标下标（会夹到合法范围）。
 * 越界 / 找不到 / 原地不动时返回原引用。
 */
export function moveEntry(
  document: ResumeDocument,
  path: string,
  target: MoveEntryTarget,
): ResumeDocument {
  const located = locateEntry(document, path);
  if (!located) return document;
  const section = document.sections[located.sectionIndex];
  const from = located.entryIndex;
  const to = target === "up" ? from - 1 : target === "down" ? from + 1 : target;
  if (!Number.isInteger(to) || to < 0 || to >= section.entries.length || to === from) {
    return document;
  }
  const entries = section.entries.slice();
  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved);
  const sections = document.sections.slice();
  sections[located.sectionIndex] = { ...section, entries };
  return { ...document, sections } as ResumeDocument;
}

/** 深拷贝一条条目并换掉全部 id（JSON 往返：文档里只有 JSON 值，没有函数/Date）。 */
function cloneEntryWithNewIds(entry: ResumeEntry, idFactory: IdFactory): ResumeEntry {
  const copy = JSON.parse(JSON.stringify(entry)) as ResumeEntry;
  return {
    ...copy,
    id: idFactory(),
    items: copy.items.map((item: ResumeItem) => ({ ...item, id: idFactory() }) as ResumeItem),
  };
}

/** 复制一条条目，插在原条目后面；返回新文档与新条目 id。 */
export function copyEntry(
  document: ResumeDocument,
  path: string,
  idFactory: IdFactory = newObjectId,
): { document: ResumeDocument; entryId: string | null } {
  const located = locateEntry(document, path);
  if (!located) return { document, entryId: null };
  const section = document.sections[located.sectionIndex];
  const copy = cloneEntryWithNewIds(located.entry, idFactory);
  const entryId = copy.id ?? idFactory();
  const withId = { ...copy, id: entryId };
  const entries = section.entries.slice();
  entries.splice(located.entryIndex + 1, 0, withId);
  const sections = document.sections.slice();
  sections[located.sectionIndex] = { ...section, entries };
  return {
    document: { ...document, sections } as ResumeDocument,
    entryId,
  };
}

/** 切换条目隐藏；路径可以是 entry 或 item（item 路径定点到所属条目）。 */
export function toggleEntryHidden(document: ResumeDocument, path: string): ResumeDocument {
  const located = locateEntry(document, path);
  if (!located) return document;
  return replaceEntry(document, located.sectionIndex, located.entryIndex, {
    ...located.entry,
    hidden: !located.entry.hidden,
  });
}

export type EntryLockKind = "content" | "layout";

/** 切换条目"锁定内容 / 锁定排版"；两种锁互不影响。 */
export function toggleLock(
  document: ResumeDocument,
  path: string,
  lock: EntryLockKind,
): ResumeDocument {
  const located = locateEntry(document, path);
  if (!located) return document;
  const entry = located.entry;
  return replaceEntry(document, located.sectionIndex, located.entryIndex, {
    ...entry,
    lock_content: lock === "content" ? !entry.lock_content : entry.lock_content,
    lock_layout: lock === "layout" ? !entry.lock_layout : entry.lock_layout,
  });
}

/** 某板块当前最大条目下标（结构面板显示序号用；空板块返回 -1）。 */
export function lastEntryIndex(document: ResumeDocument, sectionKey: string): number {
  const section = document.sections.find((candidate) => candidate.key === sectionKey);
  return section ? section.entries.length - 1 : -1;
}
