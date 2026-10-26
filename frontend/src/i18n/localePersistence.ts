// SPDX-License-Identifier: Apache-2.0
import { getUiLocale, saveUiLocale } from "../api/uiLocale";
import { isLocale, type Locale } from "./localeTypes";
import {
  applyServerLocale,
  confirmLocalePersistence,
  getChoiceVersion,
  selectLocale,
} from "./localeStore";

let hydrationGeneration = 0;
let writes: Promise<unknown> = Promise.resolve();

/** Every explicit selection is persisted, including the provisional current value. */
export function setLocale(locale: Locale): Promise<void> {
  const version = selectLocale(locale);
  const write = writes
    .catch(() => undefined)
    .then(async () => {
      await saveUiLocale(locale);
      confirmLocalePersistence(version);
    });
  writes = write;
  return write;
}

/** Invoke only after DatasetScopeBoundary has established the request identity. */
export async function hydrateLocaleFromServer(): Promise<void> {
  const version = getChoiceVersion();
  const generation = ++hydrationGeneration;
  try {
    const response = await getUiLocale();
    if (generation !== hydrationGeneration || version !== getChoiceVersion()) return;
    if (isLocale(response.locale)) {
      applyServerLocale(response.locale);
      return;
    }
    if (response.locale === null)
      await setLocale((await import("./localeStore")).getSnapshot().locale);
  } catch {
    // Offline and older backends retain the synchronously loaded local choice.
  }
}
