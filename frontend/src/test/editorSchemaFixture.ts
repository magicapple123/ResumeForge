// SPDX-License-Identifier: Apache-2.0
/**
 * 测试用的编辑器视图夹具（F10）：按"可见属性名"生成最小 `EditorSchemaOut`。
 *
 * 只给测试用（不放生产路径）：真实 schema 由服务端从消费快照生成（projection_views.editor_schema），
 * 前端只消费。这里显式列出 attrs，是为了让用例一眼看出"这个方案里哪些字段可见"。
 */
import type {
  EditorFieldOut,
  EditorSchemaOut,
  EditorSectionOut,
} from "../features/profile-library/types";

/** 一个可见字段；`resumeAttr` 缺省与 key 相同。 */
export function editorField(key: string, resumeAttr: string | null = key): EditorFieldOut {
  return {
    field_id: `test.${key}`,
    key,
    label: key,
    field_type: "single_line",
    resume_attr: resumeAttr,
  };
}

/** 一个可见板块；attrs 是可见的 ResumeContent 属性名（按定义顺序）。 */
export function editorSection(
  sectionKey: string,
  sectionName: string,
  attrs: string[],
  overrides: Partial<EditorSectionOut> = {},
): EditorSectionOut {
  return {
    section_key: sectionKey,
    section_name: sectionName,
    form: "multi",
    resume_field: sectionKey,
    material_only: false,
    fields: attrs.map((attr) => editorField(attr, attr)),
    ...overrides,
  };
}

/** 一份最小编辑器视图。 */
export function editorSchema(...sections: EditorSectionOut[]): EditorSchemaOut {
  return { sections, workspace_revision: 1 };
}
