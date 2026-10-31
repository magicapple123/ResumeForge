// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」的条目级断页（`entryLayout/EntryLayoutPagination`，Q08/Q09）与
 * 行内/单段板块隐藏（Q07）。轻提示的"只提示一次"按会话记在 sessionStorage，用例间清空。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { latest, makeDocument, makeInlineDocument } from "../../test/entryLayoutPanelFixtures";
import { Harness } from "../../test/entryLayoutPanelHarness";

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

  it("切到「整个板块」后不显示条目级分页（板块级开关在分页面板里）", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    expect(container.querySelector("[data-entry-layout-pagination]")).toBeNull();
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
