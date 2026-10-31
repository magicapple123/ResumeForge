// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」的灰色短字段区块（`entryLayout/EntryLayoutShortFields`）：
 * lead/trail 排序与去向、隐藏/恢复、锁排版只读，以及 Q20「用字段目录标签而不是 key」。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import {
  fieldCatalogFixture,
  latest,
  makeDocument,
  makeField,
} from "../../test/entryLayoutPanelFixtures";
import { Harness } from "../../test/entryLayoutPanelHarness";

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

  it("隐藏短字段 → placement=hidden；再点显示回 trail", () => {
    const calls: unknown[][] = [];
    const { container, rerender } = render(
      <Harness initial={makeDocument()} onChange={(next) => calls.push([next])} />,
    );
    const row = container.querySelector<HTMLElement>(
      '[data-field-path="education.entry_edu_01.gpa_001"]',
    );
    if (!row) throw new Error("missing row");
    fireEvent.click(within(row).getByRole("button", { name: t("structure.action.hide") }));
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

  it("锁排版时布局控件禁用并说明原因", () => {
    const doc = makeDocument();
    doc.sections[0].entries[0].lock_layout = true;
    render(<Harness initial={doc} />);
    expect(screen.getByText(t("structure.layout.locked"))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2" })).toBeDisabled();
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
