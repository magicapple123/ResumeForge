// SPDX-License-Identifier: Apache-2.0
/**
 * 静态预览块（T01）：**开关打开 + 失焦 + 有格式**时替代文本域。
 *
 * 测的是显示模型的四条性质：
 * 1. 字号 / 颜色 / 字重 / 链接下划线**如实**渲染（与遮罩层相反：这里不在文本域下面）；
 * 2. 渲染的是纯文本，绝不出现 `**` / `{@` 这类标记字符；
 * 3. 无格式（runs 为空）时不换形态——不制造"点一下才变输入框"的摩擦；
 * 4. 点击 / Enter 都能回到编辑态，并把光标交给调用方。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InlineMarkStatic from "./InlineMarkStatic";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const VALUE = "重点说明";
const RUNS = [
  { start: 0, end: 2, bold: true, size: 1.5, color: "#2f6fd0" },
  { start: 2, end: 4, link: "https://example.com" },
];

describe("InlineMarkStatic", () => {
  it("按 runs 如实渲染字号/颜色/字重/链接下划线", () => {
    const { container } = render(
      <InlineMarkStatic value={VALUE} runs={RUNS} ariaLabel="内容" onEnterEdit={() => undefined} />,
    );
    const segments = Array.from(
      container.querySelectorAll(".rf-inline-mark-segment"),
    ) as HTMLElement[];
    expect(segments.map((node) => node.textContent).join("")).toBe(VALUE);
    const styled = segments.find((node) => node.textContent === "重点")!;
    expect(styled.style.fontSize).toBe("150%");
    expect(styled.style.color).toBe("rgb(47, 111, 208)");
    expect(styled.className).toContain("rf-inline-mark-bold");
    const link = segments.find((node) => node.textContent === "说明")!;
    expect(link.className).toContain("rf-inline-mark-link");
  });

  it("不含任何标记字符（渲染的是纯文本）", () => {
    const { container } = render(
      <InlineMarkStatic
        value="纯文本"
        runs={[{ start: 0, end: 1, bold: true }]}
        ariaLabel="内容"
        onEnterEdit={() => undefined}
      />,
    );
    expect(container.textContent).toBe("纯文本");
    expect(container.textContent).not.toContain("{@");
    expect(container.textContent).not.toContain("**");
  });

  it("无格式（runs 为空）时逐字渲染，不加任何样式类", () => {
    const { container } = render(
      <InlineMarkStatic value={VALUE} runs={[]} ariaLabel="内容" onEnterEdit={() => undefined} />,
    );
    expect(container.textContent).toBe(VALUE);
    expect(container.querySelector(".rf-inline-mark-bold")).toBeNull();
    expect(container.querySelector(".rf-inline-mark-link")).toBeNull();
  });

  it("可聚焦、读屏当成只读多行文本框，并带'回车编辑'提示", () => {
    render(
      <InlineMarkStatic
        value={VALUE}
        runs={RUNS}
        ariaLabel="内容"
        enterHint="回车或点击进入编辑"
        onEnterEdit={() => undefined}
      />,
    );
    const box = screen.getByRole("textbox");
    expect(box.getAttribute("aria-readonly")).toBe("true");
    expect(box.getAttribute("aria-multiline")).toBe("true");
    expect(box.getAttribute("aria-label")).toContain("回车或点击进入编辑");
    expect(box.getAttribute("tabindex")).toBe("0");
  });

  it("Enter / 空格进入编辑，落点是末尾", () => {
    const onEnterEdit = vi.fn();
    render(
      <InlineMarkStatic value={VALUE} runs={RUNS} ariaLabel="内容" onEnterEdit={onEnterEdit} />,
    );
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.keyDown(box, { key: " " });
    expect(onEnterEdit).toHaveBeenCalledTimes(2);
    expect(onEnterEdit).toHaveBeenNthCalledWith(1, VALUE.length);
    expect(onEnterEdit).toHaveBeenNthCalledWith(2, VALUE.length);
  });

  it("点击进编辑：拿不到点位时落末尾（不猜中间值）", () => {
    const onEnterEdit = vi.fn();
    render(
      <InlineMarkStatic value={VALUE} runs={RUNS} ariaLabel="内容" onEnterEdit={onEnterEdit} />,
    );
    fireEvent.click(screen.getByRole("textbox"), { clientX: 5, clientY: 5 });
    expect(onEnterEdit).toHaveBeenCalledWith(VALUE.length);
  });

  it("拖选后点击不切编辑态（用户意图是复制）", () => {
    const onEnterEdit = vi.fn();
    render(
      <InlineMarkStatic value={VALUE} runs={RUNS} ariaLabel="内容" onEnterEdit={onEnterEdit} />,
    );
    const selection = window.getSelection();
    const node = screen.getByRole("textbox").querySelector(".rf-inline-mark-segment")!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 1);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.click(screen.getByRole("textbox"), { clientX: 5, clientY: 5 });
    expect(onEnterEdit).not.toHaveBeenCalled();
    selection?.removeAllRanges();
  });
});
