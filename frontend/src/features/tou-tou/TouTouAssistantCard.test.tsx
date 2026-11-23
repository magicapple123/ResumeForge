// SPDX-License-Identifier: Apache-2.0
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
    // jsdom 没有布局：球量不到，只能退回"贴右下角"的兜底几何（`useTouTouCardDrag` 的
    // DEFAULT_ORB_EDGE）。P1-4 把贴边缝隙从 24px 收到 2px，球的兜底 left 因此右移 22px，
    // 卡片（摆在球左侧、宽 760 + 间隙 12）从 164 变成 186。
    expect(reopened.style.left).toBe("186px");
    expect(reopened.style.top).toBe("86px");
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
    // 不会被一次误触改变。（186 / 86 的来源见上一条用例：jsdom 的兜底球几何 + 2px 贴边，
    // 贴边从 24px 收到 2px 后两项都右/下移 22px。）
    expect(card.style.left).toBe("186px");
    expect(card.style.top).toBe("86px");
  });

  it("卡片内按 Esc 关闭卡片；输入法组合中的 Esc 不关", () => {
    const onClose = vi.fn();
    render(
      <TouTouAssistantCard open onClose={onClose}>
        <textarea aria-label="提问" />
      </TouTouAssistantCard>,
    );
    const input = screen.getByRole("textbox", { name: "提问" });

    // 输入法组合中（中文候选取消）不算"关卡片"。
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();

    // 其他按键也不关。
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("内层用 stopPropagation 消费掉的 Esc 不关卡片", () => {
    const onClose = vi.fn();
    render(
      <TouTouAssistantCard open onClose={onClose}>
        <button type="button" onKeyDown={(event) => event.stopPropagation()}>
          二级菜单项
        </button>
      </TouTouAssistantCard>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "二级菜单项" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("`+` 面板展开时按 Esc 只收面板，不收卡片", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <TouTouAssistantCard open onClose={onClose}>
        <textarea aria-label="提问" />
      </TouTouAssistantCard>,
    );
    const input = screen.getByRole("textbox", { name: "提问" });
    const card = screen.getByRole("dialog", { name: "投投求职助手" });

    // `+` 面板是 antd Dropdown：开着时触发器带这个类与 aria-expanded。
    const trigger = document.createElement("button");
    trigger.className = "ant-dropdown-trigger";
    trigger.setAttribute("aria-expanded", "true");
    card.appendChild(trigger);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    // 面板收起后再按 Esc：这次归卡片（判据只看 aria-expanded，与节点顺序无关）。
    trigger.setAttribute("aria-expanded", "false");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
  });
});
