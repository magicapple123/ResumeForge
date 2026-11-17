// SPDX-License-Identifier: Apache-2.0
/**
 * 双语面板页签（T19）：`role="tablist"` + 下划线形态 + 方向键切换。
 *
 * 形态本身由 `bilingual.css` 守着（`styles/workbench-t19-css.test.ts`）；这里钉语义与键盘：
 * 选项数固定三项、只有选中项进 Tab 序列、←/→ 循环且焦点跟到新选中项。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import BilingualTabs from "./BilingualTabs";
import { bt } from "./i18n";

const ITEMS = [
  { value: "compare", label: bt("bilingual.workspace.tabCompare") },
  { value: "candidates", label: bt("bilingual.workspace.tabCandidates") },
  { value: "glossary", label: bt("bilingual.workspace.tabGlossary") },
] as const;

type TabValue = (typeof ITEMS)[number]["value"];

function Harness() {
  const [value, setValue] = useState<TabValue>("compare");
  return (
    <AntdApp>
      <BilingualTabs
        ariaLabel={bt("bilingual.panel.title")}
        items={ITEMS}
        value={value}
        onChange={setValue}
      />
    </AntdApp>
  );
}

afterEach(cleanup);

describe("BilingualTabs", () => {
  it("渲染 tablist 与三个 tab", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: bt("bilingual.panel.title") });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("只有选中项进 Tab 序列", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("→ 切到下一项，并把焦点交给它", () => {
    render(<Harness />);
    const first = screen.getAllByRole("tab")[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs[1]);
  });

  it("← 从第一项回绕到最后一项（Home / End 也按同一套顺序）", () => {
    render(<Harness />);
    const first = screen.getAllByRole("tab")[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    let tabs = screen.getAllByRole("tab");
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs[2], { key: "Home" });
    tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs[0], { key: "End" });
    tabs = screen.getAllByRole("tab");
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
  });
});
