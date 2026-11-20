// SPDX-License-Identifier: Apache-2.0
/**
 * WF-11 favicon 跟随主题。
 *
 * 钉三件事：切主题时三枚 `rel="icon"` 全部换到暗色文件、apple-touch-icon 不动、
 * 无 `sizes` 的兜底 link 指向 256 图；以及 index.html 的内联脚本确实在 `<body>` 之前
 * 就写了暗色路径（否则首屏会先闪浅色）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, syncFavicon } from "./themeStore";

function seedFavicons(): void {
  document.head.innerHTML = [
    '<link rel="icon" type="image/png" sizes="32x32" href="/resumeforge-icon-32.png" />',
    '<link rel="icon" type="image/png" sizes="48x48" href="/resumeforge-icon-48.png" />',
    '<link rel="apple-touch-icon" href="/resumeforge-icon-256.png" />',
    '<link rel="icon" type="image/png" href="/resumeforge-icon.png" />',
  ].join("");
}

function hrefOf(selector: string): string | null {
  return document.querySelector<HTMLLinkElement>(selector)?.getAttribute("href") ?? null;
}

afterEach(() => {
  document.head.innerHTML = "";
  window.localStorage.clear();
});

describe("syncFavicon", () => {
  it("暗色：三枚 icon 换成 -dark- 文件，兜底 link 用 256，apple-touch 不动", () => {
    seedFavicons();
    syncFavicon("dark");

    expect(hrefOf('link[rel="icon"][sizes="32x32"]')).toBe("/resumeforge-icon-dark-32.png");
    expect(hrefOf('link[rel="icon"][sizes="48x48"]')).toBe("/resumeforge-icon-dark-48.png");
    expect(hrefOf('link[rel="icon"]:not([sizes])')).toBe("/resumeforge-icon-dark-256.png");
    expect(hrefOf('link[rel="apple-touch-icon"]')).toBe("/resumeforge-icon-256.png");
  });

  it("切回浅色：全部还原到原文件名", () => {
    seedFavicons();
    syncFavicon("dark");
    syncFavicon("light");

    expect(hrefOf('link[rel="icon"][sizes="32x32"]')).toBe("/resumeforge-icon-32.png");
    expect(hrefOf('link[rel="icon"][sizes="48x48"]')).toBe("/resumeforge-icon-48.png");
    expect(hrefOf('link[rel="icon"]:not([sizes])')).toBe("/resumeforge-icon-256.png");
  });

  it("没有 document 时静默跳过（SSR / 测试环境兜底）", () => {
    expect(() => syncFavicon("dark", null)).not.toThrow();
  });
});

describe("applyTheme 联动", () => {
  it("切到深色时，favicon 与 data-theme 一起变", () => {
    seedFavicons();
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    applyTheme("dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(hrefOf('link[rel="icon"][sizes="32x32"]')).toBe("/resumeforge-icon-dark-32.png");
  });
});

describe("index.html 首屏脚本", () => {
  it("暗色路径出现在 <body> 之前，且引用了 256 兜底文件名", () => {
    const html = readFileSync("index.html", "utf8");
    const scriptAt = html.indexOf("resumeforge-icon-dark-");
    expect(scriptAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(html.indexOf("<body"));
    expect(html).toContain('"/resumeforge-icon-dark-" + size + ".png"');
  });
});
