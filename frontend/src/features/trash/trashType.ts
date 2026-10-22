// SPDX-License-Identifier: Apache-2.0
/**
 * 回收站的 15 类 key（**编译期闭集**）。
 *
 * 为什么要抄一份 key 清单：撤销要传对 `type_key`，写错一个字母的表现是"点了撤销什么都没恢复"
 * ——没有任何报错。`types/trash.ts` 里的 `type` 是 `string`，抄不出错才怪。
 *
 * **只抄 key，不抄中文名**：中文名仍由后端 `TrashSummary.labels` 下发（`types/trash.ts`
 * 的注释说明了原因——抄一份中文名必然漂移）。两件事不冲突：一个为类型安全，一个为不漂移。
 *
 * 与后端 `backend/app/services/trash.py` 的 `TRASH_SPECS` **一一对应**，
 * `trashType.test.ts` 钉住条数。
 */
export const TRASH_TYPES = [
  "job",
  "resume",
  "track",
  "claim",
  "material",
  "conversation",
  "interview_experience",
  "referral",
  "reminder",
  "share_package",
  "question_bank_record",
  "interview_review_record",
  "knowledge_entry",
  "apply_record",
  "web_form_record",
] as const;

export type TrashType = (typeof TRASH_TYPES)[number];

/** 一次撤销的上限：超过它的删除属于"必须先二次确认"的区间（见 §3.4）。 */
export const UNDO_MAX_IDS = 100;
