// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器视图（F10 / R-82）：把「当前方案投影」或「已保存简历的快照」折成编辑器用的
 * 板块清单 + 字段可见性。
 *
 * 为什么需要它：新简历必须按当前方案显示板块与字段；已保存简历必须按**创建时冻结**的视图
 * 显示——方案后来改了，旧简历不跟着变（用户口径 2026-10-26：只影响此后新增的简历）。
 * 两种来源折成同一个形状（EditorView），页签与字段过滤因此只有一份实现。
 */
import type { EditorSchemaOut, EditorView } from "../profile-library/types";
import type { ResumeProfileUsageSnapshot } from "../../types/resumeProfileUsage";
import type { ProfileFillSources } from "./profileFillOptions";

/** 从 schema 生成视图；没有 sections 时返回 undefined（= 旧行为、不过滤）。 */
export function editorViewFromSchema(
  schema: EditorSchemaOut | null | undefined,
): EditorView | undefined {
  const sections = schema?.sections ?? [];
  if (sections.length === 0) return undefined;
  return {
    sections: sections.map((section) => ({ key: section.section_key, name: section.section_name })),
    schema: schema ?? undefined,
  };
}

/**
 * 编辑**已保存**简历时，把快照视图叠到资料候选上（候选仍来自当前方案，只有视图冻结）。
 *
 * - 有 editor_schema（本轮起新建/生成的简历）→ 板块与字段都按快照；
 * - 只有 participating（v4 及以前创建、快照里还没有字段信息）→ 板块按快照、字段不过滤；
 * - 完全没有快照（更老的简历）→ 原样返回，退回"按当前方案过滤页签"的既有行为。
 */
export function withSavedResumeEditorView(
  sources: ProfileFillSources,
  usage: ResumeProfileUsageSnapshot | null | undefined,
): ProfileFillSources {
  if (!usage) {
    // 更老的简历完全没有快照：**不要**把当前方案的视图套上去（那正是"已保存简历受方案
    // 修改影响"）。页签退回既有的参与清单过滤，字段保持全部可见（与改动前一致）。
    return { ...sources, editorView: undefined };
  }
  const fromSchema = editorViewFromSchema(usage.editor_schema);
  if (fromSchema) return { ...sources, editorView: fromSchema };
  const sections = (usage.participating ?? [])
    .map((item) => ({ key: item.key, name: item.name }))
    .filter((item) => item.key);
  if (sections.length === 0) return { ...sources, editorView: undefined };
  return { ...sources, editorView: { sections } };
}
