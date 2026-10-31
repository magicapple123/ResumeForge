// SPDX-License-Identifier: Apache-2.0
/**
 * v2 纯函数测试的共享夹具（不是测试文件：不在这里写断言）。
 *
 * 只构造"最小但覆盖三种 kind"的文档；具体用例自己改字段，避免每个文件抄一份 builder。
 */
import type {
  AuthorsItem,
  FieldItem,
  ListItem,
  ResumeDocument,
  ResumeEntry,
  ResumeSection,
  TextItem,
} from "../../types/resumeDocument";
import { defaultEntryLayout, defaultSectionLayout, emptyDocument } from "./defaults";

/** 确定性 id 工厂：`ob_00000001` 这种 11 位，满足 OBJECT_ID_PATTERN。 */
export function createIdFactory(prefix = "ob_"): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}${String(next).padStart(8, "0")}`;
  };
}

export function fieldItem(overrides: Partial<FieldItem> = {}): FieldItem {
  return {
    kind: "field",
    id: "ob_field001",
    key: "school",
    label: "",
    value: "Tsinghua University",
    placement: "title",
    format: "text",
    wrap: "none",
    show_label: false,
    solo: false,
    source: null,
    body_style: "bullet",
    ...overrides,
  };
}

export function listItem(overrides: Partial<ListItem> = {}): ListItem {
  return {
    kind: "list",
    id: "ob_list0001",
    key: "courses",
    label: "",
    values: ["Data Structures", "Operating Systems"],
    placement: "lead",
    join: "semicolon",
    show_label: true,
    solo: false,
    body_style: "bullet",
    ...overrides,
  };
}

export function authorsItem(overrides: Partial<AuthorsItem> = {}): AuthorsItem {
  return {
    kind: "authors",
    id: "ob_auth0001",
    key: "authors",
    label: "",
    authors: [{ name: "Zhang San", is_self: true, corresponding: false }],
    placement: "trail",
    show_label: false,
    solo: false,
    ...overrides,
  };
}

export function textItem(overrides: Partial<TextItem> = {}): TextItem {
  return {
    kind: "text",
    id: "ob_text0001",
    style: "bullet",
    text: "Won first prize",
    hidden: false,
    ...overrides,
  };
}

export function entry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    id: "ob_entry001",
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: defaultEntryLayout(),
    items: [fieldItem()],
    ...overrides,
  };
}

export function section(overrides: Partial<ResumeSection> = {}): ResumeSection {
  return {
    key: "education",
    title: "",
    kind: "entries",
    layout: defaultSectionLayout(),
    entries: [entry()],
    ...overrides,
  };
}

/** 一份两板块文档：education（field/list/authors/text 齐全）+ summary（text kind）。 */
export function makeDocument(overrides: Partial<ResumeDocument> = {}): ResumeDocument {
  return {
    ...emptyDocument(),
    header: {
      items: [
        {
          kind: "field",
          id: "ob_head0001",
          key: "name",
          label: "",
          value: "Li Si",
          placement: "name",
          format: "text",
        },
        {
          kind: "field",
          id: "ob_head0002",
          key: "phone",
          label: "",
          value: "13800000000",
          placement: "contact",
          format: "text",
        },
      ],
      contact_breaks: [],
    },
    sections: [
      section({
        entries: [
          entry({
            id: "ob_entry001",
            items: [
              fieldItem({
                id: "ob_item0001",
                key: "school",
                placement: "title",
                value: "Tsinghua University",
              }),
              fieldItem({
                id: "ob_item0002",
                key: "major",
                placement: "title",
                value: "Computer Science",
              }),
              fieldItem({ id: "ob_item0003", key: "degree", placement: "meta", value: "Bachelor" }),
              listItem({ id: "ob_item0004", placement: "lead" }),
              fieldItem({ id: "ob_item0005", key: "gpa", placement: "lead", value: "3.9/4.0" }),
              textItem({ id: "ob_item0006", text: "Won a scholarship" }),
            ],
          }),
          entry({
            id: "ob_entry002",
            items: [
              fieldItem({
                id: "ob_item0007",
                key: "school",
                placement: "title",
                value: "Peking University",
              }),
              fieldItem({
                id: "ob_item0008",
                key: "gpa",
                placement: "hidden",
                value: "3.8/4.0",
              }),
            ],
          }),
        ],
      }),
      section({
        key: "summary",
        kind: "text",
        entries: [
          entry({
            id: "ob_entry003",
            items: [
              textItem({
                id: "ob_item0009",
                style: "paragraph",
                text: "Personal summary paragraph",
              }),
            ],
          }),
        ],
      }),
    ],
    ...overrides,
  };
}
