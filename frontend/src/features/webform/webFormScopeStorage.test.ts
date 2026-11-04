// SPDX-License-Identifier: Apache-2.0
/**
 * The remembered data range of the web-form page.
 *
 * Each case here is a way the remembering mechanism can go wrong:
 * - the default must stay "current plan only", otherwise the mechanism silently
 *   changes what every existing user is offered;
 * - the choice must round-trip, and an unknown stored value must not leak into the
 *   request bodies (the API only accepts the two literals);
 * - the key carries the dataset id, so switching datasets cannot change the range of
 *   another one;
 * - an unusable localStorage (disabled, quota, private mode) must never break the page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WEB_FORM_SCOPE,
  normalizeWebFormScope,
  readWebFormScope,
  webFormScopeStorageKey,
  writeWebFormScope,
} from "./webFormScopeStorage";

afterEach(() => {
  window.localStorage.clear();
});

describe("web form scope storage", () => {
  it("defaults to the current plan only when nothing is stored", () => {
    expect(DEFAULT_WEB_FORM_SCOPE).toBe("group");
    expect(readWebFormScope("main")).toBe("group");
    expect(readWebFormScope()).toBe("group");
    expect(readWebFormScope(null)).toBe("group");
  });

  it("round-trips the chosen range and stores the plain literal", () => {
    writeWebFormScope("all", "main");
    expect(readWebFormScope("main")).toBe("all");
    expect(window.localStorage.getItem(webFormScopeStorageKey("main"))).toBe("all");

    writeWebFormScope("group", "main");
    expect(readWebFormScope("main")).toBe("group");
    expect(window.localStorage.getItem(webFormScopeStorageKey("main"))).toBe("group");
  });

  it("normalizes an unknown stored value back to the default", () => {
    window.localStorage.setItem(webFormScopeStorageKey("main"), "weird");

    expect(readWebFormScope("main")).toBe("group");
    expect(normalizeWebFormScope("weird")).toBe("group");
    expect(normalizeWebFormScope("")).toBe("group");
    expect(normalizeWebFormScope(undefined)).toBe("group");
    expect(normalizeWebFormScope(null)).toBe("group");
    expect(normalizeWebFormScope("all")).toBe("all");
    expect(normalizeWebFormScope("group")).toBe("group");
  });

  it("keys the range by dataset so one dataset cannot change another", () => {
    writeWebFormScope("all", "ds-2");

    expect(readWebFormScope("ds-2")).toBe("all");
    // A different dataset keeps its own default: the range does not leak across them.
    expect(readWebFormScope("main")).toBe("group");

    writeWebFormScope("group", "main");

    expect(readWebFormScope("ds-2")).toBe("all");
    expect(readWebFormScope("main")).toBe("group");
  });

  it("falls back to the main dataset key when the id is missing or blank", () => {
    expect(webFormScopeStorageKey("")).toBe("resumeforge:webform-scope:v1:main");
    expect(webFormScopeStorageKey(null)).toBe("resumeforge:webform-scope:v1:main");
    expect(webFormScopeStorageKey(undefined)).toBe("resumeforge:webform-scope:v1:main");
    expect(webFormScopeStorageKey("   ")).toBe("resumeforge:webform-scope:v1:main");
    expect(webFormScopeStorageKey("ds-2")).toBe("resumeforge:webform-scope:v1:ds-2");

    writeWebFormScope("all", "   ");
    expect(readWebFormScope("main")).toBe("all");
  });

  it("keeps the default instead of throwing when reading storage fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is not available");
    });

    expect(readWebFormScope("main")).toBe("group");
  });

  it("swallows a failing write so the in-page state still works", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => writeWebFormScope("all", "main")).not.toThrow();
    // Nothing was persisted, so the next visit keeps the default.
    expect(readWebFormScope("main")).toBe("group");
  });
});
