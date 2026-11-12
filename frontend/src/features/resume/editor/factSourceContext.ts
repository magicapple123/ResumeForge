// SPDX-License-Identifier: Apache-2.0
/**
 * 中栏字段 chip 的**事实来源标注上下文**（#24 24E）。
 *
 * ## 为什么用 context 而不是逐层传 prop
 *
 * 徽标要挂在每一个字段 chip 上，而 chip 由 `DocumentEditor → SectionEditor → EntryCard →
 * ItemChip` 四层渲染出来（还有 `renderChip` 这条间接路径）。逐层透传要给四处签名各加一个
 * 参数，而 `DocumentEditor.tsx` 正好贴着 500 行预算——加 prop 就得先删注释。右键菜单
 * （`documentChipMenuContext`）、拖拽（`documentDragContext`）、展开态
 * （`documentExpandContext`）已经是同一套写法，这里保持一致。
 *
 * ## 数据从哪来（不许多发一次请求）
 *
 * `fact_annotations` 在**详情**上（`ResumeDetail.fact_annotations`），宿主
 * `ResumeDetailPreview` 早就取过一次（证据面板 `EvidencePanel` 用的就是它）。
 * 那条链是 `ResumeDetailPreview → ResumeWorkbenchV2 → ResumeWorkbenchV2EditorColumn`，
 * 每一层都只是把同一个数组往下传，**没有任何一层自己发请求**。24E 之前没有这条链，
 * 是因为中栏不需要详情；现在需要的是"同一份数据"，不是"再取一次"。
 *
 * ## 路径怎么对齐
 *
 * 标注里的 `path` 是 v1 内容路径（`summary` / `experience.0.company` /
 * `experience.0.description`，见后端 `grounding_entries.py`），而编辑器里是 v2 文档路径
 * （`{section}.{entryId}.{itemId}`，见 `features/resume/document/paths.ts`）。两者的
 * **板块 key 相同、下标语义相同**，只是条目从下标换成了 id——所以映射靠"下标回填"：
 * 用 v2 路径定位到条目，再算出它在板块里是第几条。
 *
 * 解析不出来（页眉字段、自建板块、v2 文档里没有的条目）就返回 `null` ——
 * **拿不到标注的字段不显示徽标**，绝不摆一个"未知来源"的标签。
 */
import { createContext, useContext } from "react";
import type { FactAnnotation } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { locatePath } from "../document";

/**
 * 空标注表：**模块级常量**（不是每次渲染新建的 `[]`）。
 *
 * 只读宿主 / 无来源的简历都会走到这里。常量能保证 context value 的引用在重渲染之间
 * 不变，`ItemChip`（一屏可能有上百个）不会因为"新的空数组"而全部重渲染。
 */
const NO_ANNOTATIONS: readonly FactAnnotation[] = Object.freeze([]);

/** 当前编辑器的全部事实来源标注；宿主没接线时是空表（= 一个徽标都不渲染）。 */
export const FactSourceContext = createContext<readonly FactAnnotation[]>(NO_ANNOTATIONS);

/** 供宿主（中栏）提供一个稳定引用的空表，避免自己造 `[]`。 */
export const EMPTY_FACT_ANNOTATIONS: readonly FactAnnotation[] = NO_ANNOTATIONS;

/** 读当前编辑器的标注表。 */
export function useFactAnnotations(): readonly FactAnnotation[] {
  return useContext(FactSourceContext);
}

/** `summary` 在 v1 内容里是顶层标量，v2 文档里却是一个 text 板块：单独处理。 */
const SUMMARY_SECTION_KEY = "summary";

/** v2 文档里 text 型 item 在 v1 内容里对应的字段名（后端 grounding 就写 `description`）。 */
const TEXT_ITEM_PATH_KEY = "description";

/**
 * 这条 v2 路径可能对应的标注路径，**按优先级**排列。
 *
 * 第一项是精确匹配（`experience.0.company`），后面是条目级兜底（`experience.0`）：
 * 后端有时只给条目级标注（整条经历锚定到同一段资料），此时把条目级标注显示在这个字段
 * 旁边是**准确的**（它说的就是这个字段所在的那一条），而不是猜。
 */
export function annotationPathCandidates(
  document: ResumeDocument,
  path: string | null | undefined,
): string[] {
  const located = locatePath(document, path);
  if (!located) return [];
  // 页眉字段（姓名 / 电话 / 邮箱…）不在 grounding 的标注范围内：没有徽标。
  if (located.kind === "header") return [];
  if (located.section.key === SUMMARY_SECTION_KEY) return [SUMMARY_SECTION_KEY];
  if (located.kind === "section") return [located.section.key];
  const entryPath = `${located.section.key}.${located.entryIndex}`;
  if (located.kind === "entry") return [entryPath];
  const itemKey =
    located.item.kind === "text" ? TEXT_ITEM_PATH_KEY : (located.item.key ?? TEXT_ITEM_PATH_KEY);
  return [`${entryPath}.${itemKey}`, entryPath];
}

/**
 * 找到这条路径对应的标注（先精确、再条目级兜底）；都没有则 `null`。
 *
 * 同一路径可能有多条标注（不同 origin 的同一处内容），取**第一条**：后端的产出顺序里
 * 它是对该处内容最直接的说明，界面上一颗徽标也只能表达一档来源。
 */
export function resolveFactAnnotation(
  document: ResumeDocument,
  path: string | null | undefined,
  annotations: readonly FactAnnotation[],
): FactAnnotation | null {
  if (annotations.length === 0) return null;
  const candidates = annotationPathCandidates(document, path);
  if (candidates.length === 0) return null;
  for (const candidate of candidates) {
    const found = annotations.find((annotation) => annotation.path === candidate);
    if (found) return found;
  }
  return null;
}
