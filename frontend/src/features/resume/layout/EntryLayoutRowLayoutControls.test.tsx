// SPDX-License-Identifier: Apache-2.0
/**
 * 「对象：共用 / 正文前 / 正文后」+「分布」两个新控件的集成行为（问题 4）。
 *
 * 这一层测的是**接线**而不是纯函数（纯函数在 `features/resume/layout/entryRowLayout.test.ts`）：
 * - 切到某一侧之后，同一组控件显示的是**该侧**的生效值，写回落在 `entry.layout.<side>` /
 *   `section.layout.<side>`，且**不碰共用字段**（这是整套改造的核心承诺）；
 * - 「分布」只在多列等宽时出现；`between` 写到对应的那一层；
 * - 该侧没有灰字段时不出现这一侧的选项（避免"调了没反应"）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import type { ResumeDocument, ResumeItem } from "../../../types/resumeDocument";
import { latest, makeDocument } from "../../../test/entryLayoutPanelFixtures";
import { Harness } from "../../../test/entryLayoutPanelHarness";

const SIDE_LEAD = t("structure.layout.object.lead");
const SIDE_TRAIL = t("structure.layout.object.trail");
const SIDE_SHARED = t("structure.layout.object.shared");
const JUSTIFY_BETWEEN = t("structure.layout.justify.between");

/** 教育经历那一条的 layout（测试关注写回目标层）。 */
function entryLayoutOf(doc: ResumeDocument) {
  return doc.sections[0].entries[0].layout;
}

describe("对象切换（共用 / 正文前 / 正文后）", () => {
  it("条目同时有 lead 与 trail 灰字段时，三个对象都可选", () => {
    render(<Harness initial={makeDocument()} />);
    expect(screen.getByText(SIDE_SHARED)).toBeInTheDocument();
    expect(screen.getByText(SIDE_LEAD)).toBeInTheDocument();
    expect(screen.getByText(SIDE_TRAIL)).toBeInTheDocument();
  });

  it("该侧没有灰字段时不出现这一侧的选项", () => {
    const initial = makeDocument();
    // 把唯一一条 lead 字段挪到 trail：正文前这一侧就没字段了。
    const target = initial.sections[0].entries[0];
    target.items = target.items.map((item) =>
      item.kind !== "text" && item.placement === "lead"
        ? ({ ...item, placement: "trail" } as ResumeItem)
        : item,
    );
    render(<Harness initial={initial} />);
    expect(screen.queryByText(SIDE_LEAD)).toBeNull();
    expect(screen.getByText(SIDE_TRAIL)).toBeInTheDocument();
  });

  it("切到「正文前」改列数 → 写 entry.layout.lead.columns，共用字段不动", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByText(SIDE_LEAD));
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    const layout = entryLayoutOf(latest(calls));
    expect(layout.lead).toEqual({ columns: 2 });
    expect(layout.columns ?? null).toBeNull();
    expect(layout.trail ?? null).toBeNull();
  });

  it("切到「正文后」改列数 → 写 entry.layout.trail.columns", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByText(SIDE_TRAIL));
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    const layout = entryLayoutOf(latest(calls));
    expect(layout.trail).toEqual({ columns: 3 });
    expect(layout.lead ?? null).toBeNull();
  });

  it("板块级 + 正文前 → 写 section.layout.lead，条目级不受影响", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    fireEvent.click(screen.getByText(SIDE_LEAD));
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    const next = latest(calls);
    expect(next.sections[0].layout.lead).toEqual({ columns: 2 });
    expect(next.sections[0].layout.columns).toBe(1);
    expect(next.sections[0].entries[0].layout.lead ?? null).toBeNull();
  });

  it("回到「共用」后控件仍写共用字段（分侧值保留）", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByText(SIDE_LEAD));
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    fireEvent.click(screen.getByText(SIDE_SHARED));
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    const layout = entryLayoutOf(latest(calls));
    expect(layout.columns).toBe(3);
    expect(layout.lead).toEqual({ columns: 2 });
  });
});

describe("分布（justify）", () => {
  it("单列时不渲染分布控件（没有列间空白）", () => {
    render(<Harness initial={makeDocument()} />);
    expect(screen.queryByText(t("structure.layout.justify"))).toBeNull();
  });

  it("多列时出现，选「两端」写进那一侧", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByText(SIDE_LEAD));
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    expect(screen.getByText(t("structure.layout.justify"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(JUSTIFY_BETWEEN));
    expect(entryLayoutOf(latest(calls)).lead).toEqual({ columns: 2, justify: "between" });
  });

  it("板块级「两端」写 section.justify", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    fireEvent.click(screen.getByText(JUSTIFY_BETWEEN));
    expect(latest(calls).sections[0].layout.justify).toBe("between");
  });
});
