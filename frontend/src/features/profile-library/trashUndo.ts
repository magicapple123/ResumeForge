// SPDX-License-Identifier: Apache-2.0
/**
 * 「删除后 5 秒撤销」的回收站桥（F6）。
 *
 * 后端删除接口只回稳定外部 id（group_id / entry_id），而回收站恢复接口按**数字主键**：
 * 前端在删除前记下时间戳，删除后到回收站里按「类型 + 标题 + 删除时间 >= 删除前」找
 * 那一条再恢复。找不到就如实报错（不静默成功）。这是当前契约下的最小可用桥；
 * 若后端未来在删除响应里回数字 id，可直接换掉本文件。
 */
import { getTrash, restoreTrashItem } from "../../api/trash";
import type { TrashItem } from "../../types";

function itemTime(item: TrashItem): number {
  const raw = item.deleted_at;
  if (!raw) return 0;
  const value = new Date(raw).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/** 找到刚刚被软删的那一条并恢复；返回是否成功。 */
export async function restoreRecentlyDeleted(
  typeKey: string,
  title: string,
  deletedNotBeforeMs: number,
): Promise<boolean> {
  const summary = await getTrash({ type: typeKey });
  const exact = summary.items.filter((item) => item.type === typeKey && item.title === title);
  const fallback = summary.items.filter((item) => item.type === typeKey);
  const pool = exact.length > 0 ? exact : fallback;
  const target = pool
    .filter((item) => itemTime(item) >= deletedNotBeforeMs - 2000)
    .sort((left, right) => itemTime(right) - itemTime(left))[0];
  if (!target) return false;
  await restoreTrashItem(typeKey, target.id);
  return true;
}
