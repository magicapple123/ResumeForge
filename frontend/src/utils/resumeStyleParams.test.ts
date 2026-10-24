// SPDX-License-Identifier: Apache-2.0
/**
 * 属性表的**字面量**守卫：区间/步长/枚举必须与后端 `resume_style_schema.PROP_BOUNDS`
 * 逐键相等（wave2 契约 §2.2）。后端 W07-BE 落地后由它那边再钉一份、注释互指。
 */
import { describe, expect, it } from "vitest";
import {
  STYLE_ENUM_OPTIONS,
  STYLE_PROP_BOUNDS,
  STYLE_PROP_FALLBACKS,
  STYLE_PROP_KINDS,
  coerceStylePropValue,
  formatStyleNumber,
  isHexColor,
  isNumberStyleProp,
  isStylePropSet,
  ptComparison,
  roundToStyleStep,
  styleIsEmpty,
  styleNumberStep,
} from "./resumeStyleParams";

describe("resumeStyleParams · 属性表", () => {
  it("数值区间与步长与契约逐键相等", () => {
    expect(STYLE_PROP_BOUNDS).toEqual({
      font_scale: { min: 0.7, max: 2.4, step: 0.02 },
      space_before: { min: 0, max: 3, step: 0.05 },
      space_after: { min: 0, max: 3, step: 0.05 },
      line_height: { min: 1, max: 2.6, step: 0.01 },
      indent: { min: 0, max: 4, step: 0.05 },
      letter_spacing: { min: -0.1, max: 0.3, step: 0.01 },
    });
  });

  it("枚举白名单就是落库字面量", () => {
    expect(STYLE_ENUM_OPTIONS.bullet?.map((item) => item.value)).toEqual(["dot", "dash", "none"]);
    expect(STYLE_ENUM_OPTIONS.align?.map((item) => item.value)).toEqual([
      "left",
      "center",
      "right",
      "justify",
    ]);
    expect(STYLE_ENUM_OPTIONS.meta_align?.map((item) => item.value)).toEqual(["right", "inline"]);
  });

  it("十二个属性都有控件形态与标签", () => {
    expect(Object.keys(STYLE_PROP_KINDS)).toHaveLength(12);
    expect(isNumberStyleProp("line_height")).toBe(true);
    expect(isNumberStyleProp("bold")).toBe(false);
    expect(styleNumberStep("line_height")).toBe(0.01);
    expect(styleNumberStep("bold")).toBe(0);
    expect(STYLE_PROP_FALLBACKS.line_height).toBe(1.7);
  });
});

describe("resumeStyleParams · 取值归一", () => {
  it("数值越界夹紧并落到步长网格", () => {
    expect(coerceStylePropValue("font_scale", 9)).toBe(2.4);
    expect(coerceStylePropValue("indent", -1)).toBe(0);
    expect(coerceStylePropValue("space_before", 0.6)).toBe(0.6);
    // font_scale 是派生系数：按四位小数保留（面板显示值 = 系数 × 模板基准）。
    expect(coerceStylePropValue("font_scale", 1.0712)).toBe(1.0712);
    expect(coerceStylePropValue("line_height", 1.555)).toBe(1.56);
  });

  it("非有限数 / 错误类型返回 null（调用方据此不提交）", () => {
    expect(coerceStylePropValue("font_scale", Number.NaN)).toBeNull();
    expect(coerceStylePropValue("font_scale", "1.2")).toBeNull();
    expect(coerceStylePropValue("bold", "true")).toBeNull();
    expect(coerceStylePropValue("align", "middle")).toBeNull();
    expect(coerceStylePropValue("color", "red")).toBeNull();
  });

  it("颜色统一小写、布尔只认布尔、枚举只认白名单", () => {
    expect(coerceStylePropValue("color", "#ABCDEF")).toBe("#abcdef");
    expect(coerceStylePropValue("color", "#abc")).toBe("#abc");
    expect(isHexColor("#12")).toBe(false);
    expect(coerceStylePropValue("italic", true)).toBe(true);
    expect(coerceStylePropValue("bullet", "dash")).toBe("dash");
  });

  it("roundToStyleStep 去掉浮点尾巴", () => {
    expect(roundToStyleStep(0.8 + 0.02 * 3, 0.02)).toBe(0.86);
    expect(roundToStyleStep(1.7 + 0.01 * 3, 0.01)).toBe(1.73);
  });
});

describe("resumeStyleParams · 读数与判定", () => {
  it("系数带 ×、行距是裸倍数", () => {
    expect(formatStyleNumber("font_scale", 1.05)).toBe("1.05×");
    expect(formatStyleNumber("space_before", 0.6)).toBe("0.6×");
    expect(formatStyleNumber("line_height", 1.55)).toBe("1.55");
    expect(formatStyleNumber("letter_spacing", -0.05)).toBe("-0.05×");
  });

  it("pt 对照只做显示换算", () => {
    expect(ptComparison(1.05, 14)).toBe(11);
    expect(ptComparison(1, 16)).toBe(12);
    expect(ptComparison(Number.NaN, 14)).toBe(0);
  });

  it("设过 / 空覆盖判定认合法值", () => {
    expect(isStylePropSet({ line_height: 1.55 }, "line_height")).toBe(true);
    expect(isStylePropSet({ line_height: 99 }, "line_height")).toBe(false);
    expect(isStylePropSet({ line_height: 99 }, "indent")).toBe(false);
    expect(styleIsEmpty({})).toBe(true);
    expect(styleIsEmpty({ align: "middle" })).toBe(true);
    expect(styleIsEmpty({ align: "center" })).toBe(false);
  });
});
