// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TouTouOrb from "./TouTouOrb";
import { defaultTouTouContext, TouTouContext } from "./touTouContext";
import { setProfileEditControl } from "./profileSaveBridge";
import { activeFaceSrc, renderOrb } from "./touTouTestUtils";

describe("TouTouOrb (moods)", () => {
  it("发呆时偶尔眨一下眼，眨完就睁回来", () => {
    vi.useFakeTimers();
    // 眨眼间隔是带抖动的；把抖动钉死，间隔就等于下限 6s。
    vi.spyOn(Math, "random").mockReturnValue(0);
    renderOrb(<TouTouOrb />);

    act(() => {
      vi.advanceTimersByTime(1_500); // 出场的好奇先回落到正常
    });
    expect(activeFaceSrc()).toContain("ball-idle");

    act(() => {
      vi.advanceTimersByTime(6_000); // 眨眼开始：借用闭眼的素材
    });
    expect(activeFaceSrc()).toContain("ball-sleep");
    expect(document.querySelector(".tt")).toHaveClass("is-idle");

    act(() => {
      vi.advanceTimersByTime(130); // 眨完睁回来
    });
    expect(activeFaceSrc()).toContain("ball-idle");
  });

  it("久置睡着时留着更多在屏幕里，并飘出 Zzz", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    const button = screen.getByRole("button", { name: "打开求职助手" });
    expect(button).toHaveClass("is-sleep");
    expect(button).toHaveClass("is-hidden");
    expect(activeFaceSrc()).toContain("ball-sleep");
    // 收纳成细边之后闭着的眼睛太小了，得靠 Zzz 才认得出"它睡着了"。
    // （放宽后的收纳比例写在 CSS 里，jsdom 不加载样式表，这一条守不到。）
    expect(document.querySelector(".tt-zzz")).toBeInTheDocument();
  });

  it("助手在思考时拖拽不会把表情顶掉", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb status="thinking" />);
    const button = screen.getByRole("button", { name: "打开求职助手" });
    expect(activeFaceSrc()).toContain("ball-thinking");

    fireEvent.pointerDown(button, { button: 0, clientX: 900, clientY: 400, pointerId: 1 });
    expect(activeFaceSrc()).toContain("ball-thinking");

    fireEvent.pointerMove(window, { clientX: 80, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 300, pointerId: 1 });

    // 松手后的回弹定时器也不该把思考脸收回正常。
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(activeFaceSrc()).toContain("ball-thinking");
    // jsdom 没有布局：`.tt-shell` 的 rect 全是 0，拖动起点只能退回"贴边默认位"。
    // P1-4 把贴边缝隙从 24px 收到 2px 之后，同样的位移落点从 (116, 580) 变成 (138, 602)
    // ——离底边 102px、离左边 138px，最近边因此是底边。这里断言的是"拖完仍然贴着某条边"，
    // 具体哪条边在无布局环境里取决于贴边缝隙，不是这条用例要守的东西。
    expect(document.querySelector(".tt-shell")).toHaveClass("is-edge-bottom");
  });

  it("peeks with the curious face on all four hidden edges and restores on wake", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb />);

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    const button = screen.getByRole("button", { name: "打开求职助手" });
    expect(button).toHaveClass("is-hidden");
    // 探头张望：露出近一半 + 好奇脸朝屏幕内（CSS 动画在样式表里，jsdom 只能钉 JS 侧的脸）。
    expect(activeFaceSrc()).toContain("ball-curious");

    fireEvent.mouseEnter(button);
    expect(button).not.toHaveClass("is-hidden");
    expect(activeFaceSrc()).toContain("ball-idle");
  });

  it("keeps the sleeping face while hidden — a peeking orb is still asleep", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole("button", { name: "打开求职助手" })).toHaveClass("is-hidden");
    expect(activeFaceSrc()).toContain("ball-sleep");
  });

  it("renders the profile prompt card only while an edit control is registered", () => {
    vi.useFakeTimers();
    const onEdit = vi.fn();
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    renderOrb(<TouTouOrb onOpen={onOpen} />);

    expect(document.querySelector(".tt-profile-prompt-card")).toBeNull();

    act(() => {
      setProfileEditControl({ onEdit, onDismiss });
    });
    expect(document.querySelector(".tt-profile-prompt-card")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "去编辑" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    // 卡片是球的兄弟节点，点击不应触发球的单/双击开卡逻辑。
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onOpen).not.toHaveBeenCalled();

    act(() => {
      setProfileEditControl(null);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector(".tt-profile-prompt-card")).toBeNull();
  });

  it("keeps the profile prompt card quiet while tipsEnabled is off", () => {
    // 「提示标语」是球上主动提示的总开关（设置里也是这么写的）：页面照样注册，
    // 球侧不渲染；重新打开开关，卡片自然回来，不用刷新页面。
    vi.useFakeTimers();
    act(() => {
      setProfileEditControl({ onEdit: vi.fn(), onDismiss: vi.fn() });
    });

    const { rerender } = renderOrb(
      <TouTouContext.Provider value={{ ...defaultTouTouContext, tipsEnabled: false }}>
        <TouTouOrb />
      </TouTouContext.Provider>,
    );
    expect(document.querySelector(".tt-profile-prompt-card")).toBeNull();

    rerender(
      <TouTouContext.Provider value={{ ...defaultTouTouContext, tipsEnabled: true }}>
        <TouTouOrb />
      </TouTouContext.Provider>,
    );
    expect(document.querySelector(".tt-profile-prompt-card")).toBeInTheDocument();
  });

  it("shows the content face when petted quickly, then returns to idle", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    act(() => {
      vi.advanceTimersByTime(1_500); // 出场的好奇先回落到正常
    });
    // 700ms 窗口内快速划过 ≥3 笔（每笔间隔 ≥120ms 的节流）→ 被抚摸。
    act(() => {
      fireEvent.mouseMove(button);
      vi.advanceTimersByTime(150);
      fireEvent.mouseMove(button);
      vi.advanceTimersByTime(150);
      fireEvent.mouseMove(button);
    });

    expect(button).toHaveClass("is-petted");
    expect(activeFaceSrc()).toContain("ball-done");

    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(button).not.toHaveClass("is-petted");
    expect(activeFaceSrc()).toContain("ball-idle");
  });

  it("does not show the pet face while the assistant is busy", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb status="thinking" />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    act(() => {
      fireEvent.mouseMove(button);
      vi.advanceTimersByTime(150);
      fireEvent.mouseMove(button);
      vi.advanceTimersByTime(150);
      fireEvent.mouseMove(button);
    });

    expect(button).not.toHaveClass("is-petted");
    expect(activeFaceSrc()).toContain("ball-thinking");
  });

  it("swaps faces but not the sway class when reduced motion is requested", () => {
    vi.useFakeTimers();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    try {
      renderOrb(<TouTouOrb />);
      const button = screen.getByRole("button", { name: "打开求职助手" });
      act(() => {
        vi.advanceTimersByTime(1_500);
        fireEvent.mouseMove(button);
        vi.advanceTimersByTime(150);
        fireEvent.mouseMove(button);
        vi.advanceTimersByTime(150);
        fireEvent.mouseMove(button);
      });

      // reduced-motion：只换脸不摇（不加 is-petted 摇摆类），脸照常换成满足的 done。
      expect(button).not.toHaveClass("is-petted");
      expect(activeFaceSrc()).toContain("ball-done");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });
});
