// SPDX-License-Identifier: Apache-2.0
/**
 * Test-fixture item/entry builders for the v1 -> v2 resume document converter.
 *
 * Split out of `projectionDocumentConverter.ts` (500-line budget): pure move of the
 * existing closures into a factory so the id sequence and header/section shapes stay
 * identical. Not production code; do not import from components.
 */
import type { ResumeContent } from "../types";
import { defaultEntryLayout, defaultSectionLayout } from "./projectionDocumentTail";
import type {
  AuthorsItem,
  FieldItem,
  HeaderItem,
  ListItem,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
  TextItem,
} from "../types/resumeDocument";

export function createConverterContext(content: ResumeContent) {
  let sequence = 0;
  const nextId = (prefix: string): string =>
    `${prefix}_${String((sequence += 1)).padStart(5, "0")}`;
  const entryId = (): string => nextId("ent");
  const itemId = (): string => nextId("itm");
  const headerId = (): string => nextId("hdr");

  const headerItems: HeaderItem[] = [];
  const pushHeader = (
    key: string,
    value: string | undefined,
    placement: HeaderItem["placement"],
    format: HeaderItem["format"] = "text",
  ): void => {
    const text = (value ?? "").trim();
    if (!text) return;
    headerItems.push({
      kind: "field",
      id: headerId(),
      key,
      label: "",
      value: text,
      placement,
      format,
    });
  };
  pushHeader("name", content.name, "name");
  pushHeader("gender", content.gender, "name_meta");
  pushHeader("job_intent", content.job_intent, "subtitle");
  pushHeader("phone", content.phone, "contact");
  pushHeader("email", content.email, "contact");
  pushHeader("city", content.city, "contact");
  pushHeader("birth_year", content.birth_year, "contact");
  pushHeader("github", content.github, "contact", "url");
  pushHeader("personal_website", content.personal_website, "contact", "url");
  pushHeader("photo", content.photo, "photo");

  const field = (input: {
    key: string;
    value?: string;
    placement: FieldItem["placement"];
    format?: FieldItem["format"];
    wrap?: FieldItem["wrap"];
    showLabel?: boolean;
  }): FieldItem => {
    const placement = input.placement;
    return {
      kind: "field",
      id: itemId(),
      key: input.key,
      label: "",
      value: (input.value ?? "").trim(),
      placement,
      format: input.format ?? "text",
      wrap: input.wrap ?? "none",
      show_label: input.showLabel ?? (placement === "lead" || placement === "trail"),
      solo: false,
      body_style: "bullet",
      source: null,
    };
  };
  const textItem = (text: string, style: TextItem["style"] = "bullet"): TextItem => ({
    kind: "text",
    id: itemId(),
    style,
    text: String(text ?? "").trim(),
    hidden: false,
  });
  const listItem = (
    key: string,
    values: string[] | undefined,
    placement: ListItem["placement"],
    join: ListItem["join"] = "semicolon",
  ): ListItem => ({
    kind: "list",
    id: itemId(),
    key,
    label: "",
    values: (values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean),
    placement,
    join,
    show_label: placement === "lead" || placement === "trail",
    solo: false,
    body_style: "bullet",
  });
  const authorsItem = (
    key: string,
    names: string[] | undefined,
    placement: AuthorsItem["placement"],
  ): AuthorsItem => ({
    kind: "authors",
    id: itemId(),
    key,
    label: "",
    authors: (names ?? []).map((name) => ({
      name: String(name ?? "").trim(),
      is_self: false,
      corresponding: false,
    })),
    placement,
    show_label: placement === "trail",
    solo: false,
  });
  const bodyTexts = (lines: unknown): TextItem[] =>
    (Array.isArray(lines) ? lines : [])
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .map((line) => textItem(line));

  const period = (
    start?: string,
    end?: string,
    placement: FieldItem["placement"] = "meta",
  ): FieldItem | null => {
    const from = (start ?? "").trim();
    const to = (end ?? "").trim();
    if (!from && !to) return null;
    const value = start !== undefined || end !== undefined ? `${from}|${to}` : "";
    if (!value) return null;
    return field({ key: "period", value, placement, format: "date_range" });
  };

  const pushItems = (items: (ResumeItem | null)[]): ResumeItem[] =>
    items.filter((item): item is ResumeItem => item !== null);

  const entry = (items: ResumeItem[], id: string = entryId()): ResumeEntry => ({
    id,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: defaultEntryLayout(),
    items,
  });

  const sections: ResumeSection[] = [];
  const pushEntriesSection = (
    key: string,
    kind: ResumeSection["kind"],
    entries: ResumeEntry[],
  ): void => {
    if (entries.length === 0) return;
    sections.push({ key, title: "", kind, layout: defaultSectionLayout(), entries });
  };
  return {
    headerItems,
    sections,
    nextId,
    field,
    textItem,
    listItem,
    authorsItem,
    bodyTexts,
    period,
    pushItems,
    entry,
    pushEntriesSection,
  };
}
