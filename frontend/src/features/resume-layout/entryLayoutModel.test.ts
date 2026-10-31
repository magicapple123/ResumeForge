// SPDX-License-Identifier: Apache-2.0
/** P5-4：条目布局继承链的纯数据规则（来源判定 + 逐项恢复继承）。 */
import { describe, expect, it } from "vitest";
import {
  defaultEntryLayout,
  defaultSectionLayout,
  defaultTextItem,
  makeEntry,
  makeResumeDocument,
  makeSection,
} from "../../test/documentHarness";
import type { EntryLayout, ResumeDocument } from "../../types/resumeDocument";
import { entryLayoutOverrides, restoreEntryLayoutField } from "./entryLayoutModel";

function makeDoc(entryLayout: Partial<EntryLayout>, sectionColumns: 1 | 2 | 3 = 1): ResumeDocument {
  return makeResumeDocument({
    sections: [
      makeSection(
        "education",
        "entries",
        [
          makeEntry([defaultTextItem("合成样本")], {
            id: "entry_01",
            layout: { ...defaultEntryLayout(), ...entryLayout },
          }),
        ],
        { layout: { ...defaultSectionLayout(), columns: sectionColumns } },
      ),
    ],
  });
}

describe("entryLayoutOverrides", () => {
  it("全部为 null = 三项都继承板块；head 不计入可继承项", () => {
    const doc = makeDoc({ head: "stacked" });
    expect(entryLayoutOverrides(doc.sections[0].entries[0])).toEqual({
      columns: false,
      align: false,
      gap: false,
    });
  });

  it("显式值（含 0 间距）= 本条覆盖", () => {
    const doc = makeDoc({ columns: 2, align: "flow", gap: 0 });
    expect(entryLayoutOverrides(doc.sections[0].entries[0])).toEqual({
      columns: true,
      align: true,
      gap: true,
    });
  });

  it("没有条目时按全继承处理，不抛错", () => {
    expect(entryLayoutOverrides(null)).toEqual({ columns: false, align: false, gap: false });
  });
});

describe("restoreEntryLayoutField", () => {
  it("只把指定项置 null：不动板块、不动其它覆盖项", () => {
    const doc = makeDoc({ head: "stacked", columns: 2, align: "flow", gap: 1 }, 3);
    const sectionBefore = JSON.parse(JSON.stringify(doc.sections[0].layout));
    const next = restoreEntryLayoutField(doc, "education", "entry_01", "columns");
    const entry = next.sections[0].entries[0];
    expect(entry.layout.columns).toBeNull();
    expect(entry.layout.align).toBe("flow");
    expect(entry.layout.gap).toBe(1);
    expect(entry.layout.head).toBe("stacked");
    // 不写 section.layout
    expect(next.sections[0].layout.columns).toBe(3);
    expect(next.sections[0].layout).toEqual(sectionBefore);
    // 不可变：原文档仍是覆盖值
    expect(doc.sections[0].entries[0].layout.columns).toBe(2);
  });

  it("恢复已经继承的项是幂等操作", () => {
    const doc = makeDoc({ columns: null, gap: null });
    const next = restoreEntryLayoutField(doc, "education", "entry_01", "gap");
    expect(next.sections[0].entries[0].layout.gap).toBeNull();
    expect(next.sections[0].layout).toEqual(doc.sections[0].layout);
  });
});
