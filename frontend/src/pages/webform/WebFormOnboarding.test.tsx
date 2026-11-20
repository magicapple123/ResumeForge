// SPDX-License-Identifier: Apache-2.0
/**
 * 初始态版面（I-24）：一条流程轨道 + 两栏「填写方式 : 最近填写」。
 *
 * 守五件事：
 * 1. 步骤只有一套表达（`FlowBar` 宽档，4 个节点），与预览态同一个组件、同一份步骤名；
 * 2. 主 CTA 只在轨道右端，且**因状态而变**（开启 / 打开 / 读取），任何一态都有入口；
 * 3. 「开启专用浏览器」在全页只出现一次（工具条在 onboarding 态不再渲染它）；
 * 4. 两栏是页面注入的两个槽位，不在组件里复制一套；
 * 5. 两栏 1.6:1、右栏不拉伸；窄容器退回 `2 / 4 · 标题`——jsdom 量不到布局，
 *    所以直接读 CSS 原文钉住写法与数值。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import webFormPageZh from "../../i18n/messages/zh-CN.webFormPage";
import { WebFormOnboarding } from "./WebFormOnboarding";

declare const process: { cwd(): string };

const zh = webFormPageZh;

function renderOnboarding(overrides: Partial<Parameters<typeof WebFormOnboarding>[0]> = {}) {
  const props = {
    running: false,
    hasSnapshot: false,
    targetUrl: "",
    busy: null,
    onStart: vi.fn(),
    onOpenUrl: vi.fn(),
    onRead: vi.fn(),
    fillPanel: <section data-testid="slot-fill">怎么填</section>,
    recentPanel: <section data-testid="slot-recent">最近填写</section>,
    ...overrides,
  };
  return render(<WebFormOnboarding {...props} />);
}

afterEach(cleanup);

describe("WebFormOnboarding 流程轨道", () => {
  it("四个步骤节点，当前步只有一处，且与预览态同一份步骤名", () => {
    renderOnboarding({ running: false });

    const nodes = screen.getAllByRole("listitem");
    expect(nodes).toHaveLength(4);
    expect(nodes[0].textContent).toContain(zh["webFormPage.readSnapshot.step.startBrowser"]);
    expect(nodes[3].textContent).toContain(zh["webFormPage.readSnapshot.step.fill"]);
    expect(nodes[0].getAttribute("aria-current")).toBe("step");
    expect(nodes[1].getAttribute("aria-current")).toBeNull();
  });

  it("浏览器启动后当前步走到第 2 步（页面已在浏览器里）", () => {
    renderOnboarding({ running: true, targetUrl: "https://jobs.example.com" });

    const nodes = screen.getAllByRole("listitem");
    expect(nodes[1].getAttribute("aria-current")).toBe("step");
    expect(nodes[1].className).toContain("is-current");
  });

  it("主 CTA 在轨道右端，并随状态切换（开启 → 读取）", () => {
    const onStart = vi.fn();
    const { unmount } = renderOnboarding({ onStart });
    const slot = screen.getByTestId("webform-flow-wide");
    // 图标自带 aria-label（antd 图标的 `<span role="img" aria-label="chrome">`），
    // 所以按文字片段找而不是精确名。
    const startButton = screen.getByRole("button", {
      name: new RegExp(zh["webFormPage.browserCard.start"]),
    });
    expect(slot).toContainElement(startButton);
    fireEvent.click(startButton);
    expect(onStart).toHaveBeenCalledOnce();
    unmount();

    const onRead = vi.fn();
    renderOnboarding({ running: true, onRead });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(zh["webFormPage.readSnapshot.read"]) }),
    );
    expect(onRead).toHaveBeenCalledOnce();
  });

  it("有网址但浏览器没起：主 CTA 换成「打开目标页」", () => {
    const onOpenUrl = vi.fn();
    renderOnboarding({ targetUrl: "https://jobs.example.com", onOpenUrl });
    const open = screen.getByRole("button", {
      name: new RegExp(zh["webFormPage.urlBar.open"]),
    });
    fireEvent.click(open);
    expect(onOpenUrl).toHaveBeenCalledOnce();
  });

  it("同屏只有一颗主按钮", () => {
    const { container } = renderOnboarding({ running: false });
    expect(container.querySelectorAll("button.ant-btn-primary")).toHaveLength(1);
  });

  it("两栏是页面注入的两个槽位", () => {
    renderOnboarding();
    expect(screen.getByTestId("webform-onboarding")).toContainElement(
      screen.getByTestId("slot-recent"),
    );
    expect(screen.getByTestId("slot-fill")).toBeInTheDocument();
  });
});

describe("初始态样式的比例与回落规则", () => {
  const css = readFileSync(join(process.cwd(), "src/styles/webform-onboarding.css"), "utf8");
  // 注释里会提到 `@media`（解释为什么不用它），判定前先去掉注释，只看真规则。
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("2026-11-19 起是上下结构：单列，右卡不被拉伸", () => {
    // 用户要求「怎么填」与「最近填写」上下排列，不再有 1.6 : 1 的两栏。
    expect(rules).toMatch(
      /\.webform-onboarding-columns \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)[\s\S]*align-items: start/,
    );
    expect(rules).not.toContain("1.6fr");
    // 右卡不再 height:100%（那会把空态撑出一大片空白）。
    expect(rules).not.toMatch(/\.webform-recent \{[\s\S]*height: 100%/);
  });

  it("窄容器：记录行退回两行式，轨道退回一行文字", () => {
    expect(rules).toMatch(/@container \(max-width: 720px\) \{[\s\S]*webform-recent-row/);
    expect(rules).toMatch(
      /@container \(max-width: 1080px\) \{[\s\S]*webform-flow-nodes \{[\s\S]*display: none/,
    );
    expect(rules).toMatch(/\.webform-flow-compact-text \{\s*display: none/);
  });

  it("不掺视口断点：这一片只用 @container", () => {
    expect(rules).not.toContain("@media");
  });

  it("步骤名不换行不断字", () => {
    expect(rules).toMatch(/\.webform-flow-node-title \{[\s\S]*white-space: nowrap/);
  });
});
