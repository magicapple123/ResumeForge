// SPDX-License-Identifier: Apache-2.0
/**
 * 行内格式的编辑入口（R-11 / F22）端到端：**受控输入框 + 工具条**。
 *
 * 这条用例覆盖"用户在字段框里选中几个字 → 点字号 → 框里的值变成带标记的源串"，
 * 而输入框与按钮是制作台里的同一对组件（`ResizableValueTextArea` / `Input` +
 * `InlineMarkButtons`）。断言必须看**受控 state**：只看 DOM 值会漏掉"React 没收到 input"
 * 这一类失败。
 *
 * F22 的两条新边界也在这里钉住：①单行 `input`（日期区间/列表逐项/字段名）与多行
 * 文本域行为一致；②字号是任意档位，不再是固定的 0.9。
 */
import { App as AntdApp, Input } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import InlineMarkButtons from "../layout/InlineMarkButtons";
import ResizableValueTextArea from "./ResizableValueTextArea";
import {
  applyInlineEdit,
  getFocusedField,
  resetInlineMarkFieldsForTests,
} from "./lastFocusedTextarea";
import { registerInlineMarkField } from "./useInlineMarkRange";

afterEach(() => {
  cleanup();
  resetInlineMarkFieldsForTests();
});

function Toolbar() {
  return (
    <InlineMarkButtons
      getTarget={getFocusedField}
      onCommit={(next) =>
        applyInlineEdit({
          text: next.text,
          start: next.selection.start,
          end: next.selection.end,
        })
      }
    />
  );
}

/** 多行文本域（正文/单行语义的可拖高文本域都走它）。 */
function TextAreaHarness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <AntdApp>
      <ResizableValueTextArea value={value} ariaLabel="摘要" onChange={setValue} />
      <Toolbar />
      <output data-testid="value">{value}</output>
    </AntdApp>
  );
}

/** 单行输入框（日期区间 / 列表逐项 / 作者名 / 字段名都是它）。 */
function InputHarness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <AntdApp>
      <Input
        aria-label="字段名"
        value={value}
        onFocus={registerInlineMarkField}
        onChange={(event) => setValue(event.target.value)}
      />
      <Toolbar />
      <output data-testid="value">{value}</output>
    </AntdApp>
  );
}

describe("行内格式编辑入口", () => {
  it("多行文本域：选中文字点字号 110%，受控值写入标记，选区落在文字内侧", async () => {
    render(<TextAreaHarness initial="带 8 人团队" />);
    const textarea = screen.getByRole("textbox", { name: "摘要" }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(2, 5);

    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.sizeAria") }));
    fireEvent.click(screen.getByText("110%"));

    await waitFor(() =>
      expect(screen.getByTestId("value").textContent).toBe("带 {@size=1.1}8 人{@}团队"),
    );
    // 受控组件会重渲染：DOM 值必须是新值（不是被 React 冲回旧值）。
    expect(textarea.value).toBe("带 {@size=1.1}8 人{@}团队");
    expect(textarea.selectionStart).toBe(13);
    expect(textarea.selectionEnd).toBe(16);
  });

  it("F22：单行输入框同样能插入字号标记（以前这里只会弹「先点中要修改的文本框」）", async () => {
    render(<InputHarness initial="计算机科学与技术" />);
    const input = screen.getByRole("textbox", { name: "字段名" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 2);

    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.sizeAria") }));
    fireEvent.click(screen.getByText("125%"));

    await waitFor(() =>
      expect(screen.getByTestId("value").textContent).toBe("{@size=1.25}计算{@}机科学与技术"),
    );
    expect(input.value).toBe("{@size=1.25}计算{@}机科学与技术");
    expect(input.selectionStart).toBe(12);
    expect(input.selectionEnd).toBe(14);
  });

  it("没有选中文字时给出提示且不写回", async () => {
    render(<TextAreaHarness initial="abc" />);
    const textarea = screen.getByRole("textbox", { name: "摘要" }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(1, 1);

    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.sizeAria") }));
    fireEvent.click(screen.getByText("90%"));
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("abc"));
  });
});
