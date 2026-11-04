// SPDX-License-Identifier: Apache-2.0
/**
 * Persisted data-range choice for the web-form page (`group` vs `all`).
 *
 * Why localStorage and why not per resume group: this is a filling habit, not a property
 * of one resume. Re-picking it for every plan is exactly the friction the switch exists
 * to remove. The key still carries the dataset scope for the same reason the draft
 * storage does (RF-13): datasets are whole-page reloads with different content, and a
 * range that leaks across them would silently change what a user is filling.
 *
 * The default stays `group` — the behaviour before the switch existed — so nobody's
 * default changes because of the remembering mechanism.
 */
import type { WebFormScope } from "../../types";

const WEB_FORM_SCOPE_STORAGE_PREFIX = "resumeforge:webform-scope:v1";
const DEFAULT_DATASET_SCOPE = "main";
export const DEFAULT_WEB_FORM_SCOPE: WebFormScope = "group";

export function webFormScopeStorageKey(datasetId: string | null | undefined): string {
  const scope = (datasetId ?? "").trim() || DEFAULT_DATASET_SCOPE;
  return `${WEB_FORM_SCOPE_STORAGE_PREFIX}:${scope}`;
}

function storageAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function normalizeWebFormScope(value: unknown): WebFormScope {
  return value === "all" ? "all" : DEFAULT_WEB_FORM_SCOPE;
}

export function readWebFormScope(datasetId?: string | null): WebFormScope {
  if (!storageAvailable()) return DEFAULT_WEB_FORM_SCOPE;
  try {
    return normalizeWebFormScope(window.localStorage.getItem(webFormScopeStorageKey(datasetId)));
  } catch {
    return DEFAULT_WEB_FORM_SCOPE;
  }
}

export function writeWebFormScope(scope: WebFormScope, datasetId?: string | null): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(webFormScopeStorageKey(datasetId), normalizeWebFormScope(scope));
  } catch {
    // Storage full or disabled: the in-page state still works for this visit.
  }
}
