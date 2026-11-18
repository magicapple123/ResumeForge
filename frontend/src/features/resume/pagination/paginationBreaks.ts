// SPDX-License-Identifier: Apache-2.0
/**
 * 断页的数据层（Q08 / 任务 12）：把「已设置的断页」收集成芯片、单个清除、板块级一键恢复。
 *
 * 断页的落点只有两处（v2 文档模型，与 planner 一致）：
 * - 板块级：`section.layout.start_on_new_page`；
 * - 条目级：`section.entries[j].layout.start_on_new_page / keep_together`（控件在
 *   「本份简历结构」页签，本芯片区只是它的可见汇总）。
 *
 * ## 任务 12：谁能设置，谁才能清除
 *
 * 板块级的 `keep_together` 从来没有渲染端消费（planner 不读板块级 keep_together），
 * 界面上也早已删掉那个开关——但汇总条曾经照样把它列出来并给 ✕，于是出现"面板能清、
 * 却没有任何地方能设"的死字段。现在两个维度按 type 分开：
 * - `SECTION_FLAGS` 只有 `start_on_new_page`（参数页签能设，也能清）；
 * - `ENTRY_FLAGS` 两个都给（结构页签能设，也只能在结构页签清）。
 *
 * ## QW-3：旧版规则显示出来并可清除（2026-11-18 用户拍板）
 *
 * 与上面矛盾的只有一处例外：`section.layout.keep_together` 在**导出端当真**
 * （PDF 逐条预留、DOCX 变整块 `keepNext`），字段又删不掉。用户遇到"这一页莫名被推下去"
 * 时既看不出原因也无法关闭。所以它重新进入汇总条，但标 `legacy: true`：
 * - 只显示 + 单个 ✕ 清除（`patchSectionLayout` 写 false），**不提供设置入口**；
 * - 不进 `SECTION_FLAGS`，因此"恢复自然分页"与 `hasSectionPageBreaks` 都不碰它；
 * - 新建简历不再产生该字段（保持既有口径）。
 *
 * **字段不删**：历史 JSON 里可能已有 `section.layout.keep_together = true`，删字段
 * 会让老文档在下次保存时静默改变形状。
 */
import type { ResumeDocument } from "../../../types/resumeDocument";
import { entryDisplayLabel } from "../document/summarize";
import { patchEntryLayout, patchSectionLayout } from "../layout/entryLayoutModel";

export type PageBreakFlag = "start_on_new_page" | "keep_together";

/** 一条已设置的断页（一个开关一条芯片；同一条目两个开关都给时是两条）。 */
export interface ConfiguredPageBreak {
  /** 稳定 id：`{kind}:{sectionKey}:{entryId}:{flag}`，React key 与测试定位共用。 */
  id: string;
  kind: "section" | "entry";
  sectionKey: string;
  entryId?: string;
  flag: PageBreakFlag;
  /** 点击跳转用的文档路径（板块 = section.key，条目 = section.key.entryId）。 */
  path: string;
  /** 条目显示名（与结构树/条目字段排版同一函数）；板块无此项。 */
  entryLabel?: string;
  /** QW-3：来自旧版本的死字段（当前不可设置，只可清除）。 */
  legacy?: boolean;
}

/** 板块级能设的断页开关：只有「从新页开始」（`keep_together` 从未被渲染端消费）。 */
export const SECTION_FLAGS: readonly PageBreakFlag[] = ["start_on_new_page"];

/** QW-3：旧版本遗留、界面上不再能设置、但导出端仍消费的板块级开关。 */
export const LEGACY_SECTION_FLAGS: readonly PageBreakFlag[] = ["keep_together"];

/** 条目级能设的断页开关：两个都有效（planner 读 `entry.layout.*`）。 */
export const ENTRY_FLAGS: readonly PageBreakFlag[] = ["start_on_new_page", "keep_together"];

/** 扫描文档里所有显式打开的断页开关（隐藏条目也算：它的断页设置在解锁后仍生效）。 */
export function collectPageBreaks(document: ResumeDocument): ConfiguredPageBreak[] {
  const rows: ConfiguredPageBreak[] = [];
  for (const section of document.sections) {
    for (const flag of SECTION_FLAGS) {
      if (!section.layout[flag]) continue;
      rows.push({
        id: `section:${section.key}:${flag}`,
        kind: "section",
        sectionKey: section.key,
        flag,
        path: section.key,
      });
    }
    // QW-3：旧版规则紧随板块级断页之后（同一板块的芯片相邻，便于对照）。
    for (const flag of LEGACY_SECTION_FLAGS) {
      if (!section.layout[flag]) continue;
      rows.push({
        id: `section:${section.key}:${flag}`,
        kind: "section",
        sectionKey: section.key,
        flag,
        path: section.key,
        legacy: true,
      });
    }
    for (const entry of section.entries) {
      if (!entry.id) continue;
      for (const flag of ENTRY_FLAGS) {
        if (!entry.layout[flag]) continue;
        rows.push({
          id: `entry:${section.key}:${entry.id}:${flag}`,
          kind: "entry",
          sectionKey: section.key,
          entryId: entry.id,
          flag,
          path: `${section.key}.${entry.id}`,
          entryLabel: entryDisplayLabel(entry),
        });
      }
    }
  }
  return rows;
}

/** 这条芯片的开关值（清除时只清这一个开关，不动同一条目/板块的另一个开关）。 */
export function clearPageBreak(
  document: ResumeDocument,
  item: ConfiguredPageBreak,
): ResumeDocument {
  if (item.kind === "section") {
    return patchSectionLayout(document, item.sectionKey, { [item.flag]: false });
  }
  if (!item.entryId) return document;
  return patchEntryLayout(document, item.sectionKey, item.entryId, { [item.flag]: false });
}

/** 是否还有板块级断页（决定「恢复自然分页」是否可点）。 */
export function hasSectionPageBreaks(document: ResumeDocument): boolean {
  return document.sections.some((section) =>
    SECTION_FLAGS.some((flag) => Boolean(section.layout[flag])),
  );
}

/**
 * 「恢复自然分页」：只清**板块级** `start_on_new_page`。
 *
 * 条目级断页由结构页签管理（面板上写明）；旧版规则（`section.layout.keep_together`）
 * 由汇总条上的单个 ✕ 清除（QW-3），这里不碰——"一键恢复"不该顺手改掉用户没看见的那一项。
 */
export function restoreSectionPagination(document: ResumeDocument): ResumeDocument {
  if (!hasSectionPageBreaks(document)) return document;
  let next = document;
  for (const section of document.sections) {
    const patch: Partial<Record<PageBreakFlag, boolean>> = {};
    for (const flag of SECTION_FLAGS) if (section.layout[flag]) patch[flag] = false;
    if (Object.keys(patch).length > 0) {
      next = patchSectionLayout(next, section.key, patch);
    }
  }
  return next;
}
