// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import designTokensCss from "./design-tokens.css?raw";
import darkTokensCss from "./dark-tokens.css?raw";
import { darkPalette } from "./darkTheme";
import { palette } from "./tokens";

function luminance(hex: string) {
  const values = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

describe("text color contrast", () => {
  const cases = [
    ["primary button", palette.surface, palette.brand],
    ["body", palette.textBody, palette.surface],
    ["secondary", palette.textSecondary, palette.surfaceAlt],
    ["caption", palette.textTertiary, palette.surfaceAlt],
    ["link", palette.link, palette.surface],
    ["success", palette.success, "#f6ffed"],
    ["warning", palette.warning, "#fffbe6"],
    ["error", palette.error, "#fff1f0"],
  ];

  it.each(cases)("%s remains readable on its intended surface", (_name, foreground, background) => {
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * 深色（A3 验收口径）：正文 ≥ 12:1、次级 ≥ 7:1、标题/链接 ≥ 7:1、白字主按钮 ≥ 5:1。
 *
 * 这些断言是"深色能读"的唯一自动化保障——深色下最典型的故障是正文变成了
 * 近黑的浅色 token（对比度 1.3:1），靠截图审核很难覆盖到每个页面。
 */
describe("dark text color contrast", () => {
  const ratio = (foreground: string, background: string) => {
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return (light + 0.05) / (dark + 0.05);
  };

  it("正文在页面底与卡片面上都 ≥ 12:1", () => {
    expect(ratio(darkPalette.textBody, darkPalette.page)).toBeGreaterThanOrEqual(12);
    expect(ratio(darkPalette.textBody, darkPalette.surface)).toBeGreaterThanOrEqual(12);
  });

  it("次级文字在卡片面上 ≥ 7:1", () => {
    expect(ratio(darkPalette.textSecondary, darkPalette.surface)).toBeGreaterThanOrEqual(7);
  });

  it("链接在卡片面上 ≥ 7:1", () => {
    expect(ratio(darkPalette.link, darkPalette.surface)).toBeGreaterThanOrEqual(7);
  });

  it("品牌标题在卡片面上 ≥ 7:1", () => {
    expect(ratio(darkPalette.brandText, darkPalette.surface)).toBeGreaterThanOrEqual(7);
  });

  it("主按钮白字 ≥ 5:1", () => {
    expect(ratio("#ffffff", darkPalette.primary)).toBeGreaterThanOrEqual(5);
  });

  it("表格表头/浮层上的文字仍然可读", () => {
    expect(ratio(darkPalette.tableHeaderText, darkPalette.tableHeaderBg)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(ratio(darkPalette.selectedText, darkPalette.selectedBg)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * 阶段色对比度（T9）：求职进度的六档阶段色 × 两种卡片底色 × 两套主题。
 *
 * 门槛是 **3:1**（WCAG 对图形/界面元素的要求），不是正文的 4.5：这些颜色画的是
 * 色块、漏斗条与竖条，旁边永远有文字标签说明"这是哪一阶段"，颜色不是唯一信号。
 *
 * 取值直接从两个 token 文件的**原始文本**里解析——手工再抄一份数字，两边迟早不一致，
 * 而这个测试的全部价值就在于"断言的就是真发出去的值"。
 */
describe("阶段色对比度（T9）", () => {
  const STAGE_KEYS = ["applied", "screening", "assessment", "interview", "offer", "rejected"];

  /** 从 CSS 原文里取一个 token 的十六进制值；取不到直接抛错（改名时立刻红）。 */
  function tokenValue(css: string, name: string): string {
    const pattern = new RegExp("--" + name + "\\s*:\\s*(#[0-9a-fA-F]{3,8})");
    const match = pattern.exec(css);
    if (!match) throw new Error(`CSS 里找不到 token --${name}`);
    return match[1];
  }

  function contrast(a: string, b: string): number {
    const hi = Math.max(luminance(a), luminance(b));
    const lo = Math.min(luminance(a), luminance(b));
    return (hi + 0.05) / (lo + 0.05);
  }

  it.each([
    ["浅色", designTokensCss],
    ["深色", darkTokensCss],
  ])("%s主题：6 个阶段色在 surface 与 surface-alt 上都 ≥ 3:1", (_theme, css) => {
    const surfaces = [tokenValue(css, "rf-surface"), tokenValue(css, "rf-surface-alt")];
    const failures: string[] = [];
    for (const key of STAGE_KEYS) {
      const foreground = tokenValue(css, `rf-stage-${key}`);
      for (const background of surfaces) {
        const value = contrast(foreground, background);
        if (value < 3) {
          failures.push(`${key} ${foreground} on ${background} = ${value.toFixed(2)}`);
        }
      }
    }
    const details = failures.join(" / ");
    expect(failures, "对比度不足 3:1：" + details).toEqual([]);
  });
});
