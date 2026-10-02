import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TouTouOrb from "./TouTouOrb";
import { TOU_TOU_FACE_SOURCES } from "./touTouFaces";
import { defaultTouTouContext, TouTouContext } from "./touTouContext";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 当前显示的那张脸（`is-active` 的那张图的 src）。 */
function activeFaceSrc(): string {
  return document.querySelector(".tt-face.is-active")?.getAttribute("src") ?? "";
}

describe("TouTouOrb", () => {
  it("renders an accessible assistant entry", () => {
    render(<TouTouOrb onOpen={vi.fn()} />);

    expect(screen.getByRole("button", { name: "打开求职助手" })).toBeInTheDocument();
    // 张数跟着素材表走：加一张新表情不用回来改这个数字。
    expect(document.querySelectorAll(".tt-face")).toHaveLength(
      Object.keys(TOU_TOU_FACE_SOURCES).length,
    );
    expect(document.querySelectorAll(".tt-face.is-active")).toHaveLength(1);
  });

  it("opens the assistant from click, Enter and Space", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<TouTouOrb onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    // 单击要等双击判窗（280ms）过去才打开；键盘没有双击手势，立即打开。
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(280);
    });
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("opens the clipboard on double click instead of the assistant", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onOpenClipboard = vi.fn();
    render(<TouTouOrb onOpen={onOpen} onOpenClipboard={onOpenClipboard} />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onOpenClipboard).toHaveBeenCalledTimes(1);
    // 挂起的单击打开已被取消，判窗后再推进也不会打开助手。
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("falls back to opening the assistant when clipboard entry is not wired", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<TouTouOrb onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    fireEvent.click(button);
    fireEvent.click(button);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the error face until the caller changes the status", () => {
    vi.useFakeTimers();
    render(<TouTouOrb status="error" />);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    // 助手忙时 inactivity 计时被清、球不会收纳，所以探头脸根本不参与——出错脸全程保持。
    expect(document.querySelector(".tt")).toHaveClass("is-error");
    expect(activeFaceSrc()).toContain("ball-error");
  });

  it("keeps a keyboard-accessible edge sliver after inactivity", () => {
    vi.useFakeTimers();
    render(<TouTouOrb />);

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    const button = screen.getByRole("button", { name: "打开求职助手" });
    expect(button).toHaveClass("is-hidden");
    expect(button).not.toHaveAttribute("aria-hidden", "true");
  });

  it("drags with pointer events and snaps to the nearest edge", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<TouTouOrb onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    fireEvent.pointerDown(button, {
      button: 0,
      clientX: 900,
      clientY: 100,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 0, clientY: -480, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: -480, pointerId: 1 });

    expect(document.querySelector(".tt-shell")).toHaveClass("is-edge-left");
    expect(button).not.toHaveClass("is-dragging");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("can snap to the top and bottom edges instead of only the sides", () => {
    vi.useFakeTimers();
    render(<TouTouOrb />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    fireEvent.pointerDown(button, {
      button: 0,
      clientX: 500,
      clientY: 700,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 500, clientY: -500, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 500, clientY: -500, pointerId: 1 });
    expect(document.querySelector(".tt-shell")).toHaveClass("is-edge-top");

    fireEvent.pointerDown(button, {
      button: 0,
      clientX: 500,
      clientY: 100,
      pointerId: 2,
    });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 900, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: 500, clientY: 900, pointerId: 2 });
    expect(document.querySelector(".tt-shell")).toHaveClass("is-edge-bottom");
  });

  it("发呆时偶尔眨一下眼，眨完就睁回来", () => {
    vi.useFakeTimers();
    // 眨眼间隔是带抖动的；把抖动钉死，间隔就等于下限 6s。
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<TouTouOrb />);

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
    render(<TouTouOrb />);

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
    render(<TouTouOrb status="thinking" />);
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
    expect(document.querySelector(".tt-shell")).toHaveClass("is-edge-left");
  });

  it("does not change its DOM contract when reduced motion is requested", () => {
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
      render(<TouTouOrb />);
      expect(screen.getByRole("button", { name: "打开求职助手" })).toBeInTheDocument();
      expect(document.querySelectorAll(".tt-face")).toHaveLength(
        Object.keys(TOU_TOU_FACE_SOURCES).length,
      );

      // 眨眼是 JS 定时换脸，CSS 的媒体查询拦不住它——这里要真的不眨。
      // 20s 时球已静置收纳：探头张望的脸是 JS 态（不受 motion 偏好影响），
      // 但此刻它显示好奇而不是眨眼借用的睡脸，即证明眨眼被关掉了。
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      expect(activeFaceSrc()).toContain("ball-curious");
      expect(screen.getByRole("button", { name: "打开求职助手" })).toHaveClass("is-hidden");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("peeks with the curious face on all four hidden edges and restores on wake", () => {
    vi.useFakeTimers();
    render(<TouTouOrb />);

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
    render(<TouTouOrb />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole("button", { name: "打开求职助手" })).toHaveClass("is-hidden");
    expect(activeFaceSrc()).toContain("ball-sleep");
  });

  it("stops popping tips when tipsEnabled is off, and resumes when on", () => {
    vi.useFakeTimers();
    function renderOrb(tipsEnabled: boolean) {
      return render(
        <TouTouContext.Provider value={{ ...defaultTouTouContext, tipsEnabled }}>
          <TouTouOrb />
        </TouTouContext.Provider>,
      );
    }

    const off = renderOrb(false);
    act(() => {
      vi.advanceTimersByTime(1_500); // 出场好奇归位：标语计时器随 effect 重排
    });
    act(() => {
      vi.advanceTimersByTime(6_000); // 重排后的首条标语到点（5s + 余量越过边界）
    });
    expect(document.querySelector(".tt-tip")).toBeNull();
    off.unmount();

    // 开关是独立的：关标语不影响球本身，重新开启后周期自然恢复（无需刷新）。
    renderOrb(true);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(document.querySelector(".tt-tip")).not.toBeNull();
  });

  it("shows the content face when petted quickly, then returns to idle", () => {
    vi.useFakeTimers();
    render(<TouTouOrb />);
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
    render(<TouTouOrb status="thinking" />);
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
      render(<TouTouOrb />);
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
