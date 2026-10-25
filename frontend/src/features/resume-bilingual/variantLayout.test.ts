// SPDX-License-Identifier: Apache-2.0
/** W16 变体独立排版纯规则：字段归一化、页数夹取、补丁形状、继承语义。 */
import { describe, expect, it } from "vitest";
import {
  clampVariantPageLimit,
  layoutIsVariantOwned,
  sameVariantLayout,
  variantLayoutFieldsFrom,
  variantLayoutPatch,
  variantPageLimitOptions,
} from "./variantLayout";

describe("variantLayoutFieldsFrom", () => {
  it("从生效 layout 读三个显式字段", () => {
    expect(
      variantLayoutFieldsFrom({ template: "scholar", page_limit: 4, font_scale: "large" }),
    ).toEqual({ template: "scholar", page_limit: 4, font_scale: "large" });
  });

  it("旧变体无 layout 时用派生基底回退，不编造", () => {
    expect(variantLayoutFieldsFrom(null, { template: "modern", page_limit: 2 })).toEqual({
      template: "modern",
      page_limit: 2,
      font_scale: "standard",
    });
    expect(variantLayoutFieldsFrom(undefined)).toEqual({
      template: "",
      page_limit: 1,
      font_scale: "standard",
    });
  });

  it("非法页数夹到 1–10，不产生 NaN", () => {
    expect(variantLayoutFieldsFrom({ page_limit: 99 }).page_limit).toBe(10);
    expect(variantLayoutFieldsFrom({ page_limit: -3 }).page_limit).toBe(1);
    expect(variantLayoutFieldsFrom({ page_limit: Number.NaN }).page_limit).toBe(1);
  });
});

describe("clampVariantPageLimit / variantPageLimitOptions", () => {
  it("夹取与取整", () => {
    expect(clampVariantPageLimit(3.4)).toBe(3);
    expect(clampVariantPageLimit(3.6)).toBe(4);
    expect(clampVariantPageLimit(Infinity)).toBe(1);
  });

  it("页数选项覆盖 1–10", () => {
    const options = variantPageLimitOptions();
    expect(options[0]).toBe(1);
    expect(options[options.length - 1]).toBe(10);
    expect(options).toHaveLength(10);
  });
});

describe("variantLayoutPatch / sameVariantLayout", () => {
  it("补丁只含三个显式字段且页数已夹取", () => {
    expect(
      variantLayoutPatch({ template: "classic", page_limit: 42, font_scale: "small" }),
    ).toEqual({
      template: "classic",
      page_limit: 10,
      font_scale: "small",
    });
  });

  it("等价判定把页数夹取后再比较", () => {
    const base = { template: "a", page_limit: 2, font_scale: "standard" };
    expect(sameVariantLayout(base, { ...base })).toBe(true);
    expect(sameVariantLayout(base, { ...base, page_limit: 3 })).toBe(false);
  });
});

describe("layoutIsVariantOwned", () => {
  it("只有 layout_source=variant 才算独立排版", () => {
    expect(layoutIsVariantOwned("variant")).toBe(true);
    expect(layoutIsVariantOwned("render_context")).toBe(false);
    expect(layoutIsVariantOwned(null)).toBe(false);
  });
});
