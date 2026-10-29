// SPDX-License-Identifier: Apache-2.0
/**
 * 「点字段 → 聚焦 + 选中」的唯一实现。
 *
 * 为什么值得单独测：这条链路的两半都只在真机上看得出来——滚动是布局行为（jsdom 不滚），
 * 聚焦与选中则在 `setTimeout` 之后才发生。所以这里只钉**能钉的部分**：
 *
 * - `selectText` 为真时，聚焦之后那次 `select()` 真的选中整段；
 * - 不传 `selectText`（打开面板的 `initialTarget`）时**不选**，避免"一进来就整段高亮"；
 * - 取消函数生效：卸载之后不再聚焦（否则会把焦点从用户正在打字的框里抢走）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormInstance } from "antd";
import { scrollAndFocusEditorField } from "./editorFieldScroll";

/** 造一个只会 focus 指定 textarea 的假 form（`scrollToField` 只做记录）。 */
function fakeForm(textarea: HTMLTextAreaElement, scrollToField = vi.fn()): FormInstance {
  return {
    scrollToField,
    getFieldInstance: () => ({ focus: () => textarea.focus() }),
  } as unknown as FormInstance;
}

function makeTextarea(value = "hello world"): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  document.body.appendChild(textarea);
  return textarea;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("scrollAndFocusEditorField · 焦点与选区", () => {
  it("selectText 为真：聚焦之后选中整段（加粗 / 斜体 / 链接才有目标）", () => {
    vi.useFakeTimers();
    const textarea = makeTextarea();
    const form = fakeForm(textarea);

    scrollAndFocusEditorField(form, ["name"], { selectText: true });
    vi.advanceTimersByTime(0);

    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
  });

  it("不传 selectText：只聚焦，不替用户全选（打开面板时不该整段高亮）", () => {
    vi.useFakeTimers();
    const textarea = makeTextarea();
    const form = fakeForm(textarea);

    scrollAndFocusEditorField(form, ["name"]);
    vi.advanceTimersByTime(0);

    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(textarea.selectionEnd);
  });

  it("空字段不做全选（没有可选的文字），并且照常滚到字段", () => {
    vi.useFakeTimers();
    const textarea = makeTextarea("");
    const scrollToField = vi.fn();
    const form = fakeForm(textarea, scrollToField);

    scrollAndFocusEditorField(form, ["name"], { selectText: true });
    vi.advanceTimersByTime(0);

    expect(scrollToField).toHaveBeenCalled();
    expect(textarea.selectionStart).toBe(textarea.selectionEnd);
  });

  it("取消之后不再抢焦点", () => {
    vi.useFakeTimers();
    const textarea = makeTextarea();
    const form = fakeForm(textarea);
    const other = makeTextarea("keep me focused");
    other.focus();

    const cancel = scrollAndFocusEditorField(form, ["name"], { selectText: true });
    cancel();
    vi.advanceTimersByTime(0);

    expect(document.activeElement).toBe(other);
  });
});
