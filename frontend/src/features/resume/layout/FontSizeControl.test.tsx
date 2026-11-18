// SPDX-License-Identifier: Apache-2.0
/**
 * QW-4：全局字号支持精确输入。
 *
 * 钉住四件事：
 * 1. 数值输入直接提交（0.1px 网格，与滑杆、± 共用同一条提交路径）；
 * 2. 空输入不是 0：提示 + 不写入；
 * 3. 越界 / 非数字：提示 + 不写入（不悄悄夹成边界值）；
 * 4. 恢复继承仍走父组件的 `onReset`（删声明），不是在这里写 1.0。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import FontSizeControl from "./FontSizeControl";

const BOUNDS = { min: 9, max: 24 };

function setup(props: Partial<React.ComponentProps<typeof FontSizeControl>> = {}) {
  const onCommit = vi.fn();
  const onReset = vi.fn();
  render(
    <FontSizeControl
      value={14}
      bounds={BOUNDS}
      signature="standard:1"
      customized={false}
      onCommit={onCommit}
      onReset={onReset}
      {...props}
    />,
  );
  const input = screen.getByRole("spinbutton", {
    name: t("resume.measure.fontSizeInputAria"),
  }) as HTMLInputElement;
  return { onCommit, onReset, input };
}

function typeAndCommit(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
  // 提交走 180ms 防抖（与拖动共用同一条路径）。
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe("FontSizeControl · QW-4 精确输入", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("输入 16.1px 回车 → 提交 16.1（与滑杆同一网格）", () => {
    const { input, onCommit } = setup();
    expect(input.value).toBe("14px");
    typeAndCommit(input, "16.1");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(16.1);
  });

  it("空输入：提示「请输入字号」，不提交、不当成 0", () => {
    const { input, onCommit } = setup();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(t("resume.measure.fontSizeInputEmpty"))).toBeTruthy();
  });

  it("越界值：提示允许范围，不写入、不夹成 24", () => {
    const { input, onCommit } = setup();
    typeAndCommit(input, "99");
    expect(onCommit).not.toHaveBeenCalled();
    expect(
      screen.getByText(t("resume.measure.fontSizeInputInvalid", { min: 9, max: 24 })),
    ).toBeTruthy();
    // 输入框保留用户填的原值，方便改回来（不静默改成边界值）。
    expect(input.value).toBe("99px");
  });

  it("与当前值相同：失焦不产生一次“看起来没变”的提交", () => {
    const { input, onCommit } = setup();
    fireEvent.change(input, { target: { value: "14" } });
    fireEvent.blur(input);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("恢复继承仍交给父组件（删声明），控件自己不写 1.0", () => {
    const restoreReset = vi.fn();
    const { onReset } = setup({
      customized: true,
      restore: { visible: true, onReset: restoreReset },
    });
    // ↺ 的无障碍名带参数名，直接按文案取。
    fireEvent.click(screen.getByRole("button", { name: /恢复到打开时的值/ }));
    expect(restoreReset).toHaveBeenCalledTimes(1);
    // 控件自身的 `onReset` 是"双击标题回默认"，不该被 ↺ 触发。
    expect(onReset).not.toHaveBeenCalled();
  });
});
