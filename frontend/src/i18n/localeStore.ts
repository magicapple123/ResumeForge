// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_LOCALE, isLocale, type Locale } from "./localeTypes";

export const LOCALE_STORAGE_KEY = "rf.locale";
export interface LocaleSnapshot {
  readonly locale: Locale;
  readonly revision: number;
  readonly provisional: boolean;
}

function readInitialLocale(): Locale {
  try {
    const stored =
      typeof window === "undefined" ? null : window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

let snapshot: LocaleSnapshot = Object.freeze({
  locale: readInitialLocale(),
  revision: 0,
  provisional: true,
});
let choiceVersion = 0;
const listeners = new Set<() => void>();
const serverSnapshot: LocaleSnapshot = Object.freeze({
  locale: DEFAULT_LOCALE,
  revision: 0,
  provisional: true,
});

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}
applyDocumentLocale(snapshot.locale);

export function getSnapshot(): LocaleSnapshot {
  return snapshot;
}

export function getServerSnapshot(): LocaleSnapshot {
  return serverSnapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registration invalidates caches without publishing a locale change. */
export function advanceRevision(): void {
  snapshot = Object.freeze({ ...snapshot, revision: snapshot.revision + 1 });
}

export function getChoiceVersion(): number {
  return choiceVersion;
}

function publishLocale(locale: Locale, provisional: boolean): void {
  const changed = snapshot.locale !== locale;
  snapshot = Object.freeze({ locale, provisional, revision: snapshot.revision + 1 });
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Keep the in-memory choice even when browser storage is unavailable.
  }
  applyDocumentLocale(locale);
  if (changed) for (const listener of [...listeners]) listener();
}

/** Synchronous local choice; server writes live in localePersistence. */
export function selectLocale(locale: Locale): number {
  choiceVersion += 1;
  publishLocale(locale, true);
  return choiceVersion;
}

export function applyServerLocale(locale: Locale): void {
  publishLocale(locale, false);
}

export function confirmLocalePersistence(version: number): void {
  if (version === choiceVersion) {
    snapshot = Object.freeze({ ...snapshot, provisional: false, revision: snapshot.revision + 1 });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_STORAGE_KEY && isLocale(event.newValue)) {
      choiceVersion += 1;
      publishLocale(event.newValue, true);
    }
  });
}
