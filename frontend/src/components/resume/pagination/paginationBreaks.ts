// SPDX-License-Identifier: Apache-2.0
/**
 * 分页面板的数据层（Q08）：把「已设置的断页」收集成芯片、单个清除、板块级一键恢复。
 *
 * 断页的落点只有两处（v2 文档模型，与 planner 一致）：
 * - 板块级：`section.layout.start_on_new_page / keep_together`；
 * - 条目级：`section.entries[j].layout.start_on_new_page / keep_together`（Q08 起条目级
 *   控件挪进「本份简历结构」页签，本芯片区仍是它的可见汇总）。
 *
 * 面板只把新文档交给宿主（历史/保存由工作台负责），所以这里全部是纯函数、不改入参。
 */
import type { ResumeDocument } from "../../../types/resumeDocument";
import { entryDisplayLabel } from "../../../features/resume-document/summarize";
import {
  patchEntryLayout,
  patchSectionLayout,
} from "../../../features/resume-layout/entryLayoutModel";

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
}

const FLAGS: readonly PageBreakFlag[] = ["start_on_new_page", "keep_together"];

/** 扫描文档里所有显式打开的断页开关（隐藏条目也算：它的断页设置在解锁后仍生效）。 */
export function collectPageBreaks(document: ResumeDocument): ConfiguredPageBreak[] {
  const rows: ConfiguredPageBreak[] = [];
  for (const section of document.sections) {
    for (const flag of FLAGS) {
      if (!section.layout[flag]) continue;
      rows.push({
        id: `section:${section.key}:${flag}`,
        kind: "section",
        sectionKey: section.key,
        flag,
        path: section.key,
      });
    }
    for (const entry of section.entries) {
      if (!entry.id) continue;
      for (const flag of FLAGS) {
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
  return document.sections.some((section) => FLAGS.some((flag) => Boolean(section.layout[flag])));
}

/** 「恢复自然分页」：清掉**全部板块级**断页；条目级断页不受影响（面板上有这句说明）。 */
export function restoreSectionPagination(document: ResumeDocument): ResumeDocument {
  if (!hasSectionPageBreaks(document)) return document;
  let next = document;
  for (const section of document.sections) {
    const patch: Partial<Record<PageBreakFlag, boolean>> = {};
    for (const flag of FLAGS) if (section.layout[flag]) patch[flag] = false;
    if (Object.keys(patch).length > 0) {
      next = patchSectionLayout(next, section.key, patch);
    }
  }
  return next;
}
