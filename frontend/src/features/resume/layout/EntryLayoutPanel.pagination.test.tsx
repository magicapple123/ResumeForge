// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」的条目级断页（`entryLayout/EntryLayoutPagination`，Q08/Q09）与
 * 行内/单段板块隐藏（Q07）。轻提示的"只提示一次"按会话记在 sessionStorage，用例间清空。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { latest, makeDocument, makeInlineDocument } from "../../../test/entryLayoutPanelFixtures";
import { Harness } from "../../../test/entryLayoutPanelHarness";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("EntryLayoutPanel · 行内/单段板块（Q07）", () => {
  it("行内板块不渲染条目级排版/分页控件，给一句原因说明", () => {
    const { container } = render(<Harness initial={makeInlineDocument()} />);
    expect(screen.getByText(t("structure.layout.notEntries"))).toBeInTheDocument();
    expect(screen.getByText(t("structure.layout.notEntriesHint"))).toBeInTheDocument();
    // 板块选择器仍在（用户要能从这里切回有条目级排版的板块）。
    expect(
      screen.getByRole("combobox", { name: t("structure.layout.section") }),
    ).toBeInTheDocument();
    // 条目级控件全部退场：应用范围、条目头布局、条目分页、灰字段顺序。
    expect(screen.queryByText(t("structure.layout.scope.entry"))).toBeNull();
    expect(screen.queryByText(t("structure.layout.head"))).toBeNull();
    expect(screen.queryByText(t("pagination.entry.title"))).toBeNull();
    expect(container.querySelector("[data-entry-layout-pagination]")).toBeNull();
    expect(container.querySelector("[data-entry-layout-not-entries]")).not.toBeNull();
  });
});

describe("EntryLayoutPanel · 条目级断页（Q08）", () => {
  it("条目级「分页」小分组在条目范围下渲染，两个开关写 entry.layout", () => {
    const calls: unknown[][] = [];
    const { container } = render(
      <Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />,
    );
    const group = container.querySelector<HTMLElement>("[data-entry-layout-pagination]");
    if (!group) throw new Error("missing entry pagination group");
    expect(group.textContent).toContain(t("pagination.entry.title"));
    const switches = group.querySelectorAll('button[role="switch"]');
    expect(switches).toHaveLength(2);
    fireEvent.click(switches[0]);
    expect(latest(calls).sections[0].entries[0].layout.start_on_new_page).toBe(true);
    fireEvent.click(switches[1]);
    expect(latest(calls).sections[0].entries[0].layout.keep_together).toBe(true);
  });

  it("切到「整个板块」后条目级断页保留但禁用（R-11：切范围总高不变）", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    const group = container.querySelector<HTMLElement>("[data-entry-layout-pagination]");
    if (!group) throw new Error("missing entry pagination group");
    // 组还在（高度不跳），但两个开关禁用：板块级开关在分页面板里。
    const switches = group.querySelectorAll('button[role="switch"]');
    expect(switches).toHaveLength(2);
    switches.forEach((node) => expect(node).toBeDisabled());
  });

  it("第一次拨动条目断页开关给一次轻提示", () => {
    const onNotice = vi.fn();
    const { container } = render(<Harness initial={makeDocument()} onNotice={onNotice} />);
    const group = container.querySelector<HTMLElement>("[data-entry-layout-pagination]");
    if (!group) throw new Error("missing entry pagination group");
    fireEvent.click(group.querySelectorAll('button[role="switch"]')[0]);
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith(t("toast.pageBreakApplied"));
    fireEvent.click(group.querySelectorAll('button[role="switch"]')[1]);
    expect(onNotice).toHaveBeenCalledTimes(1);
  });
});

describe("EntryLayoutPanel · 断页开关整行可点（I-08）", () => {
  it("两行都是 `<label for>`，指向行内那颗真开关（不额外加 tab 停点）", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    const group = container.querySelector<HTMLElement>("[data-entry-layout-pagination]");
    if (!group) throw new Error("missing entry pagination group");
    const rows = [...group.querySelectorAll<HTMLLabelElement>(".rf-entry-layout-row.is-switch")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // 行本身就是 label：整行命中区域，但无障碍入口仍是那颗开关。
      expect(row.tagName).toBe("LABEL");
      expect(row.hasAttribute("tabindex")).toBe(false);
      expect(row.getAttribute("role")).toBeNull();
      const switchNode = row.querySelector<HTMLButtonElement>('button[role="switch"]');
      if (!switchNode) throw new Error("missing switch inside switch row");
      expect(switchNode.id).toBeTruthy();
      // `htmlFor` 必须与开关 id 一致，否则点标签不会转发。
      expect(row.getAttribute("for")).toBe(switchNode.id);
    }
  });

  it("点标签文字只切换一次（原生 label 转发，没有手写 onClick）", () => {
    const calls: unknown[][] = [];
    const { container } = render(
      <Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />,
    );
    const group = container.querySelector<HTMLElement>("[data-entry-layout-pagination]");
    if (!group) throw new Error("missing entry pagination group");
    const label = group.querySelector<HTMLElement>(
      ".rf-entry-layout-row.is-switch .rf-entry-layout-label",
    );
    if (!label) throw new Error("missing switch label text");
    fireEvent.click(label);
    const layout = latest(calls).sections[0].entries[0].layout;
    // 一次点击 → 一次写回（若整行 onClick 与开关 onChange 同时生效，会切两次回到 false）。
    expect(calls).toHaveLength(1);
    expect(layout.start_on_new_page).toBe(true);
  });
});
