// SPDX-License-Identifier: Apache-2.0
/**
 * Coverage notes block: collapsed by default (issue 1), one row per item (5-A), the reason
 * display (5-A), and the aggregation that drives the header count.
 *
 * 2026-11 行数预算拆分批：本文件原为 `ResumeCoverageNotes.test.tsx`（prettier 重排后 527 行，
 * 越过测试文件 500 行预算）。三分支按钮与「补进简历」请求体的用例搬到同目录的
 * `CoverageActions.test.tsx`，夹具搬到 `coverageTestFixtures.ts`——**纯搬迁**，用例数量、
 * 用例标题与每条断言均逐字不变。
 *
 * 这里守的是"这块提示长什么样"：默认收起、一条一行、原因汇总与旧记录回退、分组顺序。
 * 动作分支（能不能点、点了发什么请求）属于 `CoverageActions.test.tsx`。
 *
 * This file deliberately contains no CJK literals (the i18n ratchet forbids new ones):
 * expected copy is resolved through the same `t()` the component uses.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import {
  TITLE,
  expandBlock,
  groupHeader,
  itemText,
  note,
  reasonCount,
  renderNotes,
  resetCoverageTestEnv,
  rows,
} from "./coverageTestFixtures";

afterEach(resetCoverageTestEnv);

describe("ResumeCoverageNotes collapsed by default (issue 1)", () => {
  it("starts collapsed: aria-expanded=false and no rows", () => {
    renderNotes([note({ names: ["Amazon ESG"], total: 1 })]);

    const header = screen.getByRole("button", { name: new RegExp(TITLE) });
    expect(header).toHaveAttribute("aria-expanded", "false");
    // The title survives (the hint is still there); only the detail list is hidden.
    expect(screen.queryByText(itemText("Amazon ESG"))).toBeNull();
  });

  it("expands on click and collapses again", () => {
    const { container } = renderNotes([note({ names: ["Amazon ESG"], total: 1 })]);

    const header = screen.getByRole("button", { name: new RegExp(TITLE) });
    fireEvent.click(header);
    expect(screen.getByText(itemText("Amazon ESG"))).toBeInTheDocument();
    expect(rows(container)).toHaveLength(1);
    expect(screen.getByText(t("resume.coverage.openEditor"))).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(header);
    // antd keeps the mounted children after collapse (it hides them), so assert the
    // expanded state instead of DOM disappearance.
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("badge sums total (not names length) and counts legacy plain-text warnings", () => {
    renderNotes(
      [
        note({ names: ["Amazon ESG"], total: 6 }),
        note({ section: "skills", names: ["Excel"], total: 2 }),
      ],
      {
        legacyWarnings: ["legacy warning about one omitted item"],
      },
    );

    expect(screen.getByText(t("resume.coverage.summary", { count: 9 }))).toBeInTheDocument();
  });

  it("renders nothing when both notes and legacyWarnings are empty", () => {
    // A wrapper is needed for `App.useApp()`, so the host div is not empty; assert on the
    // block itself: no collapse header and no group rows.
    const { container } = renderNotes([]);
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(container.querySelectorAll(".resume-coverage-group")).toHaveLength(0);
  });
});

describe("one row per item (5-A layout)", () => {
  it("renders every name in its own list item instead of one joined paragraph", () => {
    const { container } = renderNotes([note({ names: ["Alpha", "Beta", "Gamma"], total: 3 })]);
    expandBlock();

    const listRows = rows(container);
    expect(listRows.map((row) => row.textContent)).toEqual([
      itemText("Alpha"),
      itemText("Beta"),
      itemText("Gamma"),
    ]);
    // The old implementation joined everything with the separator into ONE text node.
    const joined = ["Alpha", "Beta", "Gamma"]
      .map(itemText)
      .join(t("resume.coverage.itemSeparator"));
    expect(screen.queryByText(joined)).toBeNull();
  });

  it("ellipsises long items and shows the full text in a tooltip", async () => {
    const long = "A".repeat(60);
    const { container } = renderNotes([note({ names: [long], total: 1 })]);
    expandBlock();

    const cell = within(rows(container)[0]).getByText(itemText(long));
    // The ellipsis itself is CSS (`text-overflow`); pin the class that carries it.
    expect(cell).toHaveClass("resume-coverage-item");

    fireEvent.mouseEnter(cell);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(long);
  });

  it("does not attach a tooltip to short items", () => {
    const { container } = renderNotes([note({ names: ["Amazon ESG"], total: 1 })]);
    expandBlock();

    fireEvent.mouseEnter(within(rows(container)[0]).getByText(itemText("Amazon ESG")));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the first 5 rows and expands/collapses the rest", () => {
    const { container } = renderNotes([
      note({ names: ["A", "B", "C", "D", "E", "F", "G"], total: 7 }),
    ]);
    expandBlock();

    expect(rows(container)).toHaveLength(5);
    fireEvent.click(
      screen.getByRole("button", { name: t("resume.coverage.expandAll", { count: 7 }) }),
    );
    expect(rows(container)).toHaveLength(7);

    fireEvent.click(screen.getByRole("button", { name: t("resume.coverage.collapse") }));
    expect(rows(container)).toHaveLength(5);
  });

  it("has no expand button when the group fits in 5 rows", () => {
    renderNotes([note({ names: ["A", "B"], total: 2 })]);
    expandBlock();

    expect(
      screen.queryByRole("button", { name: t("resume.coverage.expandAll", { count: 2 }) }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: t("resume.coverage.collapse") })).toBeNull();
  });

  it("renders notes of one section but different section_label as separate groups", () => {
    const { container } = renderNotes([
      note({ names: ["Alpha"], total: 1 }),
      note({ names: ["Alpha highlight one"], section_label: "PROJECT-ALPHA", total: 2 }),
    ]);
    expandBlock();

    // Before 5-A these two merged into a single "projects (3)" group.
    expect(screen.getAllByText(groupHeader("projects", 1))).toHaveLength(1);
    expect(screen.getAllByText(groupHeader("projects", 2, "PROJECT-ALPHA"))).toHaveLength(1);
    expect(container.querySelectorAll(".resume-coverage-group")).toHaveLength(2);
  });
});

describe("reason display (5-A)", () => {
  it("summarises the reasons in the group head", () => {
    renderNotes([
      note({
        section: "skills",
        names: ["A", "B", "C"],
        total: 3,
        reasons: { A: "filtered", B: "capacity", C: "model" },
      }),
    ]);
    expandBlock();

    const summary = [
      reasonCount("filtered", 1),
      reasonCount("capacity", 1),
      reasonCount("model", 1),
    ].join(t("resume.coverage.reasonSeparator"));
    expect(screen.getByText(summary)).toBeInTheDocument();
  });

  it("badges every row only when the group mixes reasons", () => {
    const { container, unmount } = renderNotes([
      note({ names: ["A", "B"], total: 2, reasons: { A: "filtered", B: "capacity" } }),
    ]);
    expandBlock();

    const mixedRows = rows(container);
    expect(
      within(mixedRows[0]).getByText(t("resume.coverage.reason.filtered")),
    ).toBeInTheDocument();
    expect(
      within(mixedRows[1]).getByText(t("resume.coverage.reason.capacity")),
    ).toBeInTheDocument();
    unmount();

    // A group with a single reason keeps the reason in the head only: 9 rows with 9 labels
    // would be pure noise.
    const single = renderNotes([
      note({ names: ["A", "B"], total: 2, reasons: { A: "filtered", B: "filtered" } }),
    ]);
    expandBlock();
    expect(single.container.querySelectorAll(".resume-coverage-item-reason")).toHaveLength(0);
    expect(screen.getByText(reasonCount("filtered", 2))).toBeInTheDocument();
  });

  it("derives reasons for legacy records with capacity > filtered > model priority", () => {
    const { container } = renderNotes([
      note({
        section: "skills",
        names: ["A", "B"],
        total: 2,
        // A is in all three buckets, B in two of them: the harder constraint wins.
        capacity_omitted: ["A"],
        filtered: ["A", "B"],
        model_omitted: ["A", "B"],
      }),
    ]);
    expandBlock();

    // Legacy record without `reasons` -> two different reasons -> per-row badges appear.
    const legacyRows = rows(container);
    expect(
      within(legacyRows[0]).getByText(t("resume.coverage.reason.capacity")),
    ).toBeInTheDocument();
    expect(
      within(legacyRows[1]).getByText(t("resume.coverage.reason.filtered")),
    ).toBeInTheDocument();
  });

  it("says 'not stated' when no reason axis matches, instead of guessing", () => {
    renderNotes([note({ names: ["Mystery"], total: 1, filtered: [], model_omitted: [] })]);
    expandBlock();

    expect(screen.getByText(reasonCount("unknown", 1))).toBeInTheDocument();
  });
});

describe("aggregation still drives the header count", () => {
  it("keeps group order at the first appearance in the backend array", () => {
    renderNotes([
      note({ section: "skills", names: ["Excel"], total: 1 }),
      note({ names: ["Amazon ESG"], total: 1 }),
      note({ section: "skills", names: ["SQL"], total: 1 }),
    ]);
    expandBlock();

    const body = document.body.textContent ?? "";
    const skillsAt = body.indexOf(groupHeader("skills", 2));
    const projectsAt = body.indexOf(groupHeader("projects", 1));
    expect(skillsAt).toBeGreaterThanOrEqual(0);
    expect(projectsAt).toBeGreaterThanOrEqual(0);
    expect(skillsAt).toBeLessThan(projectsAt);
  });

  it("folds profile-side plural section keys into one group", () => {
    const { container } = renderNotes([
      note({ section: "experiences", section_label: "EXP", names: ["Alpha"], total: 1 }),
      note({ section: "experience", section_label: "EXP", names: ["Beta"], total: 1 }),
    ]);
    expandBlock();

    expect(container.querySelectorAll(".resume-coverage-group")).toHaveLength(1);
    expect(screen.getAllByText(groupHeader("experience", 2, "EXP"))).toHaveLength(1);
    expect(rows(container).map((row) => row.textContent)).toEqual([
      itemText("Alpha"),
      itemText("Beta"),
    ]);
  });

  it("renders legacy plain-text warnings below the groups", () => {
    renderNotes([note({ names: ["Alpha"], total: 1 })], {
      legacyWarnings: ["legacy warning about one omitted item"],
    });
    expandBlock();

    expect(screen.getByText("legacy warning about one omitted item")).toBeInTheDocument();
  });

  it("keeps the aggregate 'open manual edit' entry", () => {
    const { onOpenEditor } = renderNotes([note({ names: ["Alpha"], total: 1 })]);
    expandBlock();

    fireEvent.click(screen.getByRole("button", { name: t("resume.coverage.openEditor") }));
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });
});
