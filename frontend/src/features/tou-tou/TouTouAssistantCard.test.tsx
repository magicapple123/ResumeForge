import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TouTouAssistantCard from "./TouTouAssistantCard";

afterEach(() => {
  cleanup();
});

describe("TouTouAssistantCard", () => {
  it("keeps the floating assistant dialog separate and closable", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <TouTouAssistantCard open onClose={onClose}>
        <div>投投对话内容</div>
      </TouTouAssistantCard>,
    );

    expect(screen.getByRole("dialog", { name: "投投求职助手" })).toBeInTheDocument();
    expect(screen.getByText("投投对话内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭投投助手" }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <TouTouAssistantCard open={false} onClose={onClose}>
        <div>投投对话内容</div>
      </TouTouAssistantCard>,
    );
    expect(screen.queryByRole("dialog", { name: "投投求职助手" })).not.toBeInTheDocument();
  });

  it("re-positions next to the orb on reopen instead of restoring the last drag", () => {
    const { rerender } = render(
      <TouTouAssistantCard open onClose={vi.fn()}>
        <div>内容</div>
      </TouTouAssistantCard>,
    );
    const card = screen.getByRole("dialog", { name: "投投求职助手" }) as HTMLElement;
    const grip = screen.getByRole("button", { name: "拖动投投助手卡片" });
    expect(grip).toBeInTheDocument();

    // 把手区域内按下、移动超过 4px 阈值、松手：卡片获得内联自由定位。
    act(() => {
      fireEvent.pointerDown(grip, { button: 0, clientX: 200, clientY: 200, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 260, clientY: 250, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 260, clientY: 250, pointerId: 1 });
    });
    expect(card.style.left).toBe("60px");
    expect(card.style.top).toBe("50px");

    // 关闭再打开：不恢复上一次拖动的位置——按用户期望重新摆到悬浮球旁边。
    // jsdom 里没有球 DOM，走兜底几何（右下角球）：left = 1024 - 24 - 64 - 760 - 12 = 164，
    // top = 768 - 24 - 64 + 64 - 680 = 64。
    rerender(
      <TouTouAssistantCard open={false} onClose={vi.fn()}>
        <div>内容</div>
      </TouTouAssistantCard>,
    );
    rerender(
      <TouTouAssistantCard open onClose={vi.fn()}>
        <div>内容</div>
      </TouTouAssistantCard>,
    );
    const reopened = screen.getByRole("dialog", { name: "投投求职助手" }) as HTMLElement;
    expect(reopened.style.left).toBe("164px");
    expect(reopened.style.top).toBe("64px");
  });

  it("a plain click on the grip does not drag the card (position stays as opened)", () => {
    render(
      <TouTouAssistantCard open onClose={vi.fn()}>
        <div>内容</div>
      </TouTouAssistantCard>,
    );
    const card = screen.getByRole("dialog", { name: "投投求职助手" }) as HTMLElement;
    const grip = screen.getByRole("button", { name: "拖动投投助手卡片" });

    act(() => {
      fireEvent.pointerDown(grip, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 12, clientY: 11, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 12, clientY: 11, pointerId: 1 });
    });

    // 位移没超过阈值：不算拖动。内联定位仍是打开时 placeNextToOrb 摆的"球旁边"，
    // 不会被一次误触改变。
    expect(card.style.left).toBe("164px");
    expect(card.style.top).toBe("64px");
  });
});
