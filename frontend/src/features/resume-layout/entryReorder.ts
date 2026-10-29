// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」面板里的**条目上移 / 下移**：把一次点击翻译成大纲的结构命令。
 *
 * ## 为什么要复用大纲的 `reorder-entry`
 *
 * 制作台早就有条目拖拽排序（`OutlineCommand` 的 `reorder-entry`，命令执行器在
 * `features/resume-outline/commands.ts`），但入口只在「文档大纲」页签里。用户在「排版参数」
 * 里调某一条的字段排版时，想顺手把这条往前挪一格，不该被要求先换页签。这里**不新造一条
 * 排序链路**：点击 → 一条同形状的 `reorder-entry` 命令 → 宿主原有的 `onOutlineCommand`
 * （同一份命令执行器、同一份历史、同一份保存链路）。搬运逻辑与大纲拖拽完全一致，
 * 两个入口不存在"拖拽和按钮排出来的结果不一样"的可能。
 *
 * ## `toIndex` 的口径（照抄大纲，不自己发明）
 *
 * `reorder-entry.toIndex` 是**移动后的最终下标**（0-based，基准模型里的下标，见
 * `components/resume/outline/outlineDropTargets.ts::entryIndexInModel` 与
 * `features/resume-outline/types.ts`）。命令执行器按 `objectId` 找到当前下标再移动，
 * 所以"上移一格 = `index - 1`"这种基准下标算法是安全且幂等的——不需要先把前面的移动算进去。
 *
 * ## 为什么只在六个分区可用
 *
 * 大纲的条目分组只覆盖 `EntryField`（education / experience / campus_experience / projects /
 * skills / awards）；论文与科研项目没有大纲分组，也就没有 `reorder-entry` 的落点。这类分区
 * 的按钮直接**不渲染**（`isReorderableSection`），而不是渲染一个永远禁用、还解释不清的控件。
 *
 * 本文件是纯函数（无 React、无副作用），面板与宿主都只读它，单测直接测这里。
 */
import type { ResumeContent } from "../../types";
import type { EntryField } from "../resume-document/types";
import type { OutlineCommand } from "../resume-outline/types";
import type { EntryFieldLayoutOption } from "./entryOptions";
import type { FieldLayoutSection } from "./fieldLayout";

/** 大纲里有分组、因而可排序的条目分区（= `EntryField` 的六个）。 */
const REORDERABLE_SECTIONS: readonly EntryField[] = [
  "education",
  "experience",
  "campus_experience",
  "projects",
  "skills",
  "awards",
];

/** 该分区能不能上移 / 下移（论文、科研项目没有大纲分组 → 不能）。 */
export function isReorderableSection(section: FieldLayoutSection): boolean {
  return (REORDERABLE_SECTIONS as readonly string[]).includes(section);
}

/**
 * 一次上移 / 下移点出来的结构命令；不可动时返回 `null`（调用方据此不发命令）。
 *
 * Args:
 *   section: 当前分区（面板顶部的分区下拉）。
 *   options: 该分区的条目选项，**顺序即正文数组顺序**（`entryFieldLayoutOptions` 逐条
 *     遍历数组产出，所以下标就是基准模型里的下标）。
 *   entryId: 被移动条目的稳定 id（不是下标——排序后下标会变）。
 *   direction: `-1` = 上移一格，`1` = 下移一格。
 *
 * Returns:
 *   `{type: "reorder-entry", field, objectId, toIndex}`；首项上移 / 末项下移 / 该分区不可
 *   排序 / id 不在清单里时返回 `null`（按钮已按同一套边界禁用，这里是第二道防线）。
 */
export function moveEntryCommand(
  section: FieldLayoutSection,
  options: readonly EntryFieldLayoutOption[] | undefined,
  entryId: string,
  direction: -1 | 1,
): OutlineCommand | null {
  if (!isReorderableSection(section) || !options || !entryId) return null;
  const index = options.findIndex((option) => option.id === entryId);
  if (index < 0) return null;
  const toIndex = index + direction;
  if (toIndex < 0 || toIndex >= options.length) return null;
  return {
    type: "reorder-entry",
    field: section as EntryField,
    objectId: entryId,
    toIndex,
  };
}

/**
 * 宿主的 `onReorderEntry` 实现：把面板报上来的（分区, 条目 id, 方向）变成一条结构命令，
 * 交给宿主的 `onOutlineCommand`。
 *
 * **为什么做成工厂而不是让宿主内联 5 行**：`WorkbenchParamsColumn` 贴着 500 行预算，
 * 而这段胶水（取该分区的条目清单 → 造命令 → 没有正文就丢掉）与 W4 的排版逻辑无关。
 * 一个工厂调用就把它收在一行里，逻辑仍然只有一份、可单测。
 *
 * Args:
 *   options: 每个分区的条目选项（宿主那份 `entryFieldLayoutOptions(...)` 的结果）。
 *   dispatch: 宿主的 `onOutlineCommand`；不传 = 只读宿主，什么都不发。
 *   baseContent: 命令作用在**哪一版**正文上（宿主传 `draftContent ?? content`）：
 *     没有正文可改时同样什么都不发（而不是发一条空命令）。
 *
 * Returns:
 *   可直接传给面板 `onReorderEntry` 的回调（越界 / 不可排序 / 无正文时静默不发）。
 */
export function entryMoveHandler(
  options: Partial<Record<FieldLayoutSection, EntryFieldLayoutOption[]>> | null | undefined,
  dispatch: ((command: OutlineCommand, baseContent: ResumeContent) => void) | undefined,
  baseContent: ResumeContent | null | undefined,
): (section: FieldLayoutSection, entryId: string, direction: -1 | 1) => void {
  return (section, entryId, direction) => {
    const command = moveEntryCommand(section, options?.[section], entryId, direction);
    if (command && baseContent) dispatch?.(command, baseContent);
  };
}
