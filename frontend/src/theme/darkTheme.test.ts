/**
 * 深色主题 token 契约（A2）。
 *
 * 钉住三件事，防止未来"顺手"把深色改回浅色 token 的覆写：
 *  1. 深色**不是**浅色的复制：正文/标题/链接/主色/边框全部换成深色取值；
 *  2. 几何（圆角、控件高度、字号、行高）与层级基准（zIndexPopupBase）与浅色一致；
 *  3. 组件 token 用深色表面色，且深色表面是"四档阶梯"而不是一档糊到底。
 *
 * 对比度断言的依据是 A3 的验收口径（正文 ≥ 12:1、次级 ≥ 7:1、链接 ≥ 7:1、
 * 白字主按钮 ≥ 5:1），实测值见 `contrast.test.ts` 的深色用例。
 */
import { theme } from "antd";
import { describe, expect, it } from "vitest";
import { appTheme } from "./appTheme";
import { darkPalette, darkTheme } from "./darkTheme";
import { layer } from "./tokens";

describe("darkTheme token", () => {
  it("关键文字 token 全部换成深色取值，不是浅色那一套", () => {
    expect(darkTheme.token?.colorText).toBe(darkPalette.textBody);
    expect(darkTheme.token?.colorTextSecondary).toBe(darkPalette.textSecondary);
    expect(darkTheme.token?.colorTextTertiary).toBe(darkPalette.textTertiary);
    expect(darkTheme.token?.colorTextHeading).toBe(darkPalette.brandText);
    expect(darkTheme.token?.colorLink).toBe(darkPalette.link);
    expect(darkTheme.token?.colorPrimary).toBe(darkPalette.primary);

    for (const key of ["colorText", "colorTextHeading", "colorLink", "colorPrimary"] as const) {
      expect(darkTheme.token?.[key], key).not.toBe(appTheme.token?.[key]);
    }
  });

  it("表面四档：页面底最暗 < 次级面 < 卡片面 < 浮起面", () => {
    expect(darkTheme.token?.colorBgLayout).toBe(darkPalette.page);
    expect(darkTheme.token?.colorBgContainer).toBe(darkPalette.surface);
    expect(darkTheme.token?.colorBgElevated).toBe(darkPalette.surfaceElevated);

    const brightness = (hex: string) => {
      const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
      return channels[0] + channels[1] + channels[2];
    };
    expect(brightness(darkPalette.page)).toBeLessThan(brightness(darkPalette.surfaceAlt));
    expect(brightness(darkPalette.surfaceAlt)).toBeLessThan(brightness(darkPalette.surface));
    expect(brightness(darkPalette.surface)).toBeLessThan(brightness(darkPalette.surfaceElevated));
  });

  it("几何与浅色一致：深色只换颜色，不改排版", () => {
    for (const key of ["borderRadius", "controlHeight", "fontSize", "lineHeight"] as const) {
      expect(darkTheme.token?.[key], key).toBe(appTheme.token?.[key]);
    }
    for (const key of ["headerFontSize", "headerHeight", "borderRadiusLG"] as const) {
      expect(darkTheme.components?.Card?.[key], key).toBe(appTheme.components?.Card?.[key]);
    }
  });

  it("zIndexPopupBase 与浅色同值（投投族的层级梯度依赖它）", () => {
    expect(appTheme.token?.zIndexPopupBase).toBe(layer.popupBase);
    expect(darkTheme.token?.zIndexPopupBase).toBe(layer.popupBase);
  });

  it("组件 token 用深色表面色，不再是浅色品牌浅底", () => {
    expect(darkTheme.components?.Table).toEqual({
      headerBg: darkPalette.tableHeaderBg,
      headerColor: darkPalette.tableHeaderText,
      rowHoverBg: darkPalette.rowHoverBg,
      borderColor: darkPalette.border,
    });
    expect(darkTheme.components?.Menu).toEqual({
      itemSelectedBg: darkPalette.selectedBg,
      itemSelectedColor: darkPalette.selectedText,
    });
    expect(darkTheme.components?.Select).toEqual({
      optionSelectedBg: darkPalette.selectedBg,
      optionSelectedColor: darkPalette.selectedText,
    });
    expect(darkTheme.components?.Tooltip).toEqual({ colorBgSpotlight: darkPalette.spotlight });

    expect(darkTheme.components?.Table?.headerBg).not.toBe(appTheme.components?.Table?.headerBg);
    expect(darkTheme.components?.Menu?.itemSelectedBg).not.toBe(
      appTheme.components?.Menu?.itemSelectedBg,
    );
  });

  it("走 darkAlgorithm 而不是手写全套 token", () => {
    expect(darkTheme.algorithm).toBe(theme.darkAlgorithm);
    // 算法派生的语义底不该被本文件覆盖：手写一套等于放弃 antd 的色阶生成。
    const derived = theme.getDesignToken(darkTheme);
    expect(derived.colorBgContainer).toBe(darkPalette.surface);
    expect(derived.colorText).toBe(darkPalette.textBody);
  });

  it("浅色侧未被改动：appTheme 的正文/标题/主色仍是原值", () => {
    expect(appTheme.token?.colorText).toBe("#223047");
    expect(appTheme.token?.colorTextHeading).toBe("#16365c");
    expect(appTheme.token?.colorPrimary).toBe("#16365c");
    expect(appTheme.token?.colorLink).toBe("#0958d9");
    expect(appTheme.token?.colorBorderSecondary).toBe("#e7ebf0");
  });
});
