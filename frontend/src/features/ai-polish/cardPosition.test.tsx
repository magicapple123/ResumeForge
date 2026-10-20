// SPDX-License-Identifier: Apache-2.0
/**
 * AI 润色卡片的定位与拖动（2026-10-20）。
 *
 * 两个用户可见的问题：
 * 1. 卡片原来固定让开整个右键菜单的高度（210px），于是总在点击处**下方两百多像素**；
 *    菜单点完就关掉了，卡片完全可以占用它的位置。现在默认贴着指针出现。
 * 2. 卡片不能移动，遮住正文时只能关掉重来。现在按住标题栏可以拖动，并夹在视口内。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AiPolishCard from "./AiPolishCard";
import { cardAnchor } from "./AiPolishLayer";
import type { SelectionTarget } from "./selectionTarget";

function makeTarget(): SelectionTarget {
  const textarea = document.createElement("textarea");
  textarea.value = "负责渠道投放";
  return {
    kind: "textarea",
    element: textarea,
    start: 0,
    end: 6,
    text: "负责渠道投放",
    rect: { left: 100, top: 100, width: 120, height: 20, right: 220, bottom: 120 },
  };
}

describe("cardAnchor", () => {
  it("贴着指针右下方出现，不再让开整个右键菜单", () => {
    const anchor = cardAnchor({ x: 400, y: 300, target: null, text: "" });
    expect(anchor.left).toBeGreaterThanOrEqual(400);
    expect(anchor.left - 400).toBeLessThan(20);
    // 关键：垂直偏移是个位数（旧实现是 210 + 6）。
    expect(anchor.top - 300).toBeLessThan(20);
  });

  it("下方放不下时翻到指针上方", () => {
    const anchor = cardAnchor({ x: 400, y: window.innerHeight - 40, target: null, text: "" });
    expect(anchor.top).toBeLessThan(window.innerHeight - 40);
    expect(anchor.top).toBeGreaterThanOrEqual(8);
  });
});

describe("AiPolishCard 拖动", () => {
  it("按住标题栏拖动会改变卡片位置，且不会超出视口", () => {
    render(
      <AiPolishCard
        target={makeTarget()}
        left={100}
        top={100}
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />,
    );
    const card = screen.getByRole("dialog", { name: "AI 润色" }) as HTMLElement;
    const head = card.querySelector(".rf-ai-polish-card-head") as HTMLElement;

    expect(card.style.left).toBe("100px");
    fireEvent.pointerDown(head, { button: 0, clientX: 110, clientY: 110 });
    fireEvent.pointerMove(head, { clientX: 310, clientY: 260 });
    fireEvent.pointerUp(head);

    expect(card.style.left).toBe("300px");
    expect(card.style.top).toBe("250px");

    // 再往左上拖过头：夹在 8px 边上，不会跑到视口外。
    fireEvent.pointerDown(head, { button: 0, clientX: 310, clientY: 260 });
    fireEvent.pointerMove(head, { clientX: -500, clientY: -500 });
    fireEvent.pointerUp(head);
    expect(card.style.left).toBe("8px");
    expect(card.style.top).toBe("8px");
  });
});
