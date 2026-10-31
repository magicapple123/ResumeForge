// SPDX-License-Identifier: Apache-2.0
/** Native item comparisons preserve custom fields, hidden text, authors and layout changes. */
import type { ResumeContent, ResumeDocument } from "../types";
import type { DiffToken } from "../types/resumeWriting";
import type { FieldDiffResult, SectionDiff } from "../types/resumeFieldDiff";
import { isDocument, itemValue } from "../features/resume-document/view";
import { buildFallbackCatalog } from "../features/resume-document/fieldCatalog";
import { t } from "../i18n";

type Tokens = (before: string, after: string) => { oldTokens: DiffToken[]; newTokens: DiffToken[] };
type ValueRow = { label: string; value: string; signature: string };

function rows(content: ResumeContent | ResumeDocument): Map<string, ValueRow> {
  const result = new Map<string, ValueRow>();
  const catalog = buildFallbackCatalog(t);
  if (!isDocument(content)) {
    for (const [key, value] of Object.entries(content)) {
      const text =
        key === "photo" && value
          ? t("resume.fieldDiff.photoPlaceholder")
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
      result.set(key, {
        label: catalog.header_fields.find((field) => field.key === key)?.label ?? key,
        value: text,
        signature: text,
      });
    }
    return result;
  }
  for (const item of content.header.items) {
    const value =
      item.placement === "photo" && item.value
        ? t("resume.fieldDiff.photoPlaceholder")
        : item.value;
    const label =
      item.label ||
      catalog.header_fields.find((field) => field.key === item.key)?.label ||
      item.key;
    result.set(`header.${item.key}`, {
      label,
      value,
      signature: JSON.stringify({ value, placement: item.placement, format: item.format }),
    });
  }
  for (const section of content.sections) {
    const spec = catalog.sections.find((candidate) => candidate.key === section.key);
    const sectionLabel =
      section.layout.title_override || section.title || spec?.title || section.key;
    const structure = JSON.stringify({
      layout: section.layout,
      entries: section.entries.map((entry) => entry.id),
    });
    result.set(`${section.key}.#structure`, {
      label: sectionLabel,
      value: section.entries
        .map((entry) =>
          entry.items
            .filter((item) => item.kind !== "text" && item.placement === "title")
            .map(itemValue)
            .join(" · "),
        )
        .join(" → "),
      signature: structure,
    });
    for (const entry of section.entries) {
      const title = entry.items
        .filter((item) => item.kind !== "text" && item.placement === "title")
        .map(itemValue)
        .join(" · ");
      result.set(`${section.key}.${entry.id}.#layout`, {
        label: [sectionLabel, title].filter(Boolean).join(" · "),
        value: JSON.stringify(entry.layout),
        signature: JSON.stringify({
          layout: entry.layout,
          hidden: entry.hidden,
          lock_content: entry.lock_content,
          lock_layout: entry.lock_layout,
          order: entry.items.map((item) => item.id),
        }),
      });
      for (const item of entry.items) {
        const field =
          item.kind === "text"
            ? t("document.placement.body")
            : item.label || spec?.fields.find((field) => field.key === item.key)?.label || item.key;
        const value = itemValue(item);
        result.set(`${section.key}.${entry.id}.${item.id}`, {
          label: [sectionLabel, title, field].filter(Boolean).join(" · "),
          value,
          signature: JSON.stringify(item),
        });
      }
    }
  }
  return result;
}

export function compareDocumentFields(
  base: ResumeContent | ResumeDocument,
  against: ResumeContent | ResumeDocument,
  baseTitle: string,
  againstTitle: string,
  tokenize: Tokens,
): FieldDiffResult {
  const before = rows(base);
  const after = rows(against);
  const changed: SectionDiff[] = [];
  const unchangedLabels: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldRow = before.get(key);
    const newRow = after.get(key);
    const label = newRow?.label || oldRow?.label || key;
    if (oldRow?.signature === newRow?.signature) {
      unchangedLabels.push(label);
      continue;
    }
    const oldText = oldRow?.value ?? "";
    const newText = newRow?.value ?? "";
    changed.push({ type: "string", key, label, oldText, newText, ...tokenize(oldText, newText) });
  }
  return { baseTitle, againstTitle, changed, unchangedLabels };
}
