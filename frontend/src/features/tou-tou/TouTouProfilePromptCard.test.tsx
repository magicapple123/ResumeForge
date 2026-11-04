// SPDX-License-Identifier: Apache-2.0
/** 「去改资料」提示卡：内容、动作与出入场生命周期。 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TouTouProfilePromptCard from "./TouTouProfilePromptCard";

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

/**
 * 造一个有布局的环境：壳（= 球）与卡片各自有真实宽度。
 *
 * 球的位置只体现在壳的 `left` 上——这正是 8-A 的变量：旧实现把"球永远在右下角"
 * 写死在 CSS 里，球一贴左，写死右对齐的卡片就整块越出视口。
 */
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
  // jsdom 默认视口宽度：别的用例（与其它测试文件）都按它算。
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stubReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe("TouTouProfilePromptCard", () => {
  it("renders nothing while no control is registered", () => {
    render(<TouTouProfilePromptCard control={null} />);

    expect(document.querySelector(".tt-profile-prompt-card")).toBeNull();
    expect(screen.queryByRole("button", { name: "去编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭提示卡" })).toBeNull();
  });

  it("offers the edit action plus a way to close the card", () => {
    const onEdit = vi.fn();
    const onDismiss = vi.fn();
    render(<TouTouProfilePromptCard control={{ onEdit, onDismiss }} />);

    expect(screen.getByText("想补充或修改资料？")).toBeInTheDocument();
    // 骨架类名由两种浮卡共用（.tt-card 管定位与动效），内容类名才是这张卡自己的。
    expect(document.querySelector(".tt-card.tt-profile-prompt-card")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "去编辑" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "关闭提示卡" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // 指向球心的小尾巴是纯装饰，不该进读屏。
    expect(document.querySelector(".tt-card-tail")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the card mounted through the exit animation after the control clears", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <TouTouProfilePromptCard control={{ onEdit: vi.fn(), onDismiss: vi.fn() }} />,
    );
    expect(document.querySelector(".tt-profile-prompt-card")).not.toBeNull();

    rerender(<TouTouProfilePromptCard control={null} />);
    expect(document.querySelector(".tt-profile-prompt-card")).toHaveClass("is-leaving");

    // 180ms 退场动画播完才真正卸载。
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(document.querySelector(".tt-profile-prompt-card")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(document.querySelector(".tt-profile-prompt-card")).toBeNull();
  });

  it("unmounts on the next tick when reduced motion is requested", () => {
    // 动画关掉了，卡片就得靠 JS 定时器（退场时长归零）及时卸载，而不是赖着不走。
    vi.useFakeTimers();
    stubReducedMotion(true);
    const { rerender } = render(
      <TouTouProfilePromptCard control={{ onEdit: vi.fn(), onDismiss: vi.fn() }} />,
    );

    rerender(<TouTouProfilePromptCard control={null} />);
    expect(document.querySelector(".tt-profile-prompt-card")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(document.querySelector(".tt-profile-prompt-card")).toBeNull();
  });

  it("球贴左时卡片不越出视口，尾巴仍对准球心（8-A）", () => {
    // 缺陷原发现场：球拖到最左（壳左缘 24），240px 宽的卡片按旧的 right: 0 定位会跑到
    // 视口外 −152px，标题被裁成「…改资料？」。
    stubLayout({ cardWidth: 240, shellLeft: 24, viewportWidth: 360 });
    render(
      <div className="tt-shell is-edge-left">
        <TouTouProfilePromptCard control={{ onEdit: vi.fn(), onDismiss: vi.fn() }} />
      </div>,
    );

    const card = document.querySelector<HTMLElement>(".tt-card.tt-profile-prompt-card");
    expect(card).not.toBeNull();

    // 内联 left 是相对壳（= 球，64px 方块）的偏移，换算回视口坐标才谈得上"越界"。
    const inlineLeft = Number.parseFloat(card?.style.left ?? "");
    expect(Number.isNaN(inlineLeft)).toBe(false);
    expect(inlineLeft).toBeGreaterThanOrEqual(0);
    const cardLeftInViewport = 24 + inlineLeft;
    expect(cardLeftInViewport).toBeGreaterThanOrEqual(8);
    expect(cardLeftInViewport + 240).toBeLessThanOrEqual(360 - 8);

    // 尾巴的 right 相对卡片右缘，必须落在卡片内，且中心正好指着球心（24 + 32 = 56）。
    const tailRight = Number.parseFloat(card?.style.getPropertyValue("--tt-tail-right") ?? "");
    expect(tailRight).toBeGreaterThanOrEqual(8);
    expect(tailRight).toBeLessThanOrEqual(240 - 8);
    expect(24 + 240 - tailRight - 7).toBe(56);

    // 改左对齐后入场缩放要从左边长出来（球就在左侧），否则会从"球已经不在的那一侧"冒出。
    expect(card?.style.getPropertyValue("--tt-card-origin-x")).toBe("0%");
  });

  it("球在默认右下角时与旧 CSS 逐像素一致（卡右缘贴球右缘，尾巴偏移 25）", () => {
    stubLayout({ cardWidth: 240, shellLeft: 1192, viewportWidth: 1280 });
    render(
      <div className="tt-shell is-edge-right">
        <TouTouProfilePromptCard control={{ onEdit: vi.fn(), onDismiss: vi.fn() }} />
      </div>,
    );

    const card = document.querySelector<HTMLElement>(".tt-card.tt-profile-prompt-card");
    // 视口 1016 − 壳左缘 1192 = −176：卡片向左伸出去，与旧的 right: 0 完全重合。
    expect(card?.style.left).toBe("-176px");
    expect(card?.style.getPropertyValue("--tt-tail-right")).toBe("25px");
    expect(card?.style.getPropertyValue("--tt-card-origin-x")).toBe("100%");
  });

  it("量不到尺寸时不写内联定位，沿用 CSS（避免闪一下再校正）", () => {
    render(<TouTouProfilePromptCard control={{ onEdit: vi.fn(), onDismiss: vi.fn() }} />);

    const card = document.querySelector<HTMLElement>(".tt-card");
    expect(card).not.toBeNull();
    expect(card?.style.left).toBe("");
    expect(card?.style.getPropertyValue("--tt-tail-right")).toBe("");
  });
});
