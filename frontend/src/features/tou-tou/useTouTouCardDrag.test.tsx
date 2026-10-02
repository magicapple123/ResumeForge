/** 卡片拖拽 hook：夹取不越视口、打开时摆到悬浮球旁边、键盘微调。 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clampCardPosition, useTouTouCardDrag } from "./useTouTouCardDrag";

function Harness(
  props: { selector?: string; fallbackWidth?: number; fallbackHeight?: number } = {},
) {
  const { cardStyle, dragging, gripRef, handleKeyDown, handlePointerDown, placeNextToOrb } =
    useTouTouCardDrag(props);
  return (
    <section className={props.selector?.slice(1) ?? "tt-assistant-card"}>
      <div
        ref={gripRef}
        className="tt-assistant-card-grip"
        role="button"
        tabIndex={0}
        aria-label="拖动投投助手卡片"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        grip
      </div>
      <output data-testid="style">{JSON.stringify(cardStyle)}</output>
      <output data-testid="dragging">{String(dragging)}</output>
      <button type="button" onClick={placeNextToOrb}>
        place
      </button>
    </section>
  );
}

function dragGrip(deltaX: number, deltaY: number) {
  const grip = document.querySelector<HTMLDivElement>(".tt-assistant-card-grip");
  if (!grip) throw new Error("grip not rendered");
  fireEvent.pointerDown(grip, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 100 + deltaX, clientY: 100 + deltaY, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 100 + deltaX, clientY: 100 + deltaY, pointerId: 1 });
}

function readStyle(): Record<string, unknown> {
  return JSON.parse(
    document.querySelector<HTMLElement>("[data-testid='style']")!.textContent ?? "{}",
  );
}

/** 给（或造）一个悬浮球元素，stub 出指定的屏幕位置。 */
function stubOrbAt(left: number, top: number, edge: "left" | "right" | "top" | "bottom") {
  let shell = document.querySelector<HTMLElement>(".tt-shell");
  if (!shell) {
    shell = document.createElement("div");
    shell.className = `tt-shell is-edge-${edge}`;
    const orb = document.createElement("button");
    orb.className = "tt";
    shell.appendChild(orb);
    document.body.appendChild(shell);
  } else {
    shell.className = `tt-shell is-edge-${edge}`;
  }
  const orb = shell.querySelector<HTMLElement>(".tt")!;
  orb.getBoundingClientRect = () =>
    ({ left, top, width: 64, height: 64, right: left + 64, bottom: top + 64 }) as DOMRect;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(".tt-shell").forEach((node) => node.remove());
});

describe("useTouTouCardDrag", () => {
  it("keeps the dragged position inside the viewport", () => {
    render(<Harness />);

    // jsdom 里 getBoundingClientRect 全是 0，夹取走兜底尺寸；往左上拖过头也会被夹回 ≥8px。
    act(() => {
      dragGrip(-500, -500);
    });

    const style = readStyle();
    expect(style.left).toBeGreaterThanOrEqual(8);
    expect(style.top).toBeGreaterThanOrEqual(8);
  });

  it("places the card next to the orb on open (edge right → left of the orb)", () => {
    stubOrbAt(900, 500, "right");
    render(<Harness />);

    fireEvent.click(screenByPlace());

    const style = readStyle();
    // 球贴右：卡片在球左侧（left = 900 - 760 - 12 = 128）；算出来的负 top 被夹回 8。
    expect(style).toMatchObject({ left: 128, top: 8, right: "auto", bottom: "auto" });
  });

  it("places the card to the right of a left-snapped orb", () => {
    stubOrbAt(8, 300, "left");
    render(<Harness />);

    fireEvent.click(screenByPlace());

    const style = readStyle();
    // 球贴左：卡片在球右侧（8 + 64 + 12 = 84），顶部对齐球顶。
    expect(style).toMatchObject({ left: 84, top: 300 });
  });

  it("re-computes the position on every open instead of restoring the last drag", () => {
    stubOrbAt(900, 500, "right");
    const first = render(<Harness />);
    act(() => {
      dragGrip(40, 60);
    });
    // jsdom 里卡片 rect 全 0：拖 40/60 就是 40/60。
    expect(readStyle()).toMatchObject({ left: 40, top: 60 });
    first.unmount();

    // 关闭再打开（组件重建）：不恢复上一次拖动的位置，重新按球位置摆放。
    render(<Harness />);
    expect(readStyle()).toEqual({});
    act(() => {
      fireEvent.click(screenByPlace());
    });
    expect(readStyle()).toMatchObject({ left: 128 });
  });

  it("stays on the edge-snap layout until the user actually drags", () => {
    render(<Harness />);
    const style = readStyle();
    expect(JSON.stringify(style)).toBe("{}");
    // 拖动后才有内联定位。
    act(() => {
      dragGrip(10, 10);
    });
    expect(readStyle()).toMatchObject({ left: 10, top: 10 });
  });

  it("nudges the card with arrow keys by 16px (Shift = 64px)", () => {
    render(<Harness />);
    const grip = document.querySelector<HTMLDivElement>(".tt-assistant-card-grip")!;

    fireEvent.keyDown(grip, { key: "ArrowRight" });
    expect(readStyle()).toMatchObject({ left: 16, top: 8 });

    fireEvent.keyDown(grip, { key: "ArrowDown", shiftKey: true });
    expect(readStyle()).toMatchObject({ left: 16, top: 72 });
  });

  it("clamps positions with the same rule everywhere", () => {
    const clamped = clampCardPosition(-50, -50, { width: 760, height: 680 });
    expect(clamped).toEqual({ left: 8, top: 8 });
  });
});

function screenByPlace(): HTMLElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === "place",
  );
  if (!button) throw new Error("place button not rendered");
  return button;
}
