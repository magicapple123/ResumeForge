// SPDX-License-Identifier: Apache-2.0
/** Small native readers for previews, diagnostics and comparisons. */
import type {
  HeaderItem,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
} from "../../types/resumeDocument";
import { formatAuthors, formatListValues } from "./format";

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

export function itemValue(item: ResumeItem | HeaderItem): string {
  if (item.kind === "text") return item.text;
  if (item.kind === "list") return formatListValues(item.values, item.join);
  if (item.kind === "authors") return formatAuthors(item.authors);
  return item.value;
}

export function documentHasPhoto(document: ResumeDocument | null | undefined): boolean {
  return (
    document?.header?.items?.some((item) => item.placement === "photo" && !!item.value.trim()) ??
    false
  );
}
