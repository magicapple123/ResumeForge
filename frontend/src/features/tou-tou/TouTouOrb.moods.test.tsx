import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TouTouOrb from "./TouTouOrb";
import { defaultTouTouContext, TouTouContext } from "./touTouContext";
import { setProfileEditControl } from "./profileSaveBridge";
import { activeFaceSrc } from "./touTouTestUtils";

describe("TouTouOrb (moods)", () => {
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

  it("renders the profile prompt card only while an edit control is registered", () => {
    vi.useFakeTimers();
    const onEdit = vi.fn();
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    render(<TouTouOrb onOpen={onOpen} />);

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

    const { rerender } = render(
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

  it("holds the rotating tip while the profile prompt card is up", () => {
    // 两者都贴在球的正上方，球停在下边缘时更是同一竖带；标语层级更高且可点，
    // 不压掉就会盖住卡片、吃掉它的按钮。
    vi.useFakeTimers();
    render(<TouTouOrb />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    act(() => {
      vi.advanceTimersByTime(1_500); // 出场好奇归位：标语计时器随 effect 重排
    });
    act(() => {
      vi.advanceTimersByTime(6_000); // 首条标语到点
    });
    expect(document.querySelector(".tt-tip")).not.toBeNull();

    // 提示卡一出现，已经在屏上的标语要立刻收起来。
    act(() => {
      setProfileEditControl({ onEdit: vi.fn(), onDismiss: vi.fn() });
    });
    expect(document.querySelector(".tt-tip")).toBeNull();

    // 球静置 12s 就会收纳，收纳期间本来也不弹标语（与提示卡无关）——所以要唤醒着
    // 越过轮播点：推进到它前 10s（仍在唤醒窗口内），唤醒后再跨过去。
    const crossNextTipTick = () => {
      act(() => {
        vi.advanceTimersByTime(110_000);
      });
      // 唤醒与推进要分成两个 act：套在同一个 act 里的话，嵌套 act 不会中途 flush，
      // 唤醒带来的 hidden/status 更新要等外层 act 结束才落到 ref 镜像上——轮播点读到的
      // 就还是"睡着"，那样测出来的是"球在睡"而不是"提示卡压着标语"。
      act(() => {
        fireEvent.mouseEnter(button);
      });
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
    };

    // 卡片在场期间，轮播点也不冒标语。
    crossNextTipTick();
    expect(document.querySelector(".tt-tip")).toBeNull();

    // 关掉提示卡后周期自然恢复（不必刷新页面）。
    act(() => {
      setProfileEditControl(null);
    });
    crossNextTipTick();
    expect(document.querySelector(".tt-tip")).not.toBeNull();
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
