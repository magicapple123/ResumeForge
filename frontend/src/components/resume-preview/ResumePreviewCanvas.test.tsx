// SPDX-License-Identifier: Apache-2.0
/**
 * 草稿画布的两条硬约束：
 *
 * 1. **纸跟随主题**（问题 19）：深色下 iframe 带 `is-dark-paper`，文档里挂上
 *    `rf-paper-dark`；切主题只刷 class，不重载 iframe。
 * 2. **规则长什么样只能读原文**：jsdom 的 `getComputedStyle` 对 `filter` 与 `outline`
 *    都不可靠（前者不求值、后者只回空串），所以这里直接读 `resume-canvas.css`。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumePreviewCanvas from "./ResumePreviewCanvas";

declare const process: { cwd(): string };

/** 主题在测试里由这条可变量控制（真实实现读 localStorage / matchMedia）。 */
const themeState = vi.hoisted(() => ({ dark: false }));

vi.mock("../../features/theme/themeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/theme/themeStore")>();
  return { ...actual, useResolvedTheme: () => (themeState.dark ? "dark" : "light") };
});

const HTML = "<!doctype html><html><body><p>hi</p></body></html>";

interface CanvasOverrides {
  totalVisualPages?: number;
  pageLimit?: number;
}

function canvasElement({ totalVisualPages = 1, pageLimit = 1 }: CanvasOverrides = {}) {
  return (
    <ResumePreviewCanvas
      isPanning={false}
      viewportHeight={900}
      scaledWidth={794}
      scaledHeight={1123}
      scale={1}
      totalVisualPages={totalVisualPages}
      pageLimit={pageLimit}
      html={HTML}
      containerRef={createRef<HTMLDivElement>()}
      iframeRef={createRef<HTMLIFrameElement>()}
      onIframeLoad={vi.fn()}
    />
  );
}

function firstFrame(container: HTMLElement): HTMLIFrameElement {
  const frame = container.querySelector("iframe");
  if (!frame) throw new Error("画布没有渲染 iframe");
  return frame as HTMLIFrameElement;
}

beforeEach(() => {
  themeState.dark = false;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("草稿纸跟随主题（问题 19）", () => {
  it("深色下 iframe 带 is-dark-paper、文档里挂开关；浅色下都不带", () => {
    const light = render(canvasElement());
    const lightFrame = firstFrame(light.container);
    expect(lightFrame.classList.contains("is-dark-paper")).toBe(false);
    fireEvent.load(lightFrame);
    expect(lightFrame.contentDocument?.documentElement.classList.contains("rf-paper-dark")).toBe(
      false,
    );

    themeState.dark = true;
    const dark = render(canvasElement());
    const darkFrame = firstFrame(dark.container);
    expect(darkFrame.classList.contains("is-dark-paper")).toBe(true);
    fireEvent.load(darkFrame);
    expect(darkFrame.contentDocument?.documentElement.classList.contains("rf-paper-dark")).toBe(
      true,
    );
    // 图片抵消样式随文档注入一次（否则证件照会变成负片）。
    expect(darkFrame.contentDocument?.getElementById("rf-paper-dark-style")).not.toBeNull();
  });

  it("切换主题不重载 iframe：同一个节点、同一个 srcdoc，只换 class", () => {
    themeState.dark = true;
    const view = render(canvasElement());
    const frame = firstFrame(view.container);
    fireEvent.load(frame);
    const srcdoc = frame.getAttribute("srcdoc");
    expect(frame.classList.contains("is-dark-paper")).toBe(true);

    themeState.dark = false;
    view.rerender(canvasElement());

    // 重载会换掉节点（也会闪白、丢滚动位置），这样断言比看 srcdoc 更直接。
    expect(firstFrame(view.container)).toBe(frame);
    expect(frame.getAttribute("srcdoc")).toBe(srcdoc);
    expect(frame.classList.contains("is-dark-paper")).toBe(false);
    expect(frame.contentDocument?.documentElement.classList.contains("rf-paper-dark")).toBe(false);
    expect(frame.contentDocument?.querySelectorAll("#rf-paper-dark-style")).toHaveLength(1);
  });
});

function cssSource(): string {
  return readFileSync([process.cwd(), "src", "styles", "resume-canvas.css"].join("/"), "utf8");
}

/** 取一条平铺规则（选择器里不允许出现 `}`）。 */
function ruleBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `找不到规则：${selector}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start));
}

/** 取一个带嵌套的块（`@media`），按花括号配对。 */
function nestedBlock(source: string, header: string): string {
  // 只认真正的块头（`@media print {`）：注释里也会提到这个名字，匹配到那里会截错区间。
  const start = source.indexOf(`${header} {`);
  expect(start, `找不到块：${header}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return "";
}

describe("草稿纸反色的样式原文（问题 19）", () => {
  it("深色纸整页反色，滤镜对图片再做一次抵消", () => {
    const rule = ruleBlock(cssSource(), ".resume-iframe.is-dark-paper");
    expect(rule).toContain("filter: invert(1) hue-rotate(180deg)");
  });

  it("打印时把滤镜关掉：Ctrl+P 打出来必须是白纸", () => {
    const print = nestedBlock(cssSource(), "@media print");
    expect(print).toContain(".resume-iframe.is-dark-paper");
    expect(print).toContain("filter: none");
  });

  it("纸面容器底色走 --rf-preview-paper，深色下不再投影", () => {
    const css = cssSource();
    const page = ruleBlock(css, ".resume-preview-page");
    expect(page).toContain("background: var(--rf-preview-paper)");
    // 硬编码白底是旧口径（`纸＝导出真样`），改回 #fff 会让深色纸透出白边。
    expect(page).not.toContain("#fff");
    expect(ruleBlock(css, '[data-theme="dark"] .resume-preview-page')).toContain(
      "box-shadow: none",
    );
  });
});

describe("超限页的提示强度（问题 24）", () => {
  it("纸边是 2px 实红线，不再是 55% 透明的 1px 虚线", () => {
    const rule = ruleBlock(cssSource(), ".resume-preview-page.is-over-limit");
    expect(rule).toContain("outline: 2px solid var(--rf-danger)");
    expect(rule).not.toContain("dashed");
    expect(rule).not.toContain("55%");
  });

  it("页标是横跨纸宽的通栏红条（红底白字）", () => {
    const rule = ruleBlock(cssSource(), ".resume-preview-page-label.is-over-limit");
    expect(rule).toContain("right: 0");
    expect(rule).toContain("background: var(--rf-danger)");
    expect(rule).toContain("color: #fff");
    expect(rule).toContain("font-weight: 500");
  });
});

describe("不限篇幅：没有「超额页」", () => {
  /**
   * 缺陷族：`Math.max(1, pageLimit)` 把 0 读成"上限 1 页"，于是不限篇幅的简历第 2 页起
   * 被画上红实线 + 「超出上限，不计入导出」——而导出其实一页都没裁。
   */
  it("pageLimit=0（不限）时任何一页都不带 is-over-limit / data-over-limit", () => {
    const { container } = render(canvasElement({ totalVisualPages: 3, pageLimit: 0 }));
    expect(container.querySelectorAll(".resume-preview-page")).toHaveLength(3);
    expect(container.querySelectorAll(".resume-preview-page.is-over-limit")).toHaveLength(0);
    expect(container.querySelectorAll("[data-over-limit]")).toHaveLength(0);
  });

  it("有上限时第 limit+1 页起仍是超额页（防回归）", () => {
    const { container } = render(canvasElement({ totalVisualPages: 3, pageLimit: 1 }));
    expect(container.querySelectorAll(".resume-preview-page.is-over-limit")).toHaveLength(2);
  });
});
