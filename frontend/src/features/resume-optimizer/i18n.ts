// SPDX-License-Identifier: Apache-2.0
/** Namespace keys stay compile-time checked while lookup stays in the shared runtime. */
import { t } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";

export type OptimizerMessageKey = Extract<MessageKey, `optimizer.${string}`>;

export function ot(key: OptimizerMessageKey, params?: MessageParams): string {
  return t(key, params);
}
