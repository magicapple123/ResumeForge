// SPDX-License-Identifier: Apache-2.0
/**
 * 分栏宽度控件：分隔条键盘可达、方向键一次 1%；两栏给等宽与 65:35 两个非对称预设，
 * 三栏只给等宽。
 *
 * 守的是「键盘也能改」：只有鼠标能拖的分隔条，对键盘用户等于不存在。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import EntryColumnSplitControl from "./EntryColumnSplitControl";

describe("EntryColumnSplitControl", () => {
  it("renders keyboard-accessible dividers and moves by one percent", () => {
    const onChange = vi.fn();
    render(<EntryColumnSplitControl widths={[50, 50]} disabled={false} onChange={onChange} />);

    const divider = screen.getByRole("separator", { name: `${t("structure.layout.widths")} 1` });
    expect(divider).toHaveAttribute("aria-valuenow", "50");
    expect(divider).toHaveAttribute("aria-valuemin", "10");
    expect(divider).toHaveAttribute("aria-valuemax", "90");

    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith([51, 49]);
  });

  it("offers equal and asymmetric presets for two columns", () => {
    const onChange = vi.fn();
    render(<EntryColumnSplitControl widths={[50, 50]} disabled={false} onChange={onChange} />);
    fireEvent.click(screen.getByText("65:35"));
    expect(onChange).toHaveBeenCalledWith([65, 35]);
    fireEvent.click(screen.getByText("35:65"));
    expect(onChange).toHaveBeenLastCalledWith([35, 65]);
  });

  it("only offers equal preset for three columns", () => {
    render(<EntryColumnSplitControl widths={[34, 33, 33]} disabled={false} onChange={vi.fn()} />);
    expect(screen.getByText(t("structure.layout.align.equal"))).toBeInTheDocument();
    expect(screen.queryByText("65:35")).toBeNull();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });
});
