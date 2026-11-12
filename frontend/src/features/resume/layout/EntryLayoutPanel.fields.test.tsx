// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」的灰色短字段区块（`entryLayout/EntryLayoutShortFields`）：
 * 去向（前/后）、顺序（↑↓）、「⋯」菜单里的独占一行/显示字段名/隐藏，锁排版只读，
 * 以及 Q20「用字段目录标签而不是 key」。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import type { ResumeDocument } from "../../../types/resumeDocument";
import {
  fieldCatalogFixture,
  latest,
  makeDocument,
  makeField,
} from "../../../test/entryLayoutPanelFixtures";
import { Harness } from "../../../test/entryLayoutPanelHarness";

describe("EntryLayoutPanel · 灰色短字段", () => {
  it("列出 lead/trail 字段（隐藏字段单独列），不上正文块", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    expect(
      container.querySelector('[data-field-path="education.entry_edu_01.gpa_001"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-field-path="education.entry_edu_01.study_01"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-field-path="education.entry_edu_01.school_01"]'),
    ).toBeNull();
    // 隐藏字段出现在"字段显示"区
    expect(
      container.querySelector('[data-field-path="education.entry_edu_01.rank_001"]'),
    ).not.toBeNull();
  });

  it("上移按钮调换同组内顺序", () => {
    const calls: unknown[][] = [];
    const doc = makeDocument();
    doc.sections[0].entries[0].items = [
      makeField("degree_01", "degree", "本科", "meta"),
      makeField("gpa_001", "gpa", "3.8", "lead"),
      makeField("study_01", "study_form", "全日制", "lead"),
    ];
    const { container } = render(<Harness initial={doc} onChange={(next) => calls.push([next])} />);
    const row = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.study_01"]',
    );
    if (!row) throw new Error("missing row");
    const up = within(row).getByRole("button", { name: t("structure.action.moveUp") });
    fireEvent.click(up);
    const next = latest(calls);
    const values = next.sections[0].entries[0].items.map((item) =>
      item.kind === "field" ? item.value : "",
    );
    expect(values).toEqual(["本科", "全日制", "3.8"]);
  });

  it("「⋯」菜单里的隐藏 → placement=hidden；再点显示回 trail（R-10）", () => {
    const calls: unknown[][] = [];
    const { container, rerender } = render(
      <Harness initial={makeDocument()} onChange={(next) => calls.push([next])} />,
    );
    const row = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.gpa_001"]',
    );
    if (!row) throw new Error("missing row");
    // R-10：隐藏从行内 `×` 收进「⋯」菜单（并标 danger），先开菜单再点菜单项。
    fireEvent.click(
      within(row).getByRole("button", {
        name: t("structure.layout.fieldActionsAria", { name: "gpa" }),
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: t("structure.layout.itemHidden") }));
    const hiddenDoc = latest(calls);
    const hiddenItem = hiddenDoc.sections[0].entries[0].items.find(
      (item) => item.id === "gpa_001",
    ) as {
      placement: string;
    };
    expect(hiddenItem.placement).toBe("hidden");
    // 显示按钮：在隐藏区找到该字段并恢复
    rerender(<Harness initial={hiddenDoc} onChange={(next) => calls.push([next])} />);
    const hiddenRow = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.gpa_001"]',
    );
    if (!hiddenRow) throw new Error("missing hidden row");
    fireEvent.click(
      within(hiddenRow).getByRole("button", { name: t("structure.layout.itemShown") }),
    );
    const shown = latest(calls).sections[0].entries[0].items.find(
      (item) => item.id === "gpa_001",
    ) as {
      placement: string;
    };
    expect(shown.placement).toBe("trail");
  });

  it("每行 3 组控件：[前|后] Segmented + ↑↓ + ⋯（R-10）", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    const row = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.study_01"]',
    );
    if (!row) throw new Error("missing row");
    expect(row.querySelector(".rf-entry-layout-field-placement")).not.toBeNull();
    expect(row.querySelectorAll(".rf-entry-layout-field-move .ant-btn")).toHaveLength(2);
    expect(row.querySelector(".rf-entry-layout-field-more")).not.toBeNull();
    // 常显的两个 Switch 已经收进菜单：行内不再有 switch。
    expect(row.querySelectorAll('[role="switch"]')).toHaveLength(0);
  });

  it("切「前/后」不改 items 顺序（行不跳位，R-10）", () => {
    const calls: unknown[][] = [];
    const doc = makeDocument();
    doc.sections[0].entries[0].items = [
      makeField("degree_01", "degree", "本科", "meta"),
      makeField("gpa_001", "gpa", "3.8", "lead"),
      makeField("study_01", "study_form", "全日制", "trail"),
    ];
    const { container } = render(<Harness initial={doc} onChange={(next) => calls.push([next])} />);
    const row = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.study_01"]',
    );
    if (!row) throw new Error("missing row");
    fireEvent.click(
      within(row).getByRole("radio", { name: t("structure.layout.placementShort.lead") }),
    );
    const next = latest(calls);
    const ids = next.sections[0].entries[0].items.map((item) => item.id);
    // 只改去向，不重排：study_01 仍在原位（旧实现会把它排到 lead 组末尾）。
    expect(ids).toEqual(["degree_01", "gpa_001", "study_01"]);
    const moved = next.sections[0].entries[0].items.find((item) => item.id === "study_01");
    expect(moved && "placement" in moved ? moved.placement : null).toBe("lead");
  });

  /** 打开某行的「⋯」菜单并点其中一项；返回最近一次写回的文档。 */
  function clickFieldMenu(
    container: HTMLElement,
    path: string,
    label: string,
    calls: unknown[][],
  ): ResumeDocument {
    const row = container.querySelector<HTMLElement>(`[data-field-path="${path}"]`);
    if (!row) throw new Error("missing row");
    fireEvent.click(
      within(row).getByRole("button", {
        name: t("structure.layout.fieldActionsAria", { name: "gpa" }),
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    return latest(calls);
  }

  it("「⋯」→ 独占一行：solo 置 true（R-10）", () => {
    const calls: unknown[][] = [];
    const { container } = render(
      <Harness initial={makeDocument()} onChange={(next) => calls.push([next])} />,
    );
    const doc = clickFieldMenu(
      container,
      "education.entry_edu_01.gpa_001",
      t("structure.layout.solo"),
      calls,
    );
    const item = doc.sections[0].entries[0].items.find((candidate) => candidate.id === "gpa_001");
    expect(item && "solo" in item ? item.solo : null).toBe(true);
  });

  it("「⋯」→ 显示字段名：show_label 置 false（R-10）", () => {
    const calls: unknown[][] = [];
    const { container } = render(
      <Harness initial={makeDocument()} onChange={(next) => calls.push([next])} />,
    );
    const doc = clickFieldMenu(
      container,
      "education.entry_edu_01.gpa_001",
      t("structure.layout.showLabel"),
      calls,
    );
    const item = doc.sections[0].entries[0].items.find((candidate) => candidate.id === "gpa_001");
    // 夹具把 lead 字段的 show_label 设为 true，点一次变 false。
    expect(item && "show_label" in item ? item.show_label : null).toBe(false);
  });

  it("锁排版时布局控件禁用并说明原因", () => {
    const doc = makeDocument();
    doc.sections[0].entries[0].lock_layout = true;
    render(<Harness initial={doc} />);
    expect(screen.getByText(t("structure.layout.locked"))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2" })).toBeDisabled();
  });

  it("↑↓ 只在组内移动：组首/组尾按钮禁用（#16）", () => {
    const doc = makeDocument();
    doc.sections[0].entries[0].items = [
      makeField("degree_01", "degree", "本科", "meta"),
      makeField("gpa_001", "gpa", "3.8", "lead"),
      makeField("study_01", "study_form", "全日制", "lead"),
      makeField("rank_001", "rank", "前 10%", "trail"),
    ];
    const { container } = render(<Harness initial={doc} />);
    const rowOf = (id: string) => {
      const row = container.querySelector<HTMLElement>(
        `[data-field-path="education.entry_edu_01.${id}"]`,
      );
      if (!row) throw new Error(`missing ${id}`);
      return row;
    };
    const up = (id: string) =>
      within(rowOf(id)).getByRole("button", { name: t("structure.action.moveUp") });
    const down = (id: string) =>
      within(rowOf(id)).getByRole("button", { name: t("structure.action.moveDown") });
    expect(up("gpa_001")).toBeDisabled();
    expect(down("gpa_001")).toBeEnabled();
    expect(down("study_01")).toBeDisabled();
    expect(up("rank_001")).toBeDisabled();
    expect(down("rank_001")).toBeDisabled();
  });
});

describe("EntryLayoutPanel · 字段目录标签（Q20）", () => {
  it("灰色短字段与隐藏字段用目录标签，不再显示英文 key", () => {
    const { container } = render(
      <Harness initial={makeDocument()} fieldCatalog={fieldCatalogFixture()} />,
    );
    const studyRow = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.study_01"]',
    );
    const gpaRow = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.gpa_001"]',
    );
    const rankRow = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.rank_001"]',
    );
    if (!studyRow || !gpaRow || !rankRow) throw new Error("missing rows");
    expect(within(studyRow).getByText("Study form")).toBeInTheDocument();
    expect(within(gpaRow).getByText("GPA / rank")).toBeInTheDocument();
    expect(within(rankRow).getByText("Class rank")).toBeInTheDocument();
    expect(screen.queryByText("study_form")).toBeNull();
  });

  it("没有目录时仍退回原始 key（兜底不丢字段）", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    const studyRow = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.study_01"]',
    );
    if (!studyRow) throw new Error("missing row");
    expect(within(studyRow).getByText("study_form")).toBeInTheDocument();
  });
});
