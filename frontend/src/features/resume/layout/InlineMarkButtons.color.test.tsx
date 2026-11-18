// SPDX-License-Identifier: Apache-2.0
/**
 * I-10：工具条的颜色按钮必须用**自绘调色板**，不能再用 `FontColorsOutlined`。
 *
 * 守两条，都是"看图才发现"的那类退化：
 *
 * 1. 图标不是 antd 的 A+横杠（`.anticon-font-colors`）——那条横杠在没有下划线按钮的工具条里
 *    会被读成下划线；
 * 2. 自绘 SVG 全部走 `currentColor`（深色主题下不能固定成浅色主题的黑），且 `1em` 尺寸
 *    （跟着按钮字号缩放，写死 16px 会在不同 `size` 下错位）。
 *
 * 交互不在这里重复测：`inlineFormatEntry.test.tsx` 已覆盖"点字号/加粗写回受控值"，
 * 颜色走的是同一个 `applyStyle` 路径，行为未改。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import InlineMarkButtons from "./InlineMarkButtons";

afterEach(() => cleanup());

describe("I-10 · color button glyph", () => {
  it("renders the self-drawn palette instead of the antd font-colors icon", () => {
    const { container } = render(
      <AntdApp>
        <InlineMarkButtons onCommit={() => undefined} />
      </AntdApp>,
    );
    const button = screen.getByRole("button", { name: t("typography.inline.color") });
    expect(button.querySelector(".anticon-font-colors")).toBeNull();

    const svg = button.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("1em");
    expect(svg?.getAttribute("height")).toBe("1em");

    // 颜色必须跟随主题：路径与圆点都用 currentColor，不出现写死的黑/白。
    const painted = Array.from(container.querySelectorAll("path, circle"));
    expect(painted.length).toBeGreaterThan(0);
    for (const node of painted) {
      for (const attr of ["stroke", "fill"]) {
        const value = node.getAttribute(attr) ?? "currentColor";
        if (value === "none") continue;
        expect(value).toBe("currentColor");
      }
    }
  });

  it("keeps the accessible name so the button is still reachable", () => {
    render(
      <AntdApp>
        <InlineMarkButtons onCommit={() => undefined} />
      </AntdApp>,
    );
    expect(screen.getByRole("button", { name: t("typography.inline.color") })).toBeInTheDocument();
  });
});
