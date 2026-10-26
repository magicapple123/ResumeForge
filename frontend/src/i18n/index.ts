// SPDX-License-Identifier: Apache-2.0
/** The module-level API stays usable in React components and ordinary helpers. */
import { getSnapshot } from "./localeStore";
import { translate } from "./messageRegistry";
import type { MessageKey, MessageParams } from "./localeTypes";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./localeTypes";
export type { Locale, MessageKey, MessageParams } from "./localeTypes";
export { translate, registerLanguagePack } from "./messageRegistry";

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(getSnapshot().locale, key, params);
}
