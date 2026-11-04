// SPDX-License-Identifier: Apache-2.0
/**
 * 投投小贴士（`.tt-tip`）的视口夹取（8-A 同批）。
 *
 * 气泡的定位规则散在 CSS 里：贴上下边时 `left: 50%` + `translateX(-50%)` 居中，
 * 贴左右边时挂在球旁边。球被拖到边上、视口又窄的时候两种摆法都会撞出视口——
 * 这里守"撞出视口"这件事，以及"夹取没有动 transform"这条硬约定。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import TouTouTip from "./TouTouTip";

/** jsdom 不做布局（rect 全 0），夹取要用的尺寸只能自己喂。 */
const REAL_RECT = HTMLElement.prototype.getBoundingClientRect;

function domRect(left: number, width: number): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left,
    right: left + width,
    toJSON: () => ({}),
    top: 0,
    width,
    x: left,
    y: 0,
  } as DOMRect;
}

/** 造一个有布局的环境：壳（= 球）与气泡各自有真实宽度。 */
function stubLayout(options: { shellLeft: number; tipWidth: number; viewportWidth: number }) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: options.viewportWidth,
  });
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement): DOMRect {
    if (this.classList.contains("tt-shell")) return domRect(options.shellLeft, 64);
    if (this.classList.contains("tt-tip")) return domRect(options.shellLeft, options.tipWidth);
    return domRect(0, 0);
  } as typeof REAL_RECT;
}

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = REAL_RECT;
  // jsdom 默认视口宽度：别的用例都按它算。
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TouTouTip", () => {
  it("渲染文案与关闭键，关闭键可点", () => {
    const onClose = vi.fn();
    render(
      <div className="tt-shell is-edge-bottom">
        <TouTouTip onClose={onClose} text="touTou.tips.results" />
      </div>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(t("touTou.tips.results"));
    fireEvent.click(screen.getByRole("button", { name: t("touTou.tip.close") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("球贴底居中时气泡仍在视口内（半径 180 的球 + 280px 气泡在 360 视口）", () => {
    // 球左缘 (360 - 64) / 2 = 148，球心 180；280 宽的气泡居中后左缘 40。
    stubLayout({ shellLeft: 148, tipWidth: 280, viewportWidth: 360 });
    render(
      <div className="tt-shell is-edge-bottom">
        <TouTouTip onClose={vi.fn()} text="touTou.tips.results" />
      </div>,
    );

    const tip = document.querySelector<HTMLElement>(".tt-tip");
    // 内联 left 相对壳：40 − 148 = −108（气泡向左伸出去）。
    expect(tip?.style.left).toBe("-108px");
    expect(148 + Number.parseFloat(tip?.style.left ?? "0")).toBeGreaterThanOrEqual(8);
    // CSS 里的 translateX(-50%) 必须被退成 0，否则会再向左推半个身位、反而越界。
    expect(tip?.style.getPropertyValue("--tt-tip-shift-x")).toBe("0px");
    expect(tip?.style.transform).toBe("");
  });

  it("球贴左时气泡挂在球右侧并被夹回视口（8px 边距）", () => {
    stubLayout({ shellLeft: 24, tipWidth: 280, viewportWidth: 360 });
    render(
      <div className="tt-shell is-edge-left">
        <TouTouTip onClose={vi.fn()} text="touTou.tips.results" />
      </div>,
    );

    const tip = document.querySelector<HTMLElement>(".tt-tip");
    // 首选的 24 + 64 + 12 = 100 装不下 280 → 夹到 360 − 8 − 280 = 72；相对壳是 72 − 24 = 48。
    expect(tip?.style.left).toBe("48px");
    expect(24 + 280 + Number.parseFloat(tip?.style.left ?? "0")).toBeLessThanOrEqual(360 - 8);
  });

  it("球贴右时气泡挂在球左侧并被夹回视口", () => {
    stubLayout({ shellLeft: 272, tipWidth: 280, viewportWidth: 360 });
    render(
      <div className="tt-shell is-edge-right">
        <TouTouTip onClose={vi.fn()} text="touTou.tips.results" />
      </div>,
    );

    const tip = document.querySelector<HTMLElement>(".tt-tip");
    // 272 − 280 − 12 = −20 → 夹到 8；相对壳是 8 − 272 = −264。
    expect(tip?.style.left).toBe("-264px");
    expect(272 + Number.parseFloat(tip?.style.left ?? "0")).toBeGreaterThanOrEqual(8);
  });

  it("量不到尺寸时不写内联定位，沿用 CSS 的 50% 居中（避免闪烁）", () => {
    render(
      <div className="tt-shell is-edge-bottom">
        <TouTouTip onClose={vi.fn()} text="touTou.tips.results" />
      </div>,
    );

    const tip = document.querySelector<HTMLElement>(".tt-tip");
    expect(tip?.style.left).toBe("");
    expect(tip?.style.getPropertyValue("--tt-tip-shift-x")).toBe("");
  });
});
