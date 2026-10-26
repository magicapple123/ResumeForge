// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器「板块/字段可见性」上下文（F10）：由 `ResumeEditorPanel` 用宿主的编辑器视图提供，
 * 各分区编辑器据此隐藏当前方案看不见的字段。
 *
 * 为什么用上下文：字段分散在教育/经历/科研等十几个组件里，逐层透传 `show()` 会让所有中间
 * 组件都长出一个与它们无关的参数（与 `ProfileFillProvider` 同一取舍）。
 *
 * 三条规则：
 * 1. 没有 schema（旧简历/旧快照）→ 全部显示（与改动前逐字一致）；
 * 2. 本分区不在 schema 里（正文里仍保留的页签）→ 全部显示，否则用户没法改已有内容；
 * 3. 字段在正文里已有值 → 即使不在可见字段里也显示，保证一次保存不会把隐藏值抹掉。
 */
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { EditorSchemaOut, EditorSectionOut } from "../../features/profile-library/types";
import type { ResumeContent } from "../../types";

interface EditorFieldContextValue {
  schema?: EditorSchemaOut;
  content?: ResumeContent | null;
}

const EditorFieldContext = createContext<EditorFieldContextValue | null>(null);
const EMPTY_SECTIONS: EditorSectionOut[] = [];

interface ProviderProps {
  schema?: EditorSchemaOut;
  content?: ResumeContent | null;
  children: ReactNode;
}

export function EditorFieldProvider({ schema, content, children }: ProviderProps) {
  const value = useMemo<EditorFieldContextValue | null>(
    () => (schema ? { schema, content } : null),
    [schema, content],
  );
  return <EditorFieldContext.Provider value={value}>{children}</EditorFieldContext.Provider>;
}

/** 这一条正文里该字段有没有非空值（"有值就保留输入框"判据）。 */
function hasContentValue(
  content: ResumeContent | null | undefined,
  section: EditorSectionOut,
  attr: string,
): boolean {
  if (!content) return false;
  if (section.resume_field) {
    const list = (content as unknown as Record<string, unknown>)[section.resume_field];
    return (
      Array.isArray(list) &&
      list.some((item) => {
        if (item === null || typeof item !== "object") return false;
        const value = (item as Record<string, unknown>)[attr];
        if (typeof value === "string") return value.trim() !== "";
        return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
      })
    );
  }
  const scalar = (content as unknown as Record<string, unknown>)[attr];
  if (typeof scalar === "string") return scalar.trim() !== "";
  return scalar !== undefined && scalar !== null;
}

export interface EditorFieldVisibility {
  /** 这个字段要不要显示；无 schema / 分区不在 schema 时恒为 true。 */
  show: (attr: string) => boolean;
}

/**
 * 某分区的字段可见性。
 *
 * `basic_info` 与 `summary` 可以一起传（两者都落在「基本信息」页签）。
 */
export function useEditorFieldVisibility(...sectionKeys: string[]): EditorFieldVisibility {
  const context = useContext(EditorFieldContext);
  const keySignature = sectionKeys.join("|");
  return useMemo(() => {
    const schema = context?.schema;
    if (!schema) return { show: () => true };
    const wanted = new Set(keySignature.split("|").filter(Boolean));
    const sections = schema.sections.filter((section) => wanted.has(section.section_key));
    if (sections.length === 0) return { show: () => true };
    const attrs = new Set<string>();
    for (const section of sections) {
      for (const field of section.fields) {
        if (field.resume_attr) attrs.add(field.resume_attr);
      }
    }
    return {
      show: (attr: string) =>
        attrs.has(attr) ||
        sections.some((section) => hasContentValue(context.content, section, attr)),
    };
  }, [context, keySignature]);
}

/** 自建板块视图（`CustomSectionsEditor` 用）：没有 schema 时为空数组。 */
export function useEditorSchemaSections(): EditorSectionOut[] {
  const context = useContext(EditorFieldContext);
  return context?.schema?.sections ?? EMPTY_SECTIONS;
}
