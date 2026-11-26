// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒上「关联简历」的展示与表单值换算（R14）。
 *
 * 两个方向的换算都收在这里，是因为它们必须**成对**：
 *
 * - 表单值 ← 记录：`reminderResumeValue()`；
 * - 卡片 / 详情 ← 记录：`reminderResumeLabel()` / `reminderResumeExternalLabel()`。
 *
 * 提醒没有标题快照列，外部简历名由后端回显 `external_resume_name`（口径
 * `external_resume.name`）。内部简历名后端不回显，详情抽屉仍按下拉的已选值显示，
 * 因此这里把"内部名"作为可选入参，拿不到就退回 `#id`（如实告知，不假装）。
 */
import { t } from "../../i18n";
import type { Reminder } from "../../types";
import { resumeRefValue } from "../../types/resumeRef";

/** 记录 → 复合值（`internal:12` / `external:7`）；两个关联都空时 `undefined`。 */
export function reminderResumeValue(item: Reminder): string | undefined {
  return resumeRefValue(item);
}

/** 外部简历关联的展示名：「外部 · xxx.pdf」。没关联外部简历时 `undefined`。 */
export function reminderResumeExternalLabel(item: Reminder): string | undefined {
  if (item.external_resume_id == null) return undefined;
  const name = (item.external_resume_name ?? "").trim() || `#${item.external_resume_id}`;
  return `${t("reminder.resume.externalTag")} · ${name}`;
}

/**
 * 详情抽屉里「关联简历」的跳转地址（R14）。
 *
 * 外部简历**没有独立路由**，唯一可行的深链是"打开外部简历列表 + `?resume=<id>`"，
 * 由列表页决定要不要展开详情（B/C 落 `?resume=` 之后自然生效；没落之前等于只跳列表，
 * 至少用户能在那儿按名字找到它）。内部简历的深链归统一基座（T29）统一处理，这里不给。
 */
export function reminderResumeHref(item: Reminder): string | undefined {
  if (item.external_resume_id == null) return undefined;
  return `/resumes/external?resume=${item.external_resume_id}`;
}

/**
 * 关联对象的显示名：在已选值回查出来的选项里按 id 找名字。
 *
 * 查不到（或未关联）时返回 `undefined` 而不是 `"-"`：详情抽屉按"空白即不存在"整行不渲染，
 * 一条没关联任何东西的提醒不该占三行 `–`。
 */
export function linkedLabelOf(
  options: { value: number; label: string }[],
  id: number | null | undefined,
): string | undefined {
  if (id == null) return undefined;
  return options.find((option) => option.value === id)?.label;
}

export function reminderResumeLabel(item: Reminder, internalLabel?: string): string | undefined {
  const external = reminderResumeExternalLabel(item);
  if (external) return external;
  if (item.resume_id == null) return undefined;
  return internalLabel ?? `#${item.resume_id}`;
}
