// SPDX-License-Identifier: Apache-2.0
/**
 * 左栏页签条（2026-10-25 从 antd Segmented 换成可换行 chip 页签）。
 *
 * 为什么它需要单独用例：窄栏下 6 个页签放不进一行（Segmented 会把四字标签截成
 * 「排版...」），所以这里钉三件事——`role=tablist/tab` 的语义、键盘 ←/→/Home/End 的
 * 循环、以及"两个汉字的页签不会被 antd Button 自动插空格"（否则「历史」会渲染成
 * 「历 史」，按文案定位的既有用例全碎）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkbenchLeftTabs, { type WorkbenchLeftTabItem } from "./WorkbenchLeftTabs";

afterEach(cleanup);

const ITEMS: readonly WorkbenchLeftTabItem<"params" | "outline" | "history">[] = [
  { value: "params", label: "Layout params" },
  { value: "outline", label: "Outline" },
  { value: "history", label: "History" },
];

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<"params" | "outline" | "history">("params");
  return (
    <WorkbenchLeftTabs
      ariaLabel="left panels"
      items={ITEMS}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

describe("WorkbenchLeftTabs", () => {
  it("渲染 tablist / tab 语义，只有选中项进 Tab 序列", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "left panels" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(ITEMS.length);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
  });

  it("点击页签把目标值交给宿主", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Outline" }));
    expect(onChange).toHaveBeenCalledWith("outline");
    expect(screen.getByRole("tab", { name: "Outline" })).toHaveAttribute("aria-selected", "true");
  });

  it("键盘 ←/→ 循环、Home/End 跳首尾，并把焦点交给新选中的页签", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const first = screen.getByRole("tab", { name: "Layout params" });
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("outline");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Outline" }));

    fireEvent.keyDown(screen.getByRole("tab", { name: "Outline" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("history");

    fireEvent.keyDown(screen.getByRole("tab", { name: "History" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("params");
  });

  it("两个汉字的页签保持原文（不被 antd Button 插空格）", () => {
    const onChange = vi.fn();
    render(
      <WorkbenchLeftTabs
        ariaLabel="short tabs"
        items={
          [
            { value: "a", label: "History" },
            { value: "b", label: "双语" },
          ] as WorkbenchLeftTabItem<"a" | "b">[]
        }
        value="a"
        onChange={onChange}
      />,
    );
    // 若被插空格，这里拿到的可访问名会是「双 语」。
    expect(screen.getByRole("tab", { name: "双语" })).toBeInTheDocument();
  });
});
