// SPDX-License-Identifier: Apache-2.0
/**
 * 科研栏目的文案出口（W14）。
 *
 * Namespace keys stay compile-time checked while lookup stays in the shared runtime.
 */
import { t } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";

export type ResearchMessageKey = Extract<MessageKey, `research.${string}`>;

/** 取科研栏目文案。参数插值与 `t()` 同一写法（`{name}`）。 */
export function rt(key: ResearchMessageKey, params?: MessageParams): string {
  return t(key, params);
}
