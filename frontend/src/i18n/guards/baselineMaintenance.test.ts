// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { countBudgetProblems, tightenBaseline, type I18nBaseline } from "./baselineMaintenance";

const empty = { total: 0, files: {} };
const initial: I18nBaseline = {
  version: 1,
  generatedAt: "2026-10-26",
  rule: "fixture",
  src: empty,
  tests: empty,
};
const productCopy = { total: 1, files: { "legacy.tsx": { count: 1, fingerprints: { old: 1 } } } };

describe("baseline maintenance cannot bypass the guards", () => {
  it("rejects a total-only edit or a negative per-file allowance", () => {
    expect(countBudgetProblems({ total: 0, files: { "old.ts": 1 } }, empty)).toContain(
      "Legacy total does not match file counts",
    );
    expect(countBudgetProblems({ total: -1, files: { "old.ts": -1 } }, empty)).toContain(
      "Legacy file counts must be nonnegative integers",
    );
  });
  it("requires explicit, one-time initialization", () => {
    expect(() => tightenBaseline(initial, empty, empty, productCopy, false)).toThrow(
      "initialization must be explicit",
    );
    const captured = tightenBaseline(initial, empty, empty, productCopy, true);
    expect(captured.productCopy).toEqual(productCopy);
    expect(() => tightenBaseline(captured, empty, empty, productCopy, true)).toThrow(
      "one-time only",
    );
  });

  it("validates AST summaries even during initial capture", () => {
    expect(() =>
      tightenBaseline(initial, empty, empty, { ...productCopy, total: 0 }, true),
    ).toThrow("Product copy total does not match file counts");
  });

  it("refuses a legacy increase even during AST initialization", () => {
    expect(() =>
      tightenBaseline(initial, { total: 1, files: { "new.ts": 1 } }, empty, productCopy, true),
    ).toThrow("Legacy total increased");
  });

  it("refuses replacing an existing fingerprint in maintenance mode", () => {
    const captured = { ...initial, productCopy };
    const changed = { total: 1, files: { "legacy.tsx": { count: 1, fingerprints: { new: 1 } } } };
    expect(() => tightenBaseline(captured, empty, empty, changed, false)).toThrow(
      "unregistered product copy",
    );
  });

  it("writes both summaries and file entries when tightening", () => {
    const captured = { ...initial, productCopy };
    const next = tightenBaseline(captured, empty, empty, empty, false);
    expect(next.productCopy).toEqual({ total: 0, files: {} });
    expect(next.src).toEqual(empty);
    expect(next.tests).toEqual(empty);
  });
});
