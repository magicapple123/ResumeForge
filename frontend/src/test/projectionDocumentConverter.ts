// SPDX-License-Identifier: Apache-2.0
/**
 * 测试用的 **v1 ResumeContent → v2 ResumeDocument 转换器**（仅测试夹具使用）。
 *
 * 生产侧唯一的转换在后端 `document_converter.py`（读旧记录时一次性转换）；前端测试不能
 * 复用 Python，所以这里按计划 §7.2 的映射表做一个"够测试用"的最小实现：
 * - 只覆盖夹具会构造的 11 个系统分区 + 自建板块 + 页眉标量；
 * - 位置/格式按 §7.2 的默认口径（title/meta/lead/trail/body）；
 * - id 由调用顺序生成（确定性，便于断言与快照）；
 * - 空值不造块（与生产 converter "文字不丢、空值不造块"一致）。
 *
 * 它不是生产代码：不要从组件里 import；等测试夹具全部切到 v2 直接造数后删除。
 */
import type { ResumeContent } from "../types";
import {
  appendTailSections,
  defaultEntryLayout,
  defaultSectionLayout,
} from "./projectionDocumentTail";
import type {
  AuthorsItem,
  FieldItem,
  HeaderItem,
  ListItem,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
  TextItem,
} from "../types/resumeDocument";

export function v1ContentToV2Document(content: ResumeContent): ResumeDocument {
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

  if (Array.isArray(content.education) && content.education.length > 0) {
    pushEntriesSection(
      "education",
      "entries",
      content.education.map((item) =>
        entry(
          pushItems([
            item.school ? field({ key: "school", value: item.school, placement: "title" }) : null,
            item.major ? field({ key: "major", value: item.major, placement: "title" }) : null,
            item.degree ? field({ key: "degree", value: item.degree, placement: "meta" }) : null,
            period(item.start_date, item.end_date),
            item.gpa ? field({ key: "gpa", value: item.gpa, placement: "lead" }) : null,
            item.courses && item.courses.length > 0
              ? listItem("courses", item.courses, "lead")
              : null,
            item.study_form
              ? field({ key: "study_form", value: item.study_form, placement: "trail" })
              : null,
            item.degree_type
              ? field({ key: "degree_type", value: item.degree_type, placement: "trail" })
              : null,
            item.department
              ? field({ key: "department", value: item.department, placement: "trail" })
              : null,
            item.rank ? field({ key: "rank", value: item.rank, placement: "trail" }) : null,
            item.advisor
              ? field({ key: "advisor", value: item.advisor, placement: "trail" })
              : null,
            item.research_direction
              ? field({
                  key: "research_direction",
                  value: item.research_direction,
                  placement: "trail",
                })
              : null,
            ...bodyTexts(item.achievements),
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.experience) && content.experience.length > 0) {
    pushEntriesSection(
      "experience",
      "entries",
      content.experience.map((item) =>
        entry(
          pushItems([
            item.company
              ? field({ key: "company", value: item.company, placement: "title" })
              : null,
            item.role ? field({ key: "role", value: item.role, placement: "title" }) : null,
            period(item.start_date, item.end_date),
            item.team_size
              ? field({ key: "team_size", value: item.team_size, placement: "trail" })
              : null,
            item.experience_kind
              ? field({
                  key: "experience_kind",
                  value: item.experience_kind,
                  placement: "trail",
                  format: "enum",
                })
              : null,
            ...bodyTexts(item.description),
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.projects) && content.projects.length > 0) {
    pushEntriesSection(
      "projects",
      "entries",
      content.projects.map((item) =>
        entry(
          pushItems([
            item.name ? field({ key: "name", value: item.name, placement: "title" }) : null,
            item.role ? field({ key: "role", value: item.role, placement: "meta" }) : null,
            period(item.start_date, item.end_date),
            item.project_size
              ? field({ key: "project_size", value: item.project_size, placement: "trail" })
              : null,
            item.tech_stack && item.tech_stack.length > 0
              ? listItem("tech_stack", item.tech_stack, "trail", "comma")
              : null,
            item.artifact_type
              ? field({ key: "artifact_type", value: item.artifact_type, placement: "trail" })
              : null,
            ...bodyTexts(item.description),
            ...bodyTexts(item.highlights),
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.campus_experience) && content.campus_experience.length > 0) {
    pushEntriesSection(
      "campus_experience",
      "entries",
      content.campus_experience.map((item) =>
        entry(
          pushItems([
            item.organization
              ? field({ key: "organization", value: item.organization, placement: "title" })
              : null,
            item.role ? field({ key: "role", value: item.role, placement: "title" }) : null,
            period(item.start_date, item.end_date),
            item.activity_type
              ? field({ key: "activity_type", value: item.activity_type, placement: "trail" })
              : null,
            ...bodyTexts(item.description),
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.awards) && content.awards.length > 0) {
    pushEntriesSection(
      "awards",
      "entries",
      content.awards.map((item) =>
        entry(
          pushItems([
            item.name ? field({ key: "name", value: item.name, placement: "title" }) : null,
            item.date
              ? field({ key: "date", value: item.date, placement: "meta", format: "date" })
              : null,
            item.issuer ? field({ key: "issuer", value: item.issuer, placement: "trail" }) : null,
            item.level ? field({ key: "level", value: item.level, placement: "trail" }) : null,
            item.ratio ? field({ key: "ratio", value: item.ratio, placement: "trail" }) : null,
            item.description ? textItem(item.description, "paragraph") : null,
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.publications) && content.publications.length > 0) {
    pushEntriesSection(
      "publications",
      "entries",
      content.publications.map((item) =>
        entry(
          pushItems([
            item.title ? field({ key: "title", value: item.title, placement: "title" }) : null,
            item.venue ? field({ key: "venue", value: item.venue, placement: "meta" }) : null,
            item.year ? field({ key: "year", value: item.year, placement: "meta" }) : null,
            item.status
              ? field({ key: "status", value: item.status, placement: "meta", format: "enum" })
              : null,
            item.authors && item.authors.length > 0
              ? authorsItem(
                  "authors",
                  item.authors.map((author) => author.name),
                  "trail",
                )
              : null,
            item.outcome_type
              ? field({ key: "outcome_type", value: item.outcome_type, placement: "trail" })
              : null,
            item.my_rank
              ? field({ key: "my_rank", value: item.my_rank, placement: "trail" })
              : null,
            item.volume_pages
              ? field({ key: "volume_pages", value: item.volume_pages, placement: "trail" })
              : null,
            item.doi ? field({ key: "doi", value: item.doi, placement: "trail" }) : null,
            item.url
              ? field({ key: "url", value: item.url, placement: "trail", format: "url" })
              : null,
            item.note ? textItem(item.note, "paragraph") : null,
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.research_projects) && content.research_projects.length > 0) {
    pushEntriesSection(
      "research_projects",
      "entries",
      content.research_projects.map((item) =>
        entry(
          pushItems([
            item.name ? field({ key: "name", value: item.name, placement: "title" }) : null,
            item.role ? field({ key: "role", value: item.role, placement: "title" }) : null,
            item.organization
              ? field({ key: "organization", value: item.organization, placement: "meta" })
              : null,
            period(item.start_date, item.end_date),
            item.level ? field({ key: "level", value: item.level, placement: "trail" }) : null,
            item.funding
              ? field({ key: "funding", value: item.funding, placement: "trail" })
              : null,
            ...bodyTexts(item.description),
            ...bodyTexts(item.outcomes),
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.patents) && content.patents.length > 0) {
    pushEntriesSection(
      "patents",
      "entries",
      content.patents.map((item) =>
        entry(
          pushItems([
            item.title ? field({ key: "title", value: item.title, placement: "title" }) : null,
            item.patent_number
              ? field({ key: "patent_number", value: item.patent_number, placement: "meta" })
              : null,
            item.country ? field({ key: "country", value: item.country, placement: "meta" }) : null,
            item.status
              ? field({ key: "status", value: item.status, placement: "meta", format: "enum" })
              : null,
            item.inventors && item.inventors.length > 0
              ? authorsItem(
                  "inventors",
                  item.inventors.map((author) => author.name),
                  "trail",
                )
              : null,
            item.filed_date
              ? field({
                  key: "filed_date",
                  value: item.filed_date,
                  placement: "trail",
                  format: "date",
                })
              : null,
            item.granted_date
              ? field({
                  key: "granted_date",
                  value: item.granted_date,
                  placement: "trail",
                  format: "date",
                })
              : null,
            item.url
              ? field({ key: "url", value: item.url, placement: "trail", format: "url" })
              : null,
          ]),
        ),
      ),
    );
  }

  if (Array.isArray(content.credentials) && content.credentials.length > 0) {
    pushEntriesSection(
      "credentials",
      "entries",
      content.credentials.map((item) =>
        entry(
          pushItems([
            item.name ? field({ key: "name", value: item.name, placement: "title" }) : null,
            item.issuer ? field({ key: "issuer", value: item.issuer, placement: "meta" }) : null,
            item.status
              ? field({ key: "status", value: item.status, placement: "meta", format: "enum" })
              : null,
            item.credential_type
              ? field({ key: "credential_type", value: item.credential_type, placement: "trail" })
              : null,
            item.issue_date
              ? field({
                  key: "issue_date",
                  value: item.issue_date,
                  placement: "trail",
                  format: "date",
                })
              : null,
            item.expiry_date
              ? field({
                  key: "expiry_date",
                  value: item.expiry_date,
                  placement: "trail",
                  format: "date",
                })
              : null,
            item.verify_url
              ? field({
                  key: "verify_url",
                  value: item.verify_url,
                  placement: "trail",
                  format: "url",
                })
              : null,
            item.note ? field({ key: "note", value: item.note, placement: "trail" }) : null,
          ]),
        ),
      ),
    );
  }

  appendTailSections(
    content,
    { field, textItem, authorsItem, entry, pushItems, pushEntriesSection, nextId },
    sections,
  );

  return {
    version: 2,
    language: "zh-CN",
    header: { items: headerItems, contact_breaks: [] },
    sections,
  };
}

/** 分区默认 layout（测试断言需要时引用同一份口径）。 */
export {
  defaultEntryLayout,
  defaultSectionLayout,
  sectionLayoutOf,
} from "./projectionDocumentTail";
