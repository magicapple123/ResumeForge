// SPDX-License-Identifier: Apache-2.0
/**
 * I-13 的验收用例：**结构化字段的样式改动只写 `rich.runs`**。
 *
 * 与 `inlineFormatEntry.test.tsx`（标记版）刻意成对：那条证明"没登记 rich 的输入框仍走
 * 标记串"（兼容路径），这条证明"登记了 rich 的字段一次改动之后，受控值里没有 `**` /
 * `{@` / `](`，样式全在 runs 上"。
 *
 * 为什么必须看**受控 state**：只看 DOM 值会漏掉"React 没收到新值"这一类失败——文本域是
 * 受控的，DOM 显示正确不代表宿主拿到了新值。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import InlineMarkButtons from "../layout/InlineMarkButtons";
import InlineMarkTextArea from "./InlineMarkTextArea";
import { getFocusedField, resetInlineMarkFieldsForTests } from "./lastFocusedTextarea";
import type { RichValue } from "../inline/richRuns";

afterEach(() => {
  cleanup();
  resetInlineMarkFieldsForTests();
});

function Harness({ initial }: { initial: RichValue }) {
  const [value, setValue] = useState(initial);
  return (
    <AntdApp>
      <InlineMarkTextArea
        ariaLabel="rich-field"
        value={value.text}
        rich={{ runs: value.runs, onChange: setValue }}
        onChange={() => undefined}
      />
      <InlineMarkButtons getTarget={getFocusedField} onCommit={() => undefined} />
      <output data-testid="text">{value.text}</output>
      <output data-testid="runs">{JSON.stringify(value.runs)}</output>
    </AntdApp>
  );
}

function expectNoMarkers(text: string | null) {
  expect(text).not.toBeNull();
  expect(text).not.toContain("**");
  expect(text).not.toContain("{@");
  expect(text).not.toContain("](");
}

describe("structured field: style edits write runs", () => {
  it("bold writes a run and leaves the value marker-free", async () => {
    render(<Harness initial={{ text: "team lead", runs: [] }} />);
    const textarea = screen.getByRole("textbox", { name: "rich-field" }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 4);

    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.boldAria") }));

    await waitFor(() =>
      expect(screen.getByTestId("runs").textContent).toBe(
        JSON.stringify([{ start: 0, end: 4, bold: true }]),
      ),
    );
    expect(screen.getByTestId("text").textContent).toBe("team lead");
    expect(textarea.value).toBe("team lead");
    expectNoMarkers(textarea.value);
  });

  it("size writes a run and never encodes a marker", async () => {
    render(<Harness initial={{ text: "team lead", runs: [] }} />);
    const textarea = screen.getByRole("textbox", { name: "rich-field" }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(5, 9);

    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.sizeAria") }));
    fireEvent.click(screen.getByText("110%"));

    await waitFor(() =>
      expect(screen.getByTestId("runs").textContent).toBe(
        JSON.stringify([{ start: 5, end: 9, size: 1.1 }]),
      ),
    );
    expectNoMarkers(textarea.value);
  });

  it("typing shifts the existing run instead of re-encoding it", async () => {
    render(<Harness initial={{ text: "team", runs: [{ start: 0, end: 4, bold: true }] }} />);
    const textarea = screen.getByRole("textbox", { name: "rich-field" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "the team" } });

    await waitFor(() =>
      expect(screen.getByTestId("runs").textContent).toBe(
        JSON.stringify([{ start: 4, end: 8, bold: true }]),
      ),
    );
    expectNoMarkers(screen.getByTestId("text").textContent);
  });
});
