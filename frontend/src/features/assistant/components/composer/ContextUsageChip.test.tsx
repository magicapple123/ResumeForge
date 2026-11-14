// SPDX-License-Identifier: Apache-2.0
/**
 * R-25：上下文 chip 改成「环形进度 + 百分比」。
 *
 * 只断言**可计算的形状**（弧长、分档类名、无分母时不画弧），不测像素直径与颜色值——
 * 直径在真机浏览器里量，颜色走 CSS 变量（深浅主题各一套），在 jsdom 里断言色值
 * 只会把测试绑死在某个主题上。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { t } from "../../../../i18n";
import {
  CONTEXT_DANGER_PERCENT,
  CONTEXT_WARN_PERCENT,
  contextArcPercent,
  contextUsageLevel,
} from "../../contextUsageFormat";
import type { ContextUsage } from "../../../../types";
import ContextUsageChip from "./ContextUsageChip";

function usage(percent: number | null, window = 100_000): ContextUsage {
  return {
    buckets: [{ key: "system", tokens: 1_000, percent }],
    total: 1_000,
    window,
    percent,
    partial: false,
    usage_actual: null,
  };
}

function arc(container: HTMLElement): SVGCircleElement | null {
  return container.querySelector(".assistant-context-usage-ring-arc");
}

describe("上下文用量 chip（R-25）", () => {
  it("48% 画出 48/100 的弧，右侧只显示百分比、不再有文字标签", () => {
    const { container } = render(<ContextUsageChip usage={usage(48)} />);
    expect(arc(container)?.getAttribute("stroke-dasharray")).toBe("48 100");
    const chip = screen.getByRole("button", { name: t("contextUsage.aria.chip") });
    expect(chip.textContent).toBe("48%");
    expect(chip.textContent).not.toContain(t("contextUsage.chip"));
    // 弧与数字同一档：常态用灰（类名不带 is-warn / is-danger）。
    expect(container.querySelector(".assistant-context-usage-chip-inner")?.className).toContain(
      "is-normal",
    );
  });

  it("85% 与 95% 分别落到琥珀与危险档", () => {
    expect(contextUsageLevel(CONTEXT_WARN_PERCENT)).toBe("warn");
    expect(contextUsageLevel(CONTEXT_DANGER_PERCENT)).toBe("danger");
    expect(contextUsageLevel(CONTEXT_WARN_PERCENT - 0.1)).toBe("normal");

    const warn = render(<ContextUsageChip usage={usage(85)} />);
    expect(warn.container.querySelector(".is-warn")).not.toBeNull();
    warn.unmount();

    const danger = render(<ContextUsageChip usage={usage(95)} />);
    expect(danger.container.querySelector(".is-danger")).not.toBeNull();
    expect(arc(danger.container)?.getAttribute("stroke-dasharray")).toBe("95 100");
  });

  it("没有分母时只有轨道 + 「—」，不画弧（避免圆头留一个点）", () => {
    const { container } = render(<ContextUsageChip usage={null} />);
    expect(arc(container)).toBeNull();
    expect(container.querySelector(".assistant-context-usage-ring-track")).not.toBeNull();
    expect(screen.getByRole("button", { name: t("contextUsage.aria.chip") }).textContent).toBe("—");
  });

  it("超过 100% 时数字保留真实值，只把弧夹到整圈", () => {
    expect(contextArcPercent(120)).toBe(100);
    expect(contextArcPercent(48)).toBe(48);
    expect(contextArcPercent(null)).toBe(0);

    const { container } = render(<ContextUsageChip usage={usage(120)} />);
    expect(arc(container)?.getAttribute("stroke-dasharray")).toBe("100 100");
    expect(screen.getByRole("button", { name: t("contextUsage.aria.chip") }).textContent).toBe(
      "120%",
    );
  });
});
