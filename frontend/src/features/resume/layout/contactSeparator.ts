// SPDX-License-Identifier: Apache-2.0
/**
 * 联系方式**同行分隔符**（R-05）：`format_config.contact_separator` 的前端契约。
 *
 * 与 `contact_breaks` 正交：那个决定"哪些字段各自成行"，这个决定"同一行里字段之间印什么"。
 * 三个取值与后端 `resume_contact.CONTACT_SEPARATOR_STYLES` 逐字一致；`space` 是历史行为，
 * 写回时**删键**——空域与"从未设置"逐字节等价，旧简历不会因此产生 diff。
 */
import type { ResumeFormatConfig } from "../../../types/resumeFormat";

export const CONTACT_SEPARATOR_KEY = "contact_separator";

/** 与后端同名的三个分档（顺序即界面下拉顺序）。 */
export const CONTACT_SEPARATOR_STYLES = ["space", "bar", "dot"] as const;

export type ContactSeparatorStyle = (typeof CONTACT_SEPARATOR_STYLES)[number];

/** 读当前分档；未知值/脏数据一律 `space`（渲染侧同口径，见后端 validate）。 */
export function readContactSeparator(
  config: ResumeFormatConfig | null | undefined,
): ContactSeparatorStyle {
  const raw = config?.[CONTACT_SEPARATOR_KEY];
  return typeof raw === "string" && (CONTACT_SEPARATOR_STYLES as readonly string[]).includes(raw)
    ? (raw as ContactSeparatorStyle)
    : "space";
}

/** 写回分档；`space` 删键（回到"与改动前一致"）。 */
export function withContactSeparator(
  config: ResumeFormatConfig | null | undefined,
  style: ContactSeparatorStyle,
): ResumeFormatConfig {
  const next: ResumeFormatConfig = { ...(config ?? {}) };
  if (style === "space") delete next[CONTACT_SEPARATOR_KEY];
  else next[CONTACT_SEPARATOR_KEY] = style;
  return next;
}
