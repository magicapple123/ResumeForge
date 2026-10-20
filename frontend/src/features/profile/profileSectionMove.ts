// SPDX-License-Identifier: Apache-2.0
/** 分区「上移/下移一位」：键盘（把手/分区根上的方向键）与微调按钮共用的唯一实现。
 *
 * 从 `useProfileSectionReorder.ts` 抽出以满足单文件 500 行预算（第三轮折叠功能新增了
 * 折叠切换与位移补偿）。行为逐字保留：
 *
 * - `basic_info` 固定首位，自己不动，也不允许被别人越过（目标位 ≤ 0 直接放弃）；
 * - 顺序写入走 store 的唯一出口（`commitOrder` → notify → 分区栈重渲），不经页面级
 *   state（理由见 useProfileSectionReorder.ts 文件头：页面级 state 会打穿 antd Form）；
 * - 移动后把焦点送回**被移动的那个分区**，实现见 `profileSectionFocus.ts`（下一帧
 *   执行，此时新 order 已落 DOM）。
 */

import type { ProfileSectionKey } from "../../components/profile/ProfileSectionConfig";
import { moveWithin } from "../../components/profile/dragReorder";
import { focusReorderedSection } from "./profileSectionFocus";
import type { ProfileSectionOrderStore } from "./sectionOrderStore";

/**
 * 把 `sectionKey` 在顺序里挪动 `offset` 位（-1 上移、+1 下移）。
 *
 * 越界、原地、或会把 `basic_info` 顶出首位时什么都不做——静默放弃比抛错更合适：
 * 微调按钮在边界上本就是 disabled，键盘方向键按到底也该只是"没有反应"。
 */
export function stepSectionOrder(
  store: ProfileSectionOrderStore,
  sectionKey: ProfileSectionKey,
  offset: -1 | 1,
): void {
  if (sectionKey === "basic_info") return;
  const current = store.getOrder();
  const sourceIndex = current.indexOf(sectionKey);
  const targetIndex = sourceIndex + offset;
  if (
    sourceIndex < 0 ||
    targetIndex <= 0 ||
    targetIndex >= current.length ||
    current[targetIndex] === "basic_info"
  ) {
    return;
  }
  store.commitOrder(moveWithin(current, sourceIndex, targetIndex));
  focusReorderedSection(sectionKey);
}
