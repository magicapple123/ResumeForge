// SPDX-License-Identifier: Apache-2.0
/** Small native readers for previews, diagnostics and comparisons. */
import type {
  HeaderItem,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
} from "../../../types/resumeDocument";
import { formatAuthors, formatListValues } from "./format";
import { displayText } from "./summarize";

export function isDocument(value: unknown): value is ResumeDocument {
  return typeof value === "object" && value !== null && "version" in value && value.version === 2;
}

export function headerValue(document: ResumeDocument | null | undefined, key: string): string {
  return document?.header?.items?.find((item) => item.key === key)?.value ?? "";
}

export function entryValue(entry: ResumeEntry | undefined, key: string): string {
  const item = entry?.items.find((candidate) => candidate.kind !== "text" && candidate.key === key);
  return item ? itemValue(item) : "";
}

/**
 * 单个 item 的**展示值**（DF-6）：剥掉行内标记，只留用户看得见的字。
 *
 * 取数、诊断与字段对比共用这一处。对比的**相等判定不在这里**（`documentFieldDiff` 的
 * `signature` 仍是整条 item 的原始 JSON），所以"只改了颜色"不会退化成"没有变化"。
 */
export function itemValue(item: ResumeItem | HeaderItem): string {
  if (item.kind === "text") return displayText(item.text);
  if (item.kind === "list") return displayText(formatListValues(item.values, item.join));
  if (item.kind === "authors") return displayText(formatAuthors(item.authors));
  return displayText(item.value);
}

export function documentHasPhoto(document: ResumeDocument | null | undefined): boolean {
  return (
    document?.header?.items?.some((item) => item.placement === "photo" && !!item.value.trim()) ??
    false
  );
}
