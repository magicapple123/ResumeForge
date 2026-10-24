// SPDX-License-Identifier: Apache-2.0
/**
 * W03：文档级快照栈的时间/容量语义（与 `useFormHistory` 逐项对齐）。
 *
 * 时间性质用**假定时器**测：真定时器会让"300ms 合并"取决于墙钟，正是本仓明确禁止的
 * 一类偶发失败。这里不渲染任何组件，纯工厂直接驱动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentHistory,
  DEFAULT_HISTORY_DEBOUNCE_MS,
  DEFAULT_HISTORY_LIMIT,
} from "./history";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(initial = "a") {
  return createDocumentHistory<string>({ initial });
}

describe("history · 300ms 合并", () => {
  it("一次停顿（≥debounceMs）才算一个历史点", () => {
    const history = setup();
    history.push("b");
    vi.advanceTimersByTime(DEFAULT_HISTORY_DEBOUNCE_MS - 1);
    expect(history.canUndo()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe("a");
    expect(history.canRedo()).toBe(true);
  });

  it("连续击键合并成一步：撤回回到连续编辑之前", () => {
    const history = setup();
    history.push("b");
    vi.advanceTimersByTime(100);
    history.push("c");
    vi.advanceTimersByTime(100);
    history.push("d");
    vi.advanceTimersByTime(DEFAULT_HISTORY_DEBOUNCE_MS);
    // 三次击键只有一个历史点：撤回回到 "a"，不是中间态 "c"。
    expect(history.undo()).toBe("a");
    expect(history.canUndo()).toBe(false);
  });

  it("undo 之前先 flush：打完最后一个字立刻 Cmd+Z 也能撤销", () => {
    const history = setup();
    history.push("b");
    // 不推进定时器，直接撤回。
    expect(history.undo()).toBe("a");
    expect(history.redo()).toBe("b");
  });
});

describe("history · 容量与截断", () => {
  it("上限 50 步：超出丢最旧的，撤销只能回到最近 50 步", () => {
    const history = createDocumentHistory<number>({ initial: 0 });
    for (let value = 1; value <= 60; value += 1) {
      history.push(value);
      history.flush();
    }
    expect(history.snapshot().past).toHaveLength(DEFAULT_HISTORY_LIMIT);
    const undoValues: number[] = [];
    while (history.canUndo()) undoValues.push(history.undo() as number);
    expect(undoValues).toHaveLength(DEFAULT_HISTORY_LIMIT);
    // 最近一次改动前的基线是 59，最旧保留到 10（0..9 已被截断）。
    expect(undoValues[0]).toBe(59);
    expect(undoValues[undoValues.length - 1]).toBe(10);
  });

  it("同值重复 push 不制造历史点（滑杆没动 / 重复 setText）", () => {
    const history = setup();
    history.push("a");
    history.flush();
    expect(history.canUndo()).toBe(false);
  });
});

describe("history · 撤销/恢复与清栈", () => {
  it("undo 后新编辑会清空 redo 分支", () => {
    const history = setup();
    history.push("b");
    history.flush();
    expect(history.undo()).toBe("a");
    expect(history.canRedo()).toBe(true);
    history.push("x");
    history.flush();
    expect(history.canRedo()).toBe(false);
    // "a" 之后的新编辑：撤回回到 "a"（而不是被清掉的 "b"）。
    expect(history.undo()).toBe("a");
  });

  it("reset 清栈并以新状态为基线（换记录 / 用最新的）", () => {
    const history = setup();
    history.push("b");
    history.flush();
    expect(history.canUndo()).toBe(true);
    history.reset("fresh");
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBeNull();
    // 新基线之后仍然可以继续记历史。
    history.push("next");
    history.flush();
    expect(history.undo()).toBe("fresh");
  });

  it("30 步连续编辑：连续撤销到初态，再连续恢复到末态", () => {
    const history = createDocumentHistory<number>({ initial: 0 });
    for (let step = 1; step <= 30; step += 1) {
      history.push(step);
      history.flush();
    }
    const undoValues: number[] = [];
    while (history.canUndo()) undoValues.push(history.undo() as number);
    expect(undoValues).toHaveLength(30);
    expect(undoValues[0]).toBe(29);
    expect(undoValues[undoValues.length - 1]).toBe(0);

    const redoValues: number[] = [];
    while (history.canRedo()) redoValues.push(history.redo() as number);
    expect(redoValues).toHaveLength(30);
    expect(redoValues[0]).toBe(1);
    expect(redoValues[redoValues.length - 1]).toBe(30);
  });
});
