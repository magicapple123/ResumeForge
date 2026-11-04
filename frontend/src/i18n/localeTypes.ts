// SPDX-License-Identifier: Apache-2.0
import type { ZhCNMessages } from "./messages/zh-CN";

export const DEFAULT_LOCALE = "zh-CN";
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type MessageKey = keyof ZhCNMessages;
export type MessageParams = Record<string, string | number>;

/**
 * 语言选择器里的**母语名**（endonym）。
 *
 * 为什么不放进语言包：语言包里的 `resume.language.*` 是"待翻译的文案"，英文界面下
 * 它必然把「中文」翻成 Chinese——而用户在这个界面上找的正是"我看得懂的那种语言"。
 * 语言选择器的通行做法是固定显示母语名（中文 / English / 日本語），不随界面语言变。
 * 英文包里直接写「中文」也不行：`messageContract` 拒绝英文值里的 CJK，且明确不给豁免。
 *
 * 与 `SUPPORTED_LOCALES` 同源（`Record<Locale, string>`）：新增一种语言时 TypeScript
 * 会要求这里补一项，不会出现"语言能选、名字空着"。
 */
export const LOCALE_ENDONYM: Record<Locale, string> = {
  "zh-CN": "中文", // i18n-ok: 语言名是母语常量，不是待翻译文案（英文包禁 CJK，见 messageContract）
  "en-US": "English",
};

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US";
}
