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
import { render, screen } from "@testing-library/react";
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
