// SPDX-License-Identifier: Apache-2.0
/**
 * 公告来源的白名单。
 *
 * **新增一个来源必须改这里**（并同步 `components/common/AnnouncementBar.tsx` 的类型）。
 * 这不是形式主义：公告条同一时刻只显示一条，来源越多，"唯一那个位置"被挤占的概率越高。
 * 把白名单做成一份要动手改的常量，review 时看得见。
 *
 * 判据（`AGENTS.md`：「跨页常驻 + 需用户看见并处理 + 允许先不理」三条同时满足才用公告条）：
 * 影响全站、不是一次性反馈、不挡操作。任务进度/完成通知**不属于**这里，它们走
 * `notification` 与 `utils/taskNotify.ts`。
 */
export const ANNOUNCEMENT_CODES = [
  "update.ready",
  "update.downloaded",
  "backend.degraded",
  "dataset.error",
] as const;

export type AnnouncementCode = (typeof ANNOUNCEMENT_CODES)[number];

const CODE_SET = new Set<string>(ANNOUNCEMENT_CODES);

/** 白名单判定：存储里可能留着已删除来源的孤儿键，读回来要按它过滤。 */
export function isAnnouncementCode(value: string): value is AnnouncementCode {
  return CODE_SET.has(value);
}
