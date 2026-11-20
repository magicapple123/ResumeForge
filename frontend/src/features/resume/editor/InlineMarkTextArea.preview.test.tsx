// SPDX-License-Identifier: Apache-2.0
/**
 * 显示模型（T01）：**开关 × 焦点 × 有没有格式**。
 *
 * | 开关 | 字段状态 | 渲染 |
 * |---|---|---|
 * | 关 | 任意 | 文本域 |
 * | 开 | 聚焦 / 正在输入 | 文本域 |
 * | 开 | 失焦到**条目编辑器之外** + 有格式 | 静态块 |
 * | 开 | 失焦 + 无格式 | 文本域 |
 *
 * 第三条是唯一的"换形态"路径；其余三条都必须保持文本域，否则用户每点一个字段都要多点一次。
 * 另一条关键性质：**失焦 ≠ 离开字段**——点「加粗 / 字号 / 位置下拉」时文本域会先 blur，
 * 若此时直接切预览，输入框会在用户眼前消失（这是本条最容易写错的回归）。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import InlineMarkTextArea from "./InlineMarkTextArea";
import {
  publishInlineFormatPreview,
  resetInlineFormatPreviewForTests,
} from "./inlineFormatPreviewStore";
import type { RichValue } from "../inline/richRuns";

// 测试夹具一律用 ASCII：`cjkRatchet` 只许存量中文下降，新增测试文件不得引入中文断言。
const VALUE = "alpha beta";
const RUNS = [{ start: 0, end: 2, bold: true, size: 1.5 }];

beforeEach(() => {
  resetInlineFormatPreviewForTests();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  resetInlineFormatPreviewForTests();
});

function Harness({
  value = VALUE,
  runs = RUNS,
  onChange,
}: {
  value?: string;
  runs?: RichValue["runs"];
  onChange?: (next: RichValue) => void;
}) {
  return (
    <AntdApp>
      <div className="document-item-editor" data-document-item-editor="p">
        <InlineMarkTextArea
          ariaLabel="field value"
          value={value}
          rich={{ runs, onChange: onChange ?? (() => undefined) }}
          onChange={() => undefined}
        />
        {/* 同一个条目编辑器里的"工具条按钮"：blur 落到它上面时**不能**切预览。 */}
        <button type="button">bold</button>
      </div>
      <button type="button">outside</button>
    </AntdApp>
  );
}

/** 等 blur 后那一拍 `setTimeout(0)` 跑完。 */
async function flushBlur() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

function enablePreview() {
  act(() => publishInlineFormatPreview(true));
}

describe("InlineMarkTextArea · 显示模型", () => {
  it("开关关：无论聚焦与否都是文本域，没有静态块", async () => {
    const { container } = render(<Harness />);
    const textarea = screen.getByRole("textbox", { name: "field value" }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.blur();
    await flushBlur();
    expect(container.querySelector(".rf-inline-mark-static")).toBeNull();
  });

  it("开关开 + 有格式 + 焦点在编辑器外 → 静态块", async () => {
    enablePreview();
    const { container } = render(<Harness />);
    const textarea = screen.getByRole("textbox", { name: "field value" }) as HTMLTextAreaElement;
    textarea.focus();
    (screen.getByText("outside") as HTMLElement).focus();
    fireEvent.blur(textarea);
    await flushBlur();
    expect(container.querySelector(".rf-inline-mark-static")).toBeTruthy();
    // 静态块里是纯文本（标记不露出来）。
    expect(container.querySelector(".rf-inline-mark-static")?.textContent).toBe(VALUE);
  });

  it("开关开 + 失焦到**同一个条目编辑器**里 → 仍是文本域（点工具条不换形态）", async () => {
    enablePreview();
    const { container } = render(<Harness />);
    const textarea = screen.getByRole("textbox", { name: "field value" }) as HTMLTextAreaElement;
    textarea.focus();
    (screen.getByText("bold") as HTMLElement).focus();
    fireEvent.blur(textarea);
    await flushBlur();
    expect(container.querySelector(".rf-inline-mark-static")).toBeNull();
    expect(screen.getByRole("textbox", { name: "field value" })).toBeTruthy();
  });

  it("开关开 + 无格式（runs 为空）→ 仍是文本域（不制造多余点击）", async () => {
    enablePreview();
    const { container } = render(<Harness runs={[]} />);
    const textarea = screen.getByRole("textbox", { name: "field value" }) as HTMLTextAreaElement;
    textarea.focus();
    (screen.getByText("outside") as HTMLElement).focus();
    fireEvent.blur(textarea);
    await flushBlur();
    expect(container.querySelector(".rf-inline-mark-static")).toBeNull();
  });

  it("点静态块回到编辑态，光标落在末尾（jsdom 无 caretRangeFromPoint 的兜底）", async () => {
    enablePreview();
    const { container } = render(<Harness />);
    const textarea = screen.getByRole("textbox", { name: "field value" }) as HTMLTextAreaElement;
    textarea.focus();
    (screen.getByText("outside") as HTMLElement).focus();
    fireEvent.blur(textarea);
    await flushBlur();
    const block = container.querySelector(".rf-inline-mark-static") as HTMLElement;
    expect(block).toBeTruthy();
    fireEvent.click(block, { clientX: 4, clientY: 4 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const back = screen.getByRole("textbox", { name: "field value" }) as HTMLTextAreaElement;
    expect(back.tagName).toBe("TEXTAREA");
    expect(back.selectionStart).toBe(VALUE.length);
    expect(document.activeElement).toBe(back);
  });

  it("静态块也走无障碍名（切换形态后仍是同一个控件）", async () => {
    enablePreview();
    render(<Harness />);
    const textarea = screen.getByRole("textbox", { name: "field value" }) as HTMLTextAreaElement;
    textarea.focus();
    (screen.getByText("outside") as HTMLElement).focus();
    fireEvent.blur(textarea);
    await flushBlur();
    const block = screen.getByRole("textbox", { name: /field value/ });
    expect(block.getAttribute("role")).toBe("textbox");
    expect(block.getAttribute("aria-readonly")).toBe("true");
  });
});
