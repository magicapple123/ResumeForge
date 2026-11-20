// SPDX-License-Identifier: Apache-2.0
/**
 * 网申地址条（T09）：`Input.Search` 一体 + 时钟图标里的历史菜单。
 *
 * 守四件事：
 * 1. 历史菜单自绘容器是**唯一**滚动层（内层菜单不自带滚动），限高写在页面样式里；
 * 2. 自定义容器补齐浮层观感（背景/圆角/边框/阴影），否则白底贴在页面上；
 * 3. 点时钟图标只开菜单，不触发「打开目标页」；
 * 4. 360×420 的窄窗里菜单不被裁：限高是 `min(360px, 60vh)`，随视口收缩。
 *
 * jsdom 不加载 CSS、也量不到裁剪，所以第 1、4 条直接读 CSS 原文钉住写法。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { join } from "node:path";
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebFormBrowserUrlBar from "./WebFormBrowserUrlBar";
import type { WebFormUrlHistory } from "../../types";

declare const process: { cwd(): string };

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const HISTORY: WebFormUrlHistory[] = [
  {
    id: 1,
    url: "https://example.com/job/1",
    title: "后端工程师",
    last_used_at: "2026-01-01T08:00:00",
  },
  { id: 2, url: "https://example.com/job/2", title: "", last_used_at: "2026-01-01T09:00:00" },
];

function renderBar(overrides: Partial<Parameters<typeof WebFormBrowserUrlBar>[0]> = {}) {
  const onOpen = vi.fn();
  render(
    <AntdApp>
      <WebFormBrowserUrlBar
        value=""
        history={HISTORY}
        busy={false}
        running={false}
        onChange={vi.fn()}
        onOpen={onOpen}
        onSelectHistory={vi.fn()}
        onDeleteHistory={vi.fn()}
        {...overrides}
      />
    </AntdApp>,
  );
  return { onOpen };
}

function openHistoryMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "历史网址" }));
  const popup = document.querySelector<HTMLElement>(".webform-history-popup");
  if (!popup) throw new Error("history popup container not found");
  return popup;
}

/** 页面样式原文：限高与滚动写在 `webform-onboarding.css` 里（注释里提到 `@media`，判定前去掉）。 */
const PAGE_CSS = readFileSync(
  join(process.cwd(), "src/styles/webform-onboarding.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("WebFormBrowserUrlBar 历史网址弹层", () => {
  it("外层限高容器是唯一滚动层：滚动写在 CSS 上，内层菜单不自带滚动", () => {
    renderBar();
    const popup = openHistoryMenu();

    // 限高不再写死在内联样式里（那样 360×420 的窄窗会被裁）。
    expect(popup.style.maxHeight).toBe("");
    expect(popup.style.overflowY).toBe("");
    expect(PAGE_CSS).toMatch(/\.webform-history-popup \{[\s\S]*max-height: min\(360px, 60vh\)/);
    expect(PAGE_CSS).toMatch(/\.webform-history-popup \{[\s\S]*overflow-y: auto/);

    // 弹层内不允许出现第二个滚动容器（此前是外层容器 + 菜单列表各一条）。
    const scrollables = Array.from(popup.querySelectorAll<HTMLElement>("*")).filter(
      (node) => node.style.overflowY === "auto" || node.style.overflowY === "scroll",
    );
    expect(scrollables).toEqual([]);

    const menu = popup.querySelector("ul.ant-dropdown-menu");
    expect(menu).not.toBeNull();
    expect((menu as HTMLElement).style.maxHeight).toBe("");
    expect((menu as HTMLElement).style.overflow).toBe("");
  });

  it("360×420 的窄窗里菜单不被裁：限高按视口收缩，锚点与菜单都放得下", () => {
    // 60vh × 420 = 252px；再加上地址条那一行（约 40px）与上下留白，仍远小于 420px，
    // 固定 360px 则会在 420 高的窗口里顶到下沿。
    const capped = Math.min(360, Math.round(420 * 0.6));
    expect(capped).toBe(252);
    expect(capped + 40).toBeLessThan(420);
    // 这一片不许出现视口断点：窄窗靠容器查询与相对限高，不靠 `@media`。
    expect(PAGE_CSS).not.toContain("@media");
  });

  it("自定义容器补齐浮层观感：背景、圆角、边框、阴影都非空", () => {
    renderBar();
    const popup = openHistoryMenu();

    expect(popup.style.background).not.toBe("");
    expect(popup.style.borderRadius).not.toBe("");
    expect(popup.style.border).toContain("1px solid");
    expect(popup.style.boxShadow).not.toBe("");
  });

  it("菜单渲染历史条目，删除按钮不触发选中", () => {
    renderBar();
    openHistoryMenu();
    expect(screen.getByText("后端工程师")).toBeInTheDocument();
    expect(screen.getByLabelText("删除网址 https://example.com/job/1")).toBeInTheDocument();
  });
});

describe("WebFormBrowserUrlBar 一体式地址条", () => {
  it("点时钟图标只开历史菜单，不触发「打开目标页」", () => {
    const { onOpen } = renderBar({ value: "https://example.com/apply" });

    fireEvent.click(screen.getByRole("button", { name: "历史网址" }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(document.querySelector(".webform-history-popup")).not.toBeNull();
  });

  it("附着按钮是「打开目标页」：有网址时可点，点了就打开", () => {
    const { onOpen } = renderBar({ value: "https://example.com/apply" });

    const openButton = screen.getByRole("button", { name: "打开目标页" });
    expect(openButton).toBeEnabled();
    fireEvent.click(openButton);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("没有网址时附着按钮不可用，主按钮让给工具条", () => {
    renderBar({ value: "   " });
    const openButton = screen.getByRole("button", { name: "打开目标页" });

    expect(openButton).toBeDisabled();
    expect(openButton.className).not.toContain("ant-btn-primary");
  });
});

/**
 * WF-01 回归：`showOpenButton=false` 时曾经残留一颗 antd 默认的放大镜按钮。
 * 根因是 antd v6 的 `Input.Search` **无条件**渲染 enterButton（传 `undefined` 会落回默认
 * `<Button icon={<SearchOutlined/>}/>`），图标语义是"搜索"、行为却是"打开目标页"，
 * 且没有 aria-label。修法是换控件（裸 `Input`），所以这里钉的是"按钮数量与 icon"——
 * CSS 隐藏能让截图变干净，但按钮仍在焦点序与无障碍树里，只有数 DOM 才分得清。
 */
describe("WebFormBrowserUrlBar 不残留放大镜按钮", () => {
  it("showOpenButton=false：地址条里只有历史入口一颗按钮，且没有 search 图标", () => {
    renderBar({ showOpenButton: false, value: "https://example.com/apply" });

    const buttons = Array.from(document.querySelectorAll(".webform-url-input button"));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-label")).toBe("历史网址");
    expect(document.querySelector('[data-icon="search"]')).toBeNull();
  });

  it("showOpenButton=false：回车仍然提交（换控件不换行为）", () => {
    const { onOpen } = renderBar({ showOpenButton: false, value: "https://example.com/apply" });

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", keyCode: 13 });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
