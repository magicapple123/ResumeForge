// SPDX-License-Identifier: Apache-2.0
/**
 * 条目「列间距」控件的结构守卫（I-05 / I-07，2026-11-18）。
 *
 * 守三件在 jsdom 里能断言、而 CSS 管不住的事：
 * 1. **标签文案**是「列间距」而不是「列间距（毫米）」——72px 标签列里后者会折成两行，
 *    而单位已经在读数（`{value} mm`）里，属重复信息；
 * 2. **继承态不渲染 ↺**（没有可恢复的东西），有覆盖值时才有，点一下回到继承；
 * 3. 读数与 ↺ **同一个 `.rf-entry-column-gap-row` 父级**——宽档一行、窄档两行的重排
 *    全靠这条网格里的三个格子（`grid-template-areas`），拆到不同父级 CSS 就够不着了。
 *
 * 布局本身（行高、手柄是否被裁、窄档两行）jsdom 不求值，落在 Playwright 实机验收。
 */
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import EntryColumnGapControls from "./EntryColumnGapControls";

function renderGap(overrides: Partial<Parameters<typeof EntryColumnGapControls>[0]> = {}) {
  const onPatch = vi.fn();
  const props = {
    columns: 2,
    gap: null as number | null,
    columnGaps: null as number[] | null,
    fontPx: 16,
    contentPx: 600,
    justify: "start" as const,
    showCustom: false,
    inheritable: true,
    disabled: false,
    onPatch,
    ...overrides,
  };
  const utils = render(<EntryColumnGapControls {...props} />);
  return { onPatch, ...utils };
}

describe("EntryColumnGapControls · 标签与恢复继承（I-05 / I-07）", () => {
  it("标签是「列间距」，不带毫米单位（单位由读数负责）", () => {
    renderGap();
    expect(screen.getByText(t("structure.layout.gap"))).toBeInTheDocument();
    expect(screen.queryByText(t("structure.layout.gapMm"))).toBeNull();
  });

  it("继承态：只显示「继承」，不渲染 ↺", () => {
    renderGap({ gap: null });
    expect(screen.getByText(t("structure.layout.inherit"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("structure.layout.restore.gap") })).toBeNull();
  });

  it("有覆盖值时出现 ↺，读数与它同属 `.rf-entry-column-gap-row`", () => {
    const { container } = renderGap({ gap: 0.5 });
    const reset = screen.getByRole("button", { name: t("structure.layout.restore.gap") });
    const value = container.querySelector(".rf-entry-column-gap-value");
    if (!value) throw new Error("missing gap value");
    expect(value.closest(".rf-entry-column-gap-row")).toBe(
      reset.closest(".rf-entry-column-gap-row"),
    );
    // 读数从「继承」换成带单位的具体值。
    expect(value.textContent).toContain("mm");
  });

  it("点 ↺ 写回 `{ gap: null }`（清除覆盖、回到继承）", () => {
    const { onPatch } = renderGap({ gap: 0.5 });
    fireEvent.click(screen.getByRole("button", { name: t("structure.layout.restore.gap") }));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ gap: null });
  });

  it("不可继承（inheritable=false）时即使有值也不渲染 ↺", () => {
    renderGap({ gap: 0.5, inheritable: false });
    expect(screen.queryByRole("button", { name: t("structure.layout.restore.gap") })).toBeNull();
  });
});

/**
 * WF-15：拖动提交频率。
 *
 * 每次 `onPatch` 都会提交**一整份文档**（入历史栈 + 触发重排），所以"拖一次提交一次"
 * 是硬要求；拖满全程几十次提交正是卡顿与"撤销一次只退一格"的来源。
 * rc-slider 的键盘方向键与拖拽走同一条 `onChange`，`keyUp` 对应 `onChangeComplete`。
 */
describe("EntryColumnGapControls · 拖动提交频率（WF-15）", () => {
  const pressArrow = (target: Element, direction: "ArrowLeft" | "ArrowRight") => {
    const keyCode = direction === "ArrowRight" ? 39 : 37;
    fireEvent.keyDown(target, { key: direction, keyCode, which: keyCode });
  };

  /** 松手：rc-slider 在 keyUp 上触发 `onChangeComplete`。 */
  const release = (target: Element) => {
    fireEvent.keyUp(target, { key: "ArrowRight", keyCode: 39, which: 39 });
  };

  it("连续 40 步拖动，拖动中 0 次提交，松手只提交 1 次", () => {
    const { onPatch } = renderGap({ gap: null });
    const slider = screen.getByRole("slider", { name: t("structure.layout.gapMmAria") });

    for (let step = 0; step < 40; step += 1) pressArrow(slider, "ArrowRight");
    expect(onPatch).not.toHaveBeenCalled();

    release(slider);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch.mock.calls[0][0]).toMatchObject({ gap: expect.any(Number) });
  });

  it("拖动中读数立刻跟手（本地草稿，不等提交）", () => {
    const { container, onPatch } = renderGap({ gap: null });
    const slider = screen.getByRole("slider", { name: t("structure.layout.gapMmAria") });
    expect(container.querySelector(".rf-entry-column-gap-value")?.textContent).toBe(
      t("structure.layout.inherit"),
    );

    pressArrow(slider, "ArrowRight");
    // 提交还没发生，但读数已经是拖动后的值。
    expect(onPatch).not.toHaveBeenCalled();
    expect(container.querySelector(".rf-entry-column-gap-value")?.textContent).toBe(
      t("structure.layout.gapMillimeters", { value: "0.10" }),
    );
  });

  it("不松手时由 120ms 防抖兜底：一串连续改动仍只提交一次", async () => {
    const { onPatch } = renderGap({ gap: null });
    const slider = screen.getByRole("slider", { name: t("structure.layout.gapMmAria") });

    for (let step = 0; step < 12; step += 1) pressArrow(slider, "ArrowRight");
    expect(onPatch).not.toHaveBeenCalled();

    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(onPatch).toHaveBeenCalledTimes(1);
  });
});
