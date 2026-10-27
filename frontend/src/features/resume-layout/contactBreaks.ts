// SPDX-License-Identifier: Apache-2.0
/**
 * 联系方式换行（#3）：format_config.contact_breaks 的前端契约。
 *
 * ## 与后端同一份字段表
 *
 * CONTACT_FIELD_KEYS 必须与 backend/app/services/resume/resume_contact.py 的
 * CONTACT_FIELDS 逐字一致（顺序也一致）——后端按它决定"在哪个字段前强制换行"，
 * 前端只负责让用户勾选。改字段表时两处同批改，否则控件里选中的键会被后端白名单丢掉，
 * 表现为"勾了没反应"。
 *
 * ## 存储形状
 *
 *   contact_breaks: ["github", "personal_website"]
 *
 * 空列表（用户清空）等同"没有设置"：键直接删掉，与旧简历逐字节等价。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";

export const CONTACT_BREAKS_KEY = "contact_breaks";

/** 联系方式字段顺序（与后端 resume_contact.CONTACT_FIELDS 一致）。 */
export const CONTACT_FIELD_KEYS = [
  "phone",
  "email",
  "city",
  "birth_year",
  "github",
  "personal_website",
] as const;

export type ContactFieldKey = (typeof CONTACT_FIELD_KEYS)[number];

/**
 * 从 format_config 读强制换行字段（白名单 + 按字段顺序归一）。
 *
 * format_config 是用户可以随手改的 JSON：未知键、非字符串、重复项一律丢弃，
 * 组件因此不会因为一条脏数据渲染出"幽灵选项"。
 */
export function readContactBreaks(
  config: ResumeFormatConfig | null | undefined,
): ContactFieldKey[] {
  const raw = config?.[CONTACT_BREAKS_KEY];
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((item): item is string => typeof item === "string"));
  return CONTACT_FIELD_KEYS.filter((key) => wanted.has(key));
}

/**
 * 把选中字段写回 format_config（空选择 = 删键，回到"自动换行"默认）。
 *
 * 返回新对象（不改入参）：调用方拿它走既有版式保存链路（history.recordLayout），
 * 与其它 format_config 键的写入口径一致。
 */
export function withContactBreaks(
  config: ResumeFormatConfig | null | undefined,
  breaks: readonly ContactFieldKey[],
): ResumeFormatConfig {
  const next: ResumeFormatConfig = { ...(config ?? {}) };
  const normalized = CONTACT_FIELD_KEYS.filter((key) => breaks.includes(key));
  if (normalized.length === 0) delete next[CONTACT_BREAKS_KEY];
  else next[CONTACT_BREAKS_KEY] = normalized;
  return next;
}

/** 已设置的字段数（控件上显示"已设置"用；0 = 跟随默认自动换行）。 */
export function contactBreakCount(config: ResumeFormatConfig | null | undefined): number {
  return readContactBreaks(config).length;
}
