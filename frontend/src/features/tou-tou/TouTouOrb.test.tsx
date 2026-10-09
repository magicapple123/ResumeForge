import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TouTouOrb from "./TouTouOrb";
import { setProfileSaveControl } from "./profileSaveBridge";
import { activeFaceSrc } from "./touTouTestUtils";

describe("TouTouOrb", () => {
  it("renders an accessible assistant entry", () => {
    render(<TouTouOrb onOpen={vi.fn()} />);

    expect(screen.getByRole("button", { name: "打开求职助手" })).toBeInTheDocument();
    // 只渲染 activeFace 对应的一张 img：src 随表情切换，不再 6 张常驻 DOM。
    // 出场先「好奇」，所以初始脸是 curious 而不是 idle。
    expect(document.querySelectorAll(".tt-face")).toHaveLength(1);
    expect(document.querySelectorAll(".tt-face.is-active")).toHaveLength(1);
    expect(activeFaceSrc()).toContain("ball-curious");
  });

  it("shows a hover tooltip describing click and double-click actions", async () => {
    vi.useFakeTimers();
    render(<TouTouOrb onOpen={vi.fn()} />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    fireEvent.mouseEnter(button);
    act(() => {
      vi.advanceTimersByTime(300); // 覆盖 antd Tooltip 默认的 mouseEnterDelay
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("单击：打开求职助手；双击：打开投递剪贴板");
    // overlayStyle 落在 .ant-tooltip 根节点上（role=tooltip 的是内层内容节点）；
    // 3450 高于球的 3400——球被压住的 antd 默认 Tooltip（1070）等于没有。
    const overlay = tooltip.closest(".ant-tooltip") as HTMLElement;
    expect(overlay.style.zIndex).toBe("3450");
  });

  it("still opens the assistant while the tooltip is armed (hover does not eat clicks)", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<TouTouOrb onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "打开求职助手" });

    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    act(() => {
      vi.advanceTimersByTime(280); // 双击判窗过去后单击才生效
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders the save/cancel card only while a profile save control is registered", () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const onOpen = vi.fn();
    render(<TouTouOrb onOpen={onOpen} />);

    // 无 control 时完全不渲染（连尾巴和圆点也没有）。
    expect(document.querySelector(".tt-save-card")).toBeNull();
    expect(document.querySelector(".tt-save-card-tail")).toBeNull();
    expect(document.querySelector(".tt-save-card-dot")).toBeNull();
    expect(document.querySelector(".tt-save-dot")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存资料" })).toBeNull();

    act(() => {
      setProfileSaveControl({ onSave, onCancel });
    });

    expect(document.querySelector(".tt-save-card")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    // antd 两字按钮 DOM 可访问名带空格（"取 消"）。
    fireEvent.click(screen.getByRole("button", { name: "取 消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // 卡片是球的兄弟节点，点击不应触发球的单/双击开卡逻辑。
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onOpen).not.toHaveBeenCalled();

    // 页面保存/取消后撤掉 control：先播 180ms 退场动画，动画结束才真正卸载。
    act(() => {
      setProfileSaveControl(null);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector(".tt-save-card")).toBeNull();
  });

  it("shows a status dot in the title row and a ball-anchored tail on the save card", () => {
    vi.useFakeTimers();
    render(<TouTouOrb onOpen={vi.fn()} />);

    act(() => {
      setProfileSaveControl({ onSave: vi.fn(), onCancel: vi.fn() });
    });

    const card = document.querySelector(".tt-save-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("资料有未保存的修改")).toBeInTheDocument();
    // 脏状态圆点从球上挪进了卡片标题行，纯装饰（读屏隐藏）。
    const dot = card?.querySelector(".tt-save-card-dot");
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute("aria-hidden", "true");
    // 球根节点内不再挂脏状态圆点。
    expect(document.querySelector(".tt-shell .tt-save-dot")).toBeNull();
    // 尾巴是真实元素（不是 ::after），带 class 便于断言，且对读屏隐藏。
    expect(card?.querySelector(".tt-save-card-tail")).toBeInTheDocument();
  });

  it("shows the loading state on the save button while saving", () => {
    vi.useFakeTimers();
    render(<TouTouOrb onOpen={vi.fn()} />);

    act(() => {
      setProfileSaveControl({ onSave: vi.fn(), onCancel: vi.fn(), saving: true });
    });

    // loading 时 antd 会注入带 aria-label="loading" 的图标，按钮可访问名带前缀——用正则匹配。
    expect(screen.getByRole("button", { name: /保存资料/ })).toHaveClass("ant-btn-loading");
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
      expect(document.querySelectorAll(".tt-face")).toHaveLength(1);

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
});
