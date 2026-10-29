// SPDX-License-Identifier: Apache-2.0
/**
 * 结构变化后的**路径重映射**（W06 验收的硬要求：把第二个项目移到第一位后，加粗 overlay、
 * 事实来源标注、局部排版、选中位置都必须跟着原对象走，不能留在旧下标上绑到别的条目）。
 *
 * ## 为什么需要它
 *
 * 加粗 overlay 的键是 `features/resume/useRichTextOverrides.ts` 里的**下标路径**
 * （`experience.1.description.0`），事实标注的 `path` 也一样。排序不换 id，但下标会变；
 * 只把数组挪一下、不改这些键，`experience.1.*` 就会指向"现在排在第 2 位的那条"——也就是
 * 另一个对象。所以命令层在 `before → after` 之后必须调用本模块，把旧键换成新键。
 *
 * ## 为什么按 id 对齐而不是按位置推
 *
 * 复制条目时新旧条目共存，按下标推会得出"两条都映射到彼此"的荒谬结果；按 id 对齐后，
 * 复制出来的新条目**不在映射里**（它的 overlay 本来就该是空的），被移走的旧条目稳定映射到
 * 新下标。要点同理：`point_ids` 与文本数组是同步移动的（`commands.ts` 保证）。
 *
 * ## 边界
 *
 * - 只映射**模板里真实存在的路径**：条目的字符串标量字段 + 六类条目声明的要点数组；
 *   `hidden`/`lock_*` 这类布尔、`point_ids` 这类对象不产生路径。
 * - 映射是"旧路径 → 新路径"的 `Map`；没被移动的条目也在映射里（旧新下标相同），
 *   这样调用方不需要判断"这条到底动没动"。
 */
import type { ResumeContent } from "../../types/resume";
import { ENTRY_POINT_FIELDS } from "../resume-document/types";
import { entriesOf, entryIdOf, pointIdsOf } from "./model";
import type { EntryField } from "./types";

/** 旧路径 → 新路径；键与值都是 `data-resume-path` 形态（`experience.1.description.0`）。 */
export type PathRemap = Map<string, string>;

/**
 * 对比两份内容，产出路径映射。
 *
 * 入参必须是"同一条命令执行前后"的两份内容（id 相同、只是顺序/标志变化）；其它场景
 * （比如换了一份简历）调用它没有意义，返回的映射也只是按 id 能对上的那部分。
 */
export function buildPathRemap(before: ResumeContent, after: ResumeContent): PathRemap {
  const remap: PathRemap = new Map();
  for (const field of Object.keys(ENTRY_POINT_FIELDS) as EntryField[]) {
    const beforeEntries = entriesOf(before, field);
    const afterEntries = entriesOf(after, field);
    if (beforeEntries.length === 0 || afterEntries.length === 0) continue;
    const afterIndexById = new Map<string, number>();
    afterEntries.forEach((entry, index) => {
      const objectId = entryIdOf(entry);
      if (objectId) afterIndexById.set(objectId, index);
    });
    beforeEntries.forEach((entry, oldIndex) => {
      const objectId = entryIdOf(entry);
      if (!objectId) return;
      const newIndex = afterIndexById.get(objectId);
      if (newIndex === undefined) return;
      // ① 条目的字符串标量字段（公司名、日期、角色…）：模板给它们都打了 data-resume-path。
      for (const [key, value] of Object.entries(entry)) {
        if (key === "id" || typeof value !== "string") continue;
        remap.set(`${field}.${oldIndex}.${key}`, `${field}.${newIndex}.${key}`);
      }
      // ② 要点：按稳定 id 对齐。**先在整个条目里**给每个 id 找到它的新位置，再回填旧路径——
      // 要点跨字段搬移（`courses` → `achievements`）之后 id 换了字段，只在同一个字段里找会把
      // 这条要点的加粗/来源标注留在一个已经不存在的路径上（`education.0.courses.0`）。
      const afterEntry = afterEntries[newIndex];
      const newPointPathById = new Map<string, string>();
      for (const pointField of ENTRY_POINT_FIELDS[field]) {
        pointIdsOf(afterEntry, pointField).forEach((pointId, index) => {
          newPointPathById.set(pointId, `${pointField}.${index}`);
        });
      }
      for (const pointField of ENTRY_POINT_FIELDS[field]) {
        pointIdsOf(entry, pointField).forEach((pointId, oldPointIndex) => {
          const target = newPointPathById.get(pointId);
          if (target === undefined) return;
          remap.set(
            `${field}.${oldIndex}.${pointField}.${oldPointIndex}`,
            `${field}.${newIndex}.${target}`,
          );
        });
      }
    });
  }
  return remap;
}

/**
 * 按映射改键，返回**新对象**（不改入参）。
 *
 * 不在映射里的键原样保留：结构命令不会删除对象，只有"复制出来的新条目"没有旧键可映射；
 * 那些键（如果存在）说明是别的机制写进去的，不归结构命令处理。
 */
export function remapPathMap<T>(record: Record<string, T>, remap: PathRemap): Record<string, T> {
  if (remap.size === 0) return record;
  const next: Record<string, T> = {};
  let changed = false;
  for (const [path, value] of Object.entries(record)) {
    const target = remap.get(path) ?? path;
    if (target !== path) changed = true;
    next[target] = value;
  }
  return changed ? next : record;
}

/**
 * 事实标注（以及任何"带 path 的数组"）的路径重映射。
 *
 * `object_id` / `point_id` 一律不动：它们本来就是稳定身份，W12 起后端按 id 现算路径；
 * 这里只是把旧的 `path` 字段同步到新下标，让 W12 落地前的旧标注不串位。
 */
export function remapAnnotationPaths<T extends { path: string }>(
  items: readonly T[],
  remap: PathRemap,
): T[] {
  if (remap.size === 0) return items as T[];
  let changed = false;
  const next = items.map((item) => {
    const target = remap.get(item.path);
    if (!target || target === item.path) return item;
    changed = true;
    return { ...item, path: target };
  });
  return changed ? next : (items as T[]);
}
