// SPDX-License-Identifier: Apache-2.0
import { request } from "./client";
import type { Locale } from "../i18n/localeTypes";

export function getUiLocale(): Promise<{ locale: Locale | null }> {
  return request("/settings/locale");
}

export function saveUiLocale(locale: Locale): Promise<{ locale: Locale }> {
  return request("/settings/locale", { method: "PUT", body: JSON.stringify({ locale }) });
}
