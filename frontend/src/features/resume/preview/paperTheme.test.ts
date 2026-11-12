// SPDX-License-Identifier: Apache-2.0
/**
 * 深色草稿纸的样式注入（问题 19）。
 *
 * 这里只测"纯函数层"：给定一个 document，注入了几份样式、开关有没有跟着变。
 * jsdom 不求值 `filter`，所以"规则长什么样"由读 CSS 原文的断言守着（见
 * `ResumePreviewCanvas.test.tsx` 里那条）。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  PAPER_DARK_CLASS,
  PAPER_DARK_STYLE_ID,
  paintLoadedPaperFrames,
  paintPaperTheme,
} from "./paperTheme";

function makeDoc(): Document {
  return document.implementation.createHTMLDocument("paper");
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("深色草稿纸的样式注入", () => {
  it("重复调用只注入一份样式（幂等）", () => {
    const doc = makeDoc();
    paintPaperTheme(doc, true);
    paintPaperTheme(doc, true);
    paintPaperTheme(doc, false);
    expect(doc.querySelectorAll(`#${PAPER_DARK_STYLE_ID}`)).toHaveLength(1);
  });

  it("开关只切 `<html>` 上的 class，不增删节点", () => {
    const doc = makeDoc();
    paintPaperTheme(doc, true);
    expect(doc.documentElement.classList.contains(PAPER_DARK_CLASS)).toBe(true);
    paintPaperTheme(doc, false);
    expect(doc.documentElement.classList.contains(PAPER_DARK_CLASS)).toBe(false);
    expect(doc.querySelectorAll(`#${PAPER_DARK_STYLE_ID}`)).toHaveLength(1);
  });

  it("注入的样式只抵消图片与矢量图，整页反色由父页面负责", () => {
    const doc = makeDoc();
    paintPaperTheme(doc, true);
    const css = doc.getElementById(PAPER_DARK_STYLE_ID)?.textContent ?? "";
    expect(css).toContain(`html.${PAPER_DARK_CLASS} img`);
    expect(css).toContain(`html.${PAPER_DARK_CLASS} svg`);
    // 同一组滤镜的原函数：不是"调淡一点"，否则照片还原不回去。
    expect(css).toContain("invert(1)");
    expect(css).toContain("hue-rotate(180deg)");
  });

  it("文档还没解析完（null）时安全返回", () => {
    expect(() => paintPaperTheme(null, true)).not.toThrow();
    expect(() => paintLoadedPaperFrames(null, true)).not.toThrow();
  });

  it("paintLoadedPaperFrames 覆盖容器里的每一个 iframe", () => {
    const container = document.createElement("div");
    for (let index = 0; index < 2; index += 1) {
      container.appendChild(document.createElement("iframe"));
    }
    document.body.appendChild(container);

    paintLoadedPaperFrames(container, true);

    const frames = Array.from(container.querySelectorAll("iframe"));
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.contentDocument).not.toBeNull();
      expect(frame.contentDocument?.documentElement.classList.contains(PAPER_DARK_CLASS)).toBe(
        true,
      );
    }
  });
});
