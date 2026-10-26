// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import enUS from "./messages/en-US";
import zhCN from "./messages/zh-CN";
import { EQUALITY_EXEMPT_KEYS } from "./guards/equalityExemptions";
import { validateMessageContract } from "./guards/messageContract";

describe("complete real language packs", () => {
  it("has exactly the same complete key set in both languages", () => {
    const chineseKeys = Object.keys(zhCN).sort();
    expect(chineseKeys.length).toBeGreaterThan(2500);
    expect(Object.keys(enUS).sort()).toEqual(chineseKeys);
  });

  it("validates every actual translation and placeholder without a bypass flag", () => {
    expect(validateMessageContract(zhCN, enUS)).toEqual([]);
  });

  it("does not retain exception keys that are absent from the real packs", () => {
    for (const key of Object.keys(EQUALITY_EXEMPT_KEYS)) {
      expect(Object.prototype.hasOwnProperty.call(zhCN, key)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(enUS, key)).toBe(true);
    }
  });

  it("detects untranslated or CJK values even in a mostly complete real pack", () => {
    const key = "resume.format.label";
    expect(validateMessageContract(zhCN, { ...enUS, [key]: zhCN[key] })).toContainEqual(
      expect.objectContaining({ code: "untranslated", key }),
    );
    expect(validateMessageContract(zhCN, { ...enUS, [key]: zhCN[key] })).toContainEqual(
      expect.objectContaining({ code: "english-cjk", key }),
    );
  });

  it("detects a missing key and an empty translation in the real pack", () => {
    const key = "resume.format.label";
    const missing = Object.fromEntries(
      Object.entries(enUS).filter(([candidate]) => candidate !== key),
    );
    expect(validateMessageContract(zhCN, missing)).toContainEqual(
      expect.objectContaining({ code: "missing-key", key }),
    );
    expect(validateMessageContract(zhCN, { ...enUS, [key]: "" })).toContainEqual(
      expect.objectContaining({ code: "english-empty", key }),
    );
  });

  it("detects a changed placeholder in an actual translation", () => {
    const key = "resume.pagePadding.customHint";
    const changed = enUS[key].replace("{top}", "{unexpected}");
    expect(validateMessageContract(zhCN, { ...enUS, [key]: changed })).toContainEqual(
      expect.objectContaining({ code: "placeholder-mismatch", key }),
    );
  });
});
