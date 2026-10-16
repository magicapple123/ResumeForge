import { theme } from "antd";
import { describe, expect, it } from "vitest";
import { appTheme } from "./appTheme";
import { palette } from "./tokens";

describe("original success and warning palette", () => {
  const defaults = theme.getDesignToken();
  const actual = theme.getDesignToken(appTheme);

  it.each(["Success", "Warning"] as const)(
    "%s keeps the original seed, light surfaces, borders and icons",
    (status) => {
      for (const suffix of [
        "",
        "Bg",
        "BgHover",
        "Border",
        "BorderHover",
        "Hover",
        "Active",
      ] as const) {
        const key = `color${status}${suffix}` as const;
        expect(actual[key], key).toBe(defaults[key]);
      }
    },
  );
});

describe("Select dropdown selected option", () => {
  // getDesignToken 只返回全局 token（不含组件 token），所以这里直接钉配置对象。
  // 背景：antd 默认 optionSelectedBg=controlItemBgActive（=colorPrimaryBg），品牌色
  // #16365c 过深过灰时它被算成 #92989c 中灰——下拉选中项深灰底、与浅色表单反差刺眼。
  it("选中项用品牌浅 tint 底 + 品牌深色字（与 Menu itemSelectedBg 同一套处理）", () => {
    expect(appTheme.components?.Select).toEqual({
      optionSelectedBg: palette.brandTint,
      optionSelectedColor: palette.brand,
    });
    expect(palette.brandTint).toBe("#eaf1f8");
    expect(palette.brand).toBe("#16365c");
  });
});
