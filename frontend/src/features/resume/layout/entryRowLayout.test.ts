// SPDX-License-Identifier: Apache-2.0
/**
 * 分侧（正文前 / 正文后）列布局的纯数据规则（问题 4）。
 *
 * 要钉住的三件事：
 * 1. **继承链顺序**：`entry.lead.X ?? entry.X ?? section.lead.X ?? section.X ?? 默认`——
 *    「条目共用值优先于板块分侧值」是刻意的（条目自己那一套范围更近），写反了在界面上
 *    只表现为"我设了板块分侧，但有条目的老覆盖时没生效"，很难靠肉眼发现；
 * 2. **写回只清自己那一侧**：把 `lead` 全部置 null 时把整个分侧对象删掉（否则文档里留
 *    一堆 `lead: {columns: null, …}` 空壳，金标产物跟着变）；
 * 3. **逐列宽度 / 逐间隔跟着侧走**：长度与分侧列数对不上就返回 null（与后端
 *    `resolved_column_geometry` 同口径，否则"设了宽度却不生效"）。
 */
import { describe, expect, it } from "vitest";
import {
  defaultEntryLayout,
  defaultFieldItem,
  defaultSectionLayout,
  makeEntry,
  makeResumeDocument,
  makeSection,
} from "../../../test/documentHarness";
import type {
  EntryLayout,
  ResumeDocument,
  RowLayout,
  SectionLayout,
} from "../../../types/resumeDocument";
import {
  effectiveSideAlign,
  effectiveSideColumnGaps,
  effectiveSideColumns,
  effectiveSideColumnWidths,
  effectiveSideGap,
  effectiveSideJustify,
  entrySideOverrides,
  justifyAvailable,
  patchRowLayout,
  sideHasFields,
  sideSource,
} from "./entryRowLayout";

const ENTRY_ID = "entry_01";

function makeDoc(
  entryLayout: Partial<EntryLayout> = {},
  sectionLayout: Partial<SectionLayout> = {},
): ResumeDocument {
  return makeResumeDocument({
    sections: [
      makeSection(
        "education",
        "entries",
        [
          makeEntry(
            [
              defaultFieldItem({ id: "gpa", key: "gpa", value: "3.9", placement: "lead" }),
              defaultFieldItem({ id: "rank", key: "rank", value: "1/120", placement: "trail" }),
            ],
            { id: ENTRY_ID, layout: { ...defaultEntryLayout(), ...entryLayout } },
          ),
        ],
        { layout: { ...defaultSectionLayout(), ...sectionLayout } },
      ),
    ],
  });
}

const doc = makeDoc();
const entry = doc.sections[0].entries[0];
const section = doc.sections[0];

describe("分侧生效值（继承链）", () => {
  it("全空 = 1 列 / 等宽 / 靠左 / 无间距（与拆开之前完全一致）", () => {
    expect(effectiveSideColumns(section, entry, "lead")).toBe(1);
    expect(effectiveSideAlign(section, entry, "lead")).toBe("equal");
    expect(effectiveSideJustify(section, entry, "lead")).toBe("start");
    expect(effectiveSideGap(section, entry, "lead")).toBeNull();
  });

  it("板块分侧值生效；另一侧不受影响", () => {
    const scoped = makeDoc({}, { lead: { columns: 2 }, trail: { columns: 3 } });
    const within = scoped.sections[0];
    expect(effectiveSideColumns(within, within.entries[0], "lead")).toBe(2);
    expect(effectiveSideColumns(within, within.entries[0], "trail")).toBe(3);
  });

  it("条目共用值优先于板块分侧值（范围更近）", () => {
    const scoped = makeDoc({ columns: 1 }, { lead: { columns: 3 } });
    const within = scoped.sections[0];
    expect(effectiveSideColumns(within, within.entries[0], "lead")).toBe(1);
  });

  it("条目分侧值 > 条目共用值 > 板块分侧值 > 板块共用值", () => {
    const scoped = makeDoc(
      { columns: 1, gap: 2, justify: "start", lead: { columns: 2, gap: 4, justify: "between" } },
      { columns: 3, lead: { columns: 3, gap: 6 } },
    );
    const within = scoped.sections[0];
    const target = within.entries[0];
    expect(effectiveSideColumns(within, target, "lead")).toBe(2);
    expect(effectiveSideGap(within, target, "lead")).toBe(4);
    expect(effectiveSideJustify(within, target, "lead")).toBe("between");
    // trail 没有条目分侧值 → 条目共用值赢过板块分侧值
    expect(effectiveSideColumns(within, target, "trail")).toBe(1);
    expect(effectiveSideGap(within, target, "trail")).toBe(2);
  });

  it("板块分侧值在条目没有共用覆盖时接住（含 0 间距这个合法值）", () => {
    const scoped = makeDoc({}, { trail: { columns: 2, gap: 0, align: "flow" } });
    const within = scoped.sections[0];
    expect(effectiveSideColumns(within, within.entries[0], "trail")).toBe(2);
    expect(effectiveSideGap(within, within.entries[0], "trail")).toBe(0);
    expect(effectiveSideAlign(within, within.entries[0], "trail")).toBe("flow");
  });

  it("逐列宽度 / 逐间隔与分侧列数对不上时整体作废（返回 null）", () => {
    const scoped = makeDoc({}, { lead: { columns: 2, column_widths: [60, 40], column_gaps: [3] } });
    const within = scoped.sections[0];
    expect(effectiveSideColumnWidths(within, within.entries[0], "lead")).toEqual([60, 40]);
    expect(effectiveSideColumnGaps(within, within.entries[0], "lead")).toEqual([3]);
    // 换了列数（3 列）但宽度仍是 2 个 → 作废
    const three = makeDoc({}, { lead: { columns: 3, column_widths: [60, 40], column_gaps: [3] } });
    const withinThree = three.sections[0];
    expect(effectiveSideColumnWidths(withinThree, withinThree.entries[0], "lead")).toBeNull();
    expect(effectiveSideColumnGaps(withinThree, withinThree.entries[0], "lead")).toBeNull();
  });
});

describe("分布开关的可用性", () => {
  it("只在等宽 + 多列 + 没有显式列宽时可用", () => {
    expect(justifyAvailable(2, "equal", null)).toBe(true);
    expect(justifyAvailable(1, "equal", null)).toBe(false);
    expect(justifyAvailable(3, "flow", null)).toBe(false);
    // 宽度合计 100% 时没有剩余空间 → 开关无效
    expect(justifyAvailable(2, "equal", [50, 50])).toBe(false);
  });
});

describe("sideHasFields / sideSource", () => {
  it("该侧有没有灰字段（决定「对象」里是否出现这一侧）", () => {
    expect(sideHasFields(entry, "lead")).toBe(true);
    expect(sideHasFields(entry, "trail")).toBe(true);
    expect(sideHasFields(null, "lead")).toBe(false);
  });

  it("来源判定：条目分侧 → 条目共用 → 板块分侧 → 板块 → 默认", () => {
    const scoped = makeDoc({ lead: { columns: 2 } }, { lead: { gap: 3 } });
    const within = scoped.sections[0];
    const target = within.entries[0];
    expect(sideSource(within, target, "lead", "columns")).toBe("entry");
    expect(sideSource(within, target, "lead", "gap")).toBe("section");
    // gap 在板块层缺省是 null（columns 缺省是 1，所以它永远有值）
    expect(sideSource(within, target, "trail", "gap")).toBe("default");
  });

  it("条目分侧覆盖项判定四舍五入到四项", () => {
    const scoped = makeDoc({ lead: { columns: 2, justify: "between" } });
    const within = scoped.sections[0];
    expect(entrySideOverrides(within.entries[0], "lead")).toEqual({
      columns: true,
      align: false,
      justify: true,
      gap: false,
    });
    expect(entrySideOverrides(within.entries[0], "trail")).toEqual({
      columns: false,
      align: false,
      justify: false,
      gap: false,
    });
  });
});

describe("patchRowLayout（写回）", () => {
  function layoutOf(result: ResumeDocument, side: "lead" | "trail"): RowLayout | null {
    return result.sections[0].entries[0].layout[side] ?? null;
  }

  it("写条目某一侧，只动这一侧", () => {
    const next = patchRowLayout(doc, "education", ENTRY_ID, "lead", { columns: 2 });
    expect(layoutOf(next, "lead")).toEqual({ columns: 2 });
    expect(layoutOf(next, "trail")).toBeNull();
    // 原文档不可变（默认条目布局里 lead 是 null / 缺省）
    expect(doc.sections[0].entries[0].layout.lead ?? null).toBeNull();
  });

  it("合并已有键（改间距不清列数）", () => {
    const once = patchRowLayout(doc, "education", ENTRY_ID, "lead", { columns: 2 });
    const twice = patchRowLayout(once, "education", ENTRY_ID, "lead", { gap: 4 });
    expect(layoutOf(twice, "lead")).toEqual({ columns: 2, gap: 4 });
  });

  it("全部置 null 时把整个分侧对象删掉（不留空壳）", () => {
    const once = patchRowLayout(doc, "education", ENTRY_ID, "lead", { columns: 2, gap: 4 });
    const cleared = patchRowLayout(once, "education", ENTRY_ID, "lead", {
      columns: null,
      gap: null,
    });
    expect(layoutOf(cleared, "lead")).toBeNull();
  });

  it("entryId = null 时写板块级分侧值", () => {
    const next = patchRowLayout(doc, "education", null, "trail", {
      columns: 3,
      justify: "between",
    });
    expect(next.sections[0].layout.trail).toEqual({ columns: 3, justify: "between" });
    // 条目级没有被顺手改掉
    expect(next.sections[0].entries[0].layout.trail ?? null).toBeNull();
  });

  it("找不到板块 / 条目时不动文档（不抛错、不新建覆盖）", () => {
    expect(patchRowLayout(doc, "nope", ENTRY_ID, "lead", { columns: 2 })).toBe(doc);
    const missingEntry = patchRowLayout(doc, "education", "nope", "lead", { columns: 2 });
    expect(missingEntry.sections[0].entries[0].layout.lead ?? null).toBeNull();
  });
});
