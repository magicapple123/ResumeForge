/** 「去改资料」提示卡：内容、动作与出入场生命周期。 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TouTouProfilePromptCard from "./TouTouProfilePromptCard";

afterEach(() => {
  cleanup();
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
});
