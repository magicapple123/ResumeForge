import { Form } from "antd";
import type { FormInstance } from "antd";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFormHistory, type FormHistory, type UseFormHistoryOptions } from "./useFormHistory";

type Values = { name: string; city: string };

const BASE: Values = { name: "张三", city: "杭州" };

function useHarness(options: UseFormHistoryOptions) {
  const [form] = Form.useForm<Values>();
  const history = useFormHistory(form, options);
  return { form, history };
}

/** 挂载后把表单设成 BASE 并以它作为基线（真实页面由数据加载 + resetKey 完成这一步）。 */
function mountHistory(options: UseFormHistoryOptions = { debounceMs: 50 }) {
  const harness = renderHook((props: UseFormHistoryOptions) => useHarness(props), {
    initialProps: options,
  });
  act(() => {
    harness.result.current.form.setFieldsValue(BASE);
    harness.result.current.history.reset();
  });
  return harness;
}

/** 只依赖内部结构，这样 resetKey 那组用例（props 形状不同）也能复用。 */
interface HarnessShape {
  result: { current: { form: FormInstance<Values>; history: FormHistory } };
}

function typeValue(harness: HarnessShape, values: Partial<Values>) {
  act(() => {
    harness.result.current.form.setFieldsValue(values);
    harness.result.current.history.push();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFormHistory", () => {
  it("击键经防抖合并成一个历史点，撤回后回到上一个值", () => {
    const harness = mountHistory();
    typeValue(harness, { name: "李四" });

    // 防抖窗口内还没落地：此时不该能撤回。
    expect(harness.result.current.history.canUndo).toBe(false);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(harness.result.current.history.canUndo).toBe(true);

    act(() => harness.result.current.history.undo());
    expect(harness.result.current.form.getFieldsValue(true)).toMatchObject(BASE);
    expect(harness.result.current.history.canUndo).toBe(false);
    expect(harness.result.current.history.canRedo).toBe(true);
  });

  it("撤回后恢复（redo）回到改动后的值", () => {
    const harness = mountHistory();
    typeValue(harness, { name: "李四" });
    act(() => {
      vi.advanceTimersByTime(80);
    });
    act(() => harness.result.current.history.undo());
    act(() => harness.result.current.history.redo());

    expect(harness.result.current.form.getFieldsValue(true)).toMatchObject({ name: "李四" });
    expect(harness.result.current.history.canRedo).toBe(false);
  });

  it("打完字立刻撤回也能撤动（先 flush 待提交的快照）", () => {
    const harness = mountHistory();
    typeValue(harness, { name: "王五" });
    // 不推进定时器，直接撤回。
    act(() => harness.result.current.history.undo());
    expect(harness.result.current.form.getFieldsValue(true)).toMatchObject({ name: "张三" });
  });

  it("程序化写入（undo/redo 自己调 setFieldsValue）不会再次入栈", () => {
    const harness = mountHistory();
    typeValue(harness, { name: "李四" });
    act(() => {
      vi.advanceTimersByTime(80);
    });
    act(() => harness.result.current.history.undo());

    // 撤回本身若被记成一步新改动，这里会重新变成"可撤回"。
    expect(harness.result.current.history.canUndo).toBe(false);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(harness.result.current.history.canUndo).toBe(false);
  });

  it("超过 limit 时丢最旧的历史点", () => {
    const harness = mountHistory({ debounceMs: 10, limit: 2 });
    for (const name of ["A", "B", "C"]) {
      typeValue(harness, { name });
      act(() => {
        vi.advanceTimersByTime(20);
      });
    }
    // 只有最近两步可退。
    act(() => harness.result.current.history.undo());
    act(() => harness.result.current.history.undo());
    expect(harness.result.current.history.canUndo).toBe(false);
    expect(harness.result.current.form.getFieldsValue(true)).toMatchObject({ name: "A" });
  });

  it("reset 清空两条栈并把当前值当新基线", () => {
    const harness = mountHistory();
    typeValue(harness, { name: "李四" });
    act(() => {
      vi.advanceTimersByTime(80);
    });
    act(() => harness.result.current.history.reset());

    expect(harness.result.current.history.canUndo).toBe(false);
    expect(harness.result.current.history.canRedo).toBe(false);

    // 基线已经换成当前值：再改一次，撤回只能退到 reset 时的值。
    typeValue(harness, { name: "王五" });
    act(() => {
      vi.advanceTimersByTime(80);
    });
    act(() => harness.result.current.history.undo());
    expect(harness.result.current.form.getFieldsValue(true)).toMatchObject({ name: "李四" });
  });

  it("resetKey 变化（换记录）时自动清栈", () => {
    const harness = renderHook(
      (props: { recordId: number }) => useHarness({ debounceMs: 50, resetKey: props.recordId }),
      { initialProps: { recordId: 1 } },
    );
    act(() => {
      harness.result.current.form.setFieldsValue(BASE);
      harness.result.current.history.reset();
    });
    typeValue(harness, { name: "李四" });
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(harness.result.current.history.canUndo).toBe(true);

    harness.rerender({ recordId: 2 });
    expect(harness.result.current.history.canUndo).toBe(false);
    expect(harness.result.current.history.canRedo).toBe(false);
  });

  it("值没变时不会凭空多出一个历史点", () => {
    const harness = mountHistory();
    act(() => {
      harness.result.current.history.push();
    });
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(harness.result.current.history.canUndo).toBe(false);
  });
});
