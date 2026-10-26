// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产库的文案出口（W17）。
 *
 * Namespace keys stay compile-time checked while lookup stays in the shared runtime.
 */
import { t } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";

export type AssetsMessageKey = Extract<MessageKey, `assets.${string}`>;

/** 取资产库文案。参数插值与 `t()` 一致（`{name}`）。 */
export function at(key: AssetsMessageKey, params?: MessageParams): string {
  return t(key, params);
}
