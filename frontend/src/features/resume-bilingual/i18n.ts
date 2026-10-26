// SPDX-License-Identifier: Apache-2.0
/**
 * Namespace keys stay compile-time checked while lookup stays in the shared runtime.
 */
import { t } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";

export type BilingualMessageKey = Extract<MessageKey, `bilingual.${string}`>;

export function bt(key: BilingualMessageKey, params?: MessageParams): string {
  return t(key, params);
}
