// SPDX-License-Identifier: Apache-2.0
/**
 * 测试夹具转换器的尾部区块（skills/languages/summary/自建板块）。
 *
 * 从 projectionDocumentConverter 拆出以满足 500 行预算；行为与主转换器共用同一批构造器
 * （由调用方注入），保证 id 顺序/位置口径不变。
 */
import type { ResumeContent } from "../types";
import type {
  AuthorsItem,
  EntryLayout,
  FieldItem,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
  SectionLayout,
  TextItem,
} from "../types/resumeDocument";

export interface TailBuilders {
  field(input: {
    key: string;
    value?: string;
    placement: FieldItem["placement"];
    format?: FieldItem["format"];
    wrap?: FieldItem["wrap"];
    showLabel?: boolean;
  }): FieldItem;
  textItem(text: string, style?: TextItem["style"]): TextItem;
  authorsItem(
    key: string,
    names: string[] | undefined,
    placement: AuthorsItem["placement"],
  ): AuthorsItem;
  pushItems(items: (ResumeItem | null)[]): ResumeItem[];
  entry(items: ResumeItem[], id?: string): ResumeEntry;
  pushEntriesSection(key: string, kind: ResumeSection["kind"], entries: ResumeEntry[]): void;
  nextId(prefix: string): string;
}

/** 分区/条目 layout 默认值（与主转换器同一份口径）。 */
export function defaultSectionLayout(): SectionLayout {
  return {
    columns: 1,
    align: "equal",
    gap: null,
    hide_title: false,
    keep_together: false,
    start_on_new_page: false,
    title_override: "",
  };
}

export function defaultEntryLayout(): EntryLayout {
  return { head: "split", columns: null, align: null, gap: null };
}

/** 从 v1 分区布局字段映射 v2 SectionLayout。 */
export function sectionLayoutOf(
  entry: { columns?: number; align?: "equal" | "flow"; gap?: number | null } | undefined,
): SectionLayout {
  const layout = defaultSectionLayout();
  if (!entry) return layout;
  if (entry.columns === 2 || entry.columns === 3) layout.columns = entry.columns;
  if (entry.align === "flow" || entry.align === "equal") layout.align = entry.align;
  if (typeof entry.gap === "number") layout.gap = entry.gap;
  return layout;
}

export function appendTailSections(
  content: ResumeContent,
  b: TailBuilders,
  sections: ResumeSection[],
): void {
  if (Array.isArray(content.skills) && content.skills.length > 0) {
    b.pushEntriesSection(
      "skills",
      "inline",
      content.skills.map((item) =>
        b.entry(
          b.pushItems([
            item.category
              ? b.field({ key: "category", value: item.category, placement: "trail" })
              : null,
            item.name ? b.field({ key: "name", value: item.name, placement: "body" }) : null,
            item.level
              ? b.field({ key: "level", value: item.level, placement: "body", wrap: "paren" })
              : null,
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.languages) && content.languages.length > 0) {
    b.pushEntriesSection(
      "languages",
      "inline",
      content.languages.map((item) =>
        b.entry(
          b.pushItems([
            item.name ? b.field({ key: "name", value: item.name, placement: "body" }) : null,
            item.level
              ? b.field({ key: "level", value: item.level, placement: "body", wrap: "paren" })
              : null,
            item.certificate
              ? b.field({
                  key: "certificate",
                  value: item.certificate,
                  placement: "body",
                  wrap: "paren",
                })
              : null,
            item.score
              ? b.field({ key: "score", value: item.score, placement: "body", wrap: "paren" })
              : null,
            item.obtained_at
              ? b.field({
                  key: "obtained_at",
                  value: item.obtained_at,
                  placement: "trail",
                  format: "date",
                })
              : null,
          ]),
        ),
      ),
    );
  }

  const summary = (content.summary ?? "").trim();
  if (summary) {
    b.pushEntriesSection("summary", "text", [b.entry([b.textItem(summary, "paragraph")])]);
  }

  if (Array.isArray(content.custom_sections) && content.custom_sections.length > 0) {
    for (const custom of content.custom_sections) {
      const key = custom.key || `custom:${b.nextId("custom")}`;
      const entries = (custom.entries ?? []).map((item) => {
        const items: ResumeItem[] = [];
        const body = (item.text ?? "").trim();
        if (body) items.push(b.textItem(body, "paragraph"));
        (item.lines ?? []).forEach((line, lineIndex) => {
          const value = (line.value ?? "").trim();
          if (!value) return;
          items.push({
            ...b.field({
              key: `custom:${key.replace(/^custom:/, "")}_${lineIndex}`,
              value,
              placement: "trail",
            }),
            label: (line.label ?? "").trim(),
          });
        });
        return b.entry(items);
      });
      sections.push({
        key,
        title: custom.title ?? "",
        kind: "entries",
        layout: defaultSectionLayout(),
        entries,
      });
    }
  }

  return;
}
