// SPDX-License-Identifier: Apache-2.0
/** 简历搜索框：输入停顿自动提交、Enter 立即提交、清空立即生效（QA R.02）。 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ResumeSearchInput, { SEARCH_DEBOUNCE_MS } from "./ResumeSearchInput";

function renderInput(options: { keyword?: string; onCommit?: (value: string) => void } = {}) {
  const onCommit = options.onCommit ?? vi.fn();
  const view = render(<ResumeSearchInput keyword={options.keyword ?? ""} onCommit={onCommit} />);
  const input = screen.getByPlaceholderText(t("resumes.search.placeholder")) as HTMLInputElement;
  return { onCommit, input, ...view };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ResumeSearchInput", () => {
  it("输入停顿 350ms 后自动提交一次（不需要按 Enter）", () => {
    const { onCommit, input } = renderInput();
    fireEvent.change(input, { target: { value: "制造" } });

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("制造");
  });

  it("快速连打只提交最后一次，中间态不会发请求", () => {
    const { onCommit, input } = renderInput();
    fireEvent.change(input, { target: { value: "制" } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: "制造" } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: "制造工" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("制造工");
  });

  it("Enter 立即提交，不等防抖", () => {
    const { onCommit, input } = renderInput();
    fireEvent.change(input, { target: { value: "制造" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith("制造");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("清空立即提交空串（点 × / 退格到空同一条路径）", () => {
    const { onCommit, input } = renderInput({ keyword: "制造" });
    fireEvent.change(input, { target: { value: "" } });

    expect(onCommit).toHaveBeenCalledWith("");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("外部 keyword 变化（URL 深链恢复）会回填输入框", () => {
    const { rerender, input } = renderInput({ keyword: "" });
    rerender(<ResumeSearchInput keyword="制造" onCommit={vi.fn()} />);

    expect(input.value).toBe("制造");
  });

  it("卸载后清掉定时器：不会再迟到提交", () => {
    const { onCommit, input, unmount } = renderInput();
    fireEvent.change(input, { target: { value: "制造" } });
    unmount();
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));

    expect(onCommit).not.toHaveBeenCalled();
  });
});

/**
 * R7：中文输入法组字（拼音 → 上屏）。真机上"打 shen 只发一次请求"必须由用户确认
 * （jsdom 不会真的跑输入法），这里用 `compositionstart` / `compositionend` 事件模拟
 * 浏览器给出的那一段时序：事件名与触发顺序与 Chrome 一致。
 */
describe("ResumeSearchInput 输入法组字（R7）", () => {
  it("组字期间即使过了防抖也不提交；上屏（compositionend）后只提交一次上屏值", () => {
    const { onCommit, input } = renderInput();

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "shen" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 3));
    // 关键断言：拼音阶段的草稿不能变成关键词（否则会去搜「shen」）。
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "沈" } });
    fireEvent.compositionEnd(input);
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("沈");
  });

  it("组字期间按 Enter 是选词，不触发搜索；上屏后仍只发一次", () => {
    const { onCommit, input } = renderInput();

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "shen" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "沈" } });
    fireEvent.compositionEnd(input);
    // 上屏后不再按 Enter：由防抖补上那一次（用户不该为了搜一次再敲一次回车）。
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("沈");
  });
});
