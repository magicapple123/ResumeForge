// SPDX-License-Identifier: Apache-2.0
import type { ZhCNMessages } from "./messages/zh-CN";

export const DEFAULT_LOCALE = "zh-CN";
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type MessageKey = keyof ZhCNMessages;
export type MessageParams = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US";
}
