// SPDX-License-Identifier: Apache-2.0
/**
 * 「保存资料 / 取消」浮卡：动作、骨架类名，以及 8-A 的视口夹取。
 *
 * 这张卡与「去改资料」提示卡共用 `.tt-card` 骨架，也就共用了"写死右对齐"的老缺陷：
 * 球被拖到左边时整卡向左越出视口。夹取归 `useTouTouAnchoredCard`，这里守的是
 * "这张卡真的用上了它"（换组件时最容易漏的一步）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import TouTouSaveCard from "./TouTouSaveCard";

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

/** 造一个有布局的环境：壳（= 球）与卡片各自有真实宽度。 */
function stubLayout(options: { cardWidth: number; shellLeft: number; viewportWidth: number }) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: options.viewportWidth,
  });
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement): DOMRect {
    if (this.classList.contains("tt-shell")) return domRect(options.shellLeft, 64);
    if (this.classList.contains("tt-card")) return domRect(options.shellLeft, options.cardWidth);
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

describe("TouTouSaveCard", () => {
  it("渲染保存/取消两个动作并各自回调一次", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<TouTouSaveCard control={{ onCancel, onSave }} />);

    expect(document.querySelector(".tt-card.tt-save-card")).not.toBeNull();
    // 指向球心的小尾巴是纯装饰，不该进读屏。
    expect(document.querySelector(".tt-card-tail")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: t("touTou.save.save") }));
    expect(onSave).toHaveBeenCalledTimes(1);
    // antd 会在两个汉字之间插一个空格（「取 消」），按名匹配时要放宽。
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/u }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("球贴左时保存卡不越出视口左缘，尾巴仍对准球心（8-A）", () => {
    stubLayout({ cardWidth: 240, shellLeft: 24, viewportWidth: 360 });
    render(
      <div className="tt-shell is-edge-left">
        <TouTouSaveCard control={{ onCancel: vi.fn(), onSave: vi.fn() }} />
      </div>,
    );

    const card = document.querySelector<HTMLElement>(".tt-card.tt-save-card");
    expect(card).not.toBeNull();

    const inlineLeft = Number.parseFloat(card?.style.left ?? "");
    expect(Number.isNaN(inlineLeft)).toBe(false);
    expect(inlineLeft).toBeGreaterThanOrEqual(0);
    expect(24 + inlineLeft).toBeGreaterThanOrEqual(8);
    expect(24 + inlineLeft + 240).toBeLessThanOrEqual(360 - 8);

    const tailRight = Number.parseFloat(card?.style.getPropertyValue("--tt-tail-right") ?? "");
    expect(tailRight).toBeGreaterThanOrEqual(8);
    expect(tailRight).toBeLessThanOrEqual(240 - 8);
    expect(24 + 240 - tailRight - 7).toBe(56);

    expect(card?.style.getPropertyValue("--tt-card-origin-x")).toBe("0%");
  });
});
