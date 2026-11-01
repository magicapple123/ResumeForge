// SPDX-License-Identifier: Apache-2.0
/**
 * R-17：一步历史改动 → 一句话。这里钉住三件事：
 * 1. **优先级**（板块 > 条目 > 隐藏 > 排版 > 字段 > 值 > 版式参数）；
 * 2. **聚合**（同一步里改 3 个字段 = 「3 处修改」，不是 3 条记录）；
 * 3. **不误报**（`format_config` 键序不同但值相同 → 没有改动）。
 */
import { describe, expect, it } from "vitest";
import { describeChange, summarizeChange } from "./changeSummary";
import { entry, fieldItem, makeDocument, section, textItem } from "./documentFixtures";
import type { ResumeDocument } from "../../types/resumeDocument";
import type { ResumeLayout } from "../../types";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

function snap(document: ResumeDocument, layout: ResumeLayout = LAYOUT) {
  return { document, layout };
}

/** 把 education 的第一条目替换成给定条目，其余保持原样。 */
function withEntry(document: ResumeDocument, next: ReturnType<typeof entry>): ResumeDocument {
  return {
    ...document,
    sections: document.sections.map((item) =>
      item.key === "education" ? { ...item, entries: [next, ...item.entries.slice(1)] } : item,
    ),
  };
}

describe("summarizeChange（R-17）", () => {
  it("字段值修改：聚合成一处，并给出条目与字段名", () => {
    const before = makeDocument();
    const base = before.sections.find((item) => item.key === "education")!.entries[0];
    const after = withEntry(
      before,
      entry({
        id: base.id,
        items: base.items.map((item, index) =>
          index === 0 && item.kind === "field" ? { ...item, value: "Peking University" } : item,
        ),
      }),
    );
    const report = summarizeChange(snap(before), snap(after));
    expect(report?.main).toMatchObject({ kind: "value", count: 1 });
    expect(report?.others).toBe(0);
    // 条目名取改后的标题值（用户看到的就是纸面上那一行）。
    expect(describeChange(report!)).toContain("Peking University");
  });

  it("同一步改两个字段：count=2（不是两条记录）", () => {
    const before = makeDocument();
    const base = before.sections.find((item) => item.key === "education")!.entries[0];
    const after = withEntry(
      before,
      entry({
        id: base.id,
        items: [
          ...base.items.map((item) =>
            item.kind === "field" ? { ...item, value: `${item.value}（改）` } : item,
          ),
          textItem({ id: "ob_text0002", text: "新增一行" }),
        ],
      }),
    );
    const report = summarizeChange(snap(before), snap(after));
    expect(report?.main.kind).toBe("field-add");
  });

  it("条目新增优先于字段修改", () => {
    const before = makeDocument();
    const after = {
      ...before,
      sections: before.sections.map((item) =>
        item.key === "education"
          ? { ...item, entries: [...item.entries, entry({ id: "ob_entry999" })] }
          : item,
      ),
    };
    const report = summarizeChange(snap(before), snap(after));
    expect(report?.main).toMatchObject({ kind: "entry-add", count: 1 });
  });

  it("隐藏条目", () => {
    const before = makeDocument();
    const base = before.sections.find((item) => item.key === "education")!.entries[0];
    const after = withEntry(before, entry({ id: base.id, hidden: true, items: base.items }));
    expect(summarizeChange(snap(before), snap(after))?.main.kind).toBe("entry-hide");
  });

  it("板块排序", () => {
    const before = makeDocument();
    const after = { ...before, sections: [...before.sections].reverse() };
    const report = summarizeChange(snap(before), snap(after));
    expect(report?.main.kind).toBe("section-move");
  });

  it("版式参数：页数优先于 format_config", () => {
    const document = makeDocument();
    const after: ResumeLayout = { ...LAYOUT, page_limit: 2, format_config: { "body.gap": 4 } };
    const report = summarizeChange(snap(document), snap(document, after));
    expect(report?.main).toMatchObject({ kind: "layout-pages", pages: 2 });
  });

  it("format_config 只是键序不同：不算改动（稳定序列化）", () => {
    const document = makeDocument();
    const left: ResumeLayout = {
      ...LAYOUT,
      format_config: { "font.scale": 1.1, "body.bold": "unset", "section.gap": 4 },
    };
    const right: ResumeLayout = {
      ...LAYOUT,
      format_config: { "section.gap": 4, "body.bold": "unset", "font.scale": 1.1 },
    };
    expect(summarizeChange(snap(document, left), snap(document, right))).toBeNull();
  });

  it("完全一致：返回 null（调用方回退规模摘要）", () => {
    const document = makeDocument();
    expect(summarizeChange(snap(document), snap(document))).toBeNull();
  });

  it("板块新增：只报一条，不再继续报它下面的条目", () => {
    const before = makeDocument();
    const after = {
      ...before,
      sections: [
        ...before.sections,
        section({ key: "projects", title: "项目经历", entries: [entry({ id: "ob_p1" })] }),
      ],
    };
    const report = summarizeChange(snap(before), snap(after));
    expect(report?.main).toMatchObject({ kind: "section-add", section: "项目经历" });
  });

  it("条目排版变化（head/分页）：单独成一类", () => {
    const before = makeDocument();
    const base = before.sections.find((item) => item.key === "education")!.entries[0];
    const after = withEntry(
      before,
      entry({
        id: base.id,
        items: base.items,
        layout: { ...base.layout, keep_together: !base.layout.keep_together },
      }),
    );
    expect(summarizeChange(snap(before), snap(after))?.main.kind).toBe("entry-layout");
  });
});

describe("describeChange 文案", () => {
  it("有次要改动时带「等 N 项」", () => {
    const before = makeDocument();
    const base = before.sections.find((item) => item.key === "education")!.entries[0];
    const after = withEntry(
      before,
      entry({
        id: base.id,
        items: base.items.map((item) =>
          item.kind === "field" ? { ...item, value: `${item.value}!` } : item,
        ),
      }),
    );
    const layout: ResumeLayout = { ...LAYOUT, page_limit: 3 };
    const report = summarizeChange(snap(before), snap(after, layout))!;
    expect(report.others).toBeGreaterThan(0);
    expect(describeChange(report)).toContain(String(report.others));
  });

  it("新增字段的文案里带字段名（label 优先）", () => {
    const before = makeDocument();
    const base = before.sections.find((item) => item.key === "education")!.entries[0];
    const after = withEntry(
      before,
      entry({
        id: base.id,
        items: [
          ...base.items,
          fieldItem({ id: "ob_field999", key: "team_size", label: "团队规模", value: "8 人" }),
        ],
      }),
    );
    const report = summarizeChange(snap(before), snap(after))!;
    expect(report.main.kind).toBe("field-add");
    expect(describeChange(report)).toContain("团队规模");
  });
});
