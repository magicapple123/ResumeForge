// SPDX-License-Identifier: Apache-2.0
/**
 * 排序会话 → **只预览不落库**的内容（右栏画布实时重排用）。
 *
 * 与提交走同一条命令链路（`sortSessionCommand` + `applyOutlineCommand`）：两处若各写一套
 * 排序算法，"拖动时看到的顺序"与"松手后保存出去的顺序"总有一天会分叉。预览只读内容、
 * 不碰历史、不发请求——松手时仍由宿主走既有的 `onCommand` 提交。
 */
import type { ResumeContent } from "../../../types/resume";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import type { PointRef } from "../../../features/resume-outline/pointMove";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import { sortSessionCommand } from "./outlineTree";

/**
 * 会话当前顺序对应的内容；没有位移（`currentIndex === startIndex`）或命令被拒时返回 null。
 *
 * `points` = 被排序条目的**扁平要点列表**（字段声明顺序）：要点会话靠它算出"搬到哪个字段的
 * 第几位"。缺省时退化为同字段重排（单字段条目与老调用点天然成立）。
 *
 * 返回 null 的语义是"没有预览"（调用方据此清掉右栏的临时内容），不是出错。
 */
export function structurePreviewContent(
  baseContent: ResumeContent | null,
  session: OutlineSortSession | null,
  points: readonly PointRef[] = [],
): ResumeContent | null {
  if (!baseContent || !session) return null;
  if (session.currentIndex === session.startIndex) return null;
  const applied = applyOutlineCommand(baseContent, sortSessionCommand(session, points));
  return applied.ok && applied.changed ? applied.content : null;
}
