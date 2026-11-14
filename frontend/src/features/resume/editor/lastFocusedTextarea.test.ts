// SPDX-License-Identifier: Apache-2.0
/**
 * 行内格式的编辑入口（R-11 / F22）：最近聚焦输入框的登记 + 写回 + 记忆选区。
 *
 * 守五件事：①登记能在脱离文档后失效（弹窗关掉不该再命中）；
 * ②写回会触发 React 的 `input`（受控组件才会更新）；③选区被恢复到标记内侧；
 * ④**单行 `input` 与多行 `textarea` 走同一套写回**（F22 以前只认 textarea）；
 * ⑤失焦后仍能读到"最近一次非空选区"，空选区不入记忆。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyInlineEdit,
  getFocusedField,
  getRememberedRange,
  markFocusedField,
  resetInlineMarkFieldsForTests,
} from "./lastFocusedTextarea";

afterEach(() => {
  resetInlineMarkFieldsForTests();
  document.body.innerHTML = "";
});

describe("lastFocusedTextarea", () => {
  it("登记与失效", () => {
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    markFocusedField(area);
    expect(getFocusedField()).toBe(area);

    area.remove();
    expect(getFocusedField()).toBeNull();
  });

  it("写回：值、React input 事件、选区三者都对", () => {
    const area = document.createElement("textarea");
    area.value = "带 8 人团队";
    document.body.appendChild(area);
    markFocusedField(area);

    const onInput = vi.fn();
    area.addEventListener("input", onInput);
    applyInlineEdit({ text: "带 {@size=0.9}8 人{@}团队", start: 13, end: 15 });

    expect(area.value).toBe("带 {@size=0.9}8 人{@}团队");
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(area.selectionStart).toBe(13);
    expect(area.selectionEnd).toBe(15);
  });

  it("F22：单行 input 同样能写回（日期区间 / 列表逐项 / 字段名走的都是它）", () => {
    const input = document.createElement("input");
    input.value = "2023-09";
    document.body.appendChild(input);
    markFocusedField(input);

    const onInput = vi.fn();
    input.addEventListener("input", onInput);
    applyInlineEdit({ text: "{@size=1.25}2023-09{@}", start: 11, end: 18 });

    expect(input.value).toBe("{@size=1.25}2023-09{@}");
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(input.selectionStart).toBe(11);
    expect(input.selectionEnd).toBe(18);
  });

  it("没有登记时静默跳过（不抛错、不改任何东西）", () => {
    expect(() => applyInlineEdit({ text: "x", start: 0, end: 1 })).not.toThrow();
  });

  it("F22：选过一次之后失焦，仍能读到那次非空选区", () => {
    const input = document.createElement("input");
    input.value = "计算机科学与技术";
    document.body.appendChild(input);
    markFocusedField(input);
    input.setSelectionRange(0, 2);
    input.dispatchEvent(new Event("select", { bubbles: true }));
    expect(getRememberedRange()).toEqual({ start: 0, end: 2 });

    // 点工具条：目标先失焦，部分浏览器会把选区复位到末尾
    input.blur();
    input.setSelectionRange(7, 7);
    expect(getRememberedRange()).toEqual({ start: 0, end: 2 });
  });

  it("空选区不进记忆；换了输入框就不再命中上一个的记忆", () => {
    const first = document.createElement("input");
    const second = document.createElement("textarea");
    document.body.append(first, second);
    markFocusedField(first);
    first.setSelectionRange(4, 4);
    first.dispatchEvent(new Event("select", { bubbles: true }));
    expect(getRememberedRange()).toBeNull();

    markFocusedField(second);
    expect(getRememberedRange()).toBeNull();
  });
});
