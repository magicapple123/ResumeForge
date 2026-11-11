// SPDX-License-Identifier: Apache-2.0
/**
 * 划词浮条（#27A）：mouseup 后一帧定位（距选区 8px）、Escape/点别处收起、
 * 不拦截原生右键菜单、复制在浮条内就地反馈。
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import TouTouSelectionMenu from "./TouTouSelectionMenu";
import { renderOrb as renderWithProviders } from "./touTouTestUtils";
import type { DomSelectionSnapshot } from "./touTouSelection";

const REAL_RECT = HTMLElement.prototype.getBoundingClientRect;

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** 把 `window.getSelection()` 换成一份可控的选区；返回文本节点作为 anchorNode。 */
function stubSelection(options: { text: string; rects: DOMRect[]; anchor: Node }) {
  const range = {
    getClientRects: () => options.rects,
    getBoundingClientRect: () => options.rects[0] ?? rect(0, 0, 0, 0),
    toString: () => options.text,
    collapsed: false,
  } as unknown as Range;
  const selection = {
    anchorNode: options.anchor,
    focusNode: options.anchor,
    isCollapsed: false,
    rangeCount: 1,
    toString: () => options.text,
    getRangeAt: () => range,
    type: "Range",
  } as unknown as Selection;
  vi.spyOn(window, "getSelection").mockReturnValue(selection);
}

/** 等浮条出现：回调必须 throw 才会让 waitFor 重试（返回 null 会立即resolve）。 */
async function waitForBar(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector<HTMLElement>(".tt-selection-bar");
    if (!found) throw new Error("selection bar not mounted yet");
    return found;
  });
}

function mountParagraph(text: string): Text {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  document.body.appendChild(paragraph);
  return paragraph.firstChild as Text;
}

afterEach(() => {
  document.querySelectorAll("p").forEach((node) => node.remove());
  HTMLElement.prototype.getBoundingClientRect = REAL_RECT;
});

describe("TouTouSelectionMenu", () => {
  it("mouseup 后一帧浮出，落点在选区下方 8px（单字符也居中夹回视口）", async () => {
    // 浮条自身量到 320×40，jsdom 不布局，只能打桩。
    HTMLElement.prototype.getBoundingClientRect = function staged(this: HTMLElement): DOMRect {
      if (this.classList.contains("tt-selection-bar")) return rect(0, 0, 320, 40);
      return rect(0, 0, 0, 0);
    } as typeof REAL_RECT;
    const anchor = mountParagraph("你好");
    stubSelection({ text: "你", rects: [rect(100, 40, 7, 17)], anchor });
    const onAction = vi.fn();
    renderWithProviders(<TouTouSelectionMenu enabled onAction={onAction} />);

    fireEvent.mouseUp(document);

    const bar = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".tt-selection-bar");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(bar.style.top).toBe("125px");
    expect(bar.style.left).toBe("8px");
    expect(bar).toHaveAccessibleName(t("touTou.selection.bar"));
  });

  it("跨段落选区：浮条落在并集矩形下沿 8px", async () => {
    HTMLElement.prototype.getBoundingClientRect = function staged(this: HTMLElement): DOMRect {
      if (this.classList.contains("tt-selection-bar")) return rect(0, 0, 320, 40);
      return rect(0, 0, 0, 0);
    } as typeof REAL_RECT;
    const anchor = mountParagraph("第一段第二段");
    stubSelection({
      text: "第一段 第二段",
      rects: [rect(100, 40, 200, 20), rect(124, 40, 180, 20)],
      anchor,
    });
    renderWithProviders(<TouTouSelectionMenu enabled onAction={vi.fn()} />);
    fireEvent.mouseUp(document);
    const bar = await waitForBar();
    // 并集 bottom = 144，+8 = 152。
    expect(bar.style.top).toBe("152px");
  });

  it("Escape 收起", async () => {
    const anchor = mountParagraph("你好");
    stubSelection({ text: "你", rects: [rect(100, 40, 7, 17)], anchor });
    renderWithProviders(<TouTouSelectionMenu enabled onAction={vi.fn()} />);
    fireEvent.mouseUp(document);
    expect(await screen.findByRole("toolbar")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".tt-selection-bar")).toBeNull());
  });

  it("点别处收起（mousedown 不在浮条内）", async () => {
    const anchor = mountParagraph("你好");
    stubSelection({ text: "你", rects: [rect(100, 40, 7, 17)], anchor });
    renderWithProviders(<TouTouSelectionMenu enabled onAction={vi.fn()} />);
    fireEvent.mouseUp(document);
    expect(await screen.findByRole("toolbar")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(document.querySelector(".tt-selection-bar")).toBeNull());
  });

  it("不拦原生右键菜单：contextmenu 事件不被 preventDefault", async () => {
    const anchor = mountParagraph("你好");
    stubSelection({ text: "你", rects: [rect(100, 40, 7, 17)], anchor });
    renderWithProviders(<TouTouSelectionMenu enabled onAction={vi.fn()} />);
    fireEvent.mouseUp(document);
    expect(await screen.findByRole("toolbar")).toBeInTheDocument();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("点动作把选区快照交回宿主，浮条随即收起", async () => {
    const anchor = mountParagraph("你好");
    stubSelection({ text: "解释这段", rects: [rect(100, 40, 40, 17)], anchor });
    const onAction = vi.fn<(action: string, snapshot: DomSelectionSnapshot) => void>();
    renderWithProviders(<TouTouSelectionMenu enabled onAction={onAction} />);
    fireEvent.mouseUp(document);
    fireEvent.click(await screen.findByRole("button", { name: t("touTou.selection.explain") }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0]).toBe("explain");
    expect(onAction.mock.calls[0][1].text).toBe("解释这段");
    expect(document.querySelector(".tt-selection-bar")).toBeNull();
  });

  it("复制在浮条内完成并就地反馈", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const anchor = mountParagraph("你好");
    stubSelection({ text: "要复制的文字", rects: [rect(100, 40, 60, 17)], anchor });
    renderWithProviders(<TouTouSelectionMenu enabled onAction={vi.fn()} />);
    fireEvent.mouseUp(document);
    fireEvent.click(await screen.findByRole("button", { name: t("touTou.selection.copy") }));
    expect(writeText).toHaveBeenCalledWith("要复制的文字");
    expect(await screen.findByText(t("touTou.selection.copied"))).toBeInTheDocument();
  });

  it("输入框里的选择也能浮出（window.getSelection 看不到它）", async () => {
    const textarea = document.createElement("textarea");
    textarea.value = "负责订单服务";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, 6);
    textarea.getBoundingClientRect = () => rect(60, 10, 400, 60);
    const onAction = vi.fn();
    renderWithProviders(<TouTouSelectionMenu enabled onAction={onAction} />);
    fireEvent.mouseUp(textarea);
    expect(await waitForBar()).toBeInTheDocument();
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: t("touTou.selection.explain") }));
    expect(onAction).toHaveBeenCalledTimes(1);
    textarea.remove();
  });
});
