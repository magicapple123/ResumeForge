// SPDX-License-Identifier: Apache-2.0
/**
 * 来源核对面板的纯文本定位（从 SourceChainPanelV2 抽出，守住单文件 500 行预算）。
 *
 * - v2 文档的路径是 section.key + entry.id + item.id；分析视图的旧下标路径在 v2 上没有意义；
 * - 来源视图同时给 object_id / point_id，所以先按稳定身份定位，再退回路径；
 * - 定位不到就返回空串，绝不按"看起来像"猜一段文字。
 */
import type { ResumeDocument } from "../../../types/resumeDocument";

type HeaderItem = ResumeDocument["header"]["items"][number];
type EntryItem = ResumeDocument["sections"][number]["entries"][number]["items"][number];

export function isResumeDocument(value: unknown): value is ResumeDocument {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const header = candidate["header"];
  return (
    candidate["version"] === 2 &&
    Array.isArray(candidate["sections"]) &&
    typeof header === "object" &&
    header !== null &&
    Array.isArray((header as Record<string, unknown>)["items"])
  );
}

export function itemText(item: HeaderItem | EntryItem): string {
  if (item.kind === "text") return item.text;
  if (item.kind === "list") return item.values.join(" · ");
  if (item.kind === "authors") return item.authors.map((author) => author.name).join(" · ");
  return item.value;
}

export function textAtPath(document: ResumeDocument, path: string): string {
  const [sectionKey, entryId, itemId] = path.split(".");
  if (sectionKey === "header") {
    const item = document.header.items.find((candidate) => candidate.id === entryId);
    return item ? itemText(item) : "";
  }
  const entry = document.sections
    .find((section) => section.key === sectionKey)
    ?.entries.find((candidate) => candidate.id === entryId);
  const item = itemId ? entry?.items.find((candidate) => candidate.id === itemId) : null;
  return item ? itemText(item) : (entry?.items.map(itemText).filter(Boolean).join(" · ") ?? "");
}

/**
 * 按稳定身份取「当前改写」：来源视图给 object_id / point_id，它们在 v2 文档里就是
 * 条目 id 与字段/要点 id；先按 id 解析，再退回路径。
 */
export function textAtIdentity(
  document: ResumeDocument,
  objectId: string | null,
  pointId: string | null,
): string {
  if (pointId) {
    const headerItem = document.header.items.find((candidate) => candidate.id === pointId);
    if (headerItem) return itemText(headerItem);
    for (const section of document.sections) {
      for (const entry of section.entries) {
        if (objectId && entry.id !== objectId) continue;
        const item = entry.items.find((candidate) => candidate.id === pointId);
        if (item) return itemText(item);
      }
    }
    return "";
  }
  if (!objectId) return "";
  for (const section of document.sections) {
    const entry = section.entries.find((candidate) => candidate.id === objectId);
    if (entry) {
      return entry.items.map(itemText).filter(Boolean).join(" · ");
    }
  }
  return "";
}
