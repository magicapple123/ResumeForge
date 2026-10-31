// SPDX-License-Identifier: Apache-2.0
/**
 * 分页汇总的纯数据层（Q08）：收集已设置断页、单个清除、板块级一键恢复。
 * 这里不渲染组件——面板只负责把芯片画出来，落点与"清哪个键"由本模块保证。
 */
import { describe, expect, it } from "vitest";
import {
  entry,
  fieldItem,
  makeDocument,
  section,
} from "../../../features/resume-document/documentFixtures";
import {
  defaultEntryLayout,
  defaultSectionLayout,
} from "../../../features/resume-document/defaults";
import {
  clearPageBreak,
  collectPageBreaks,
  hasSectionPageBreaks,
  restoreSectionPagination,
} from "./paginationBreaks";

function withSectionBreak(): ReturnType<typeof makeDocument> {
  const document = makeDocument();
  document.sections[0].layout.start_on_new_page = true;
  document.sections[0].layout.keep_together = true;
  return document;
}

function withEntryBreak(): ReturnType<typeof makeDocument> {
  const document = makeDocument();
  document.sections[0].entries[0].layout.start_on_new_page = true;
  document.sections[0].entries[0].layout.keep_together = true;
  document.sections[1].layout.start_on_new_page = true;
  return document;
}

describe("collectPageBreaks", () => {
  it("一个开关一条芯片：板块与条目两类都收，条目带共享显示名", () => {
    const rows = collectPageBreaks(withEntryBreak());
    // 顺序 = 文档顺序（板块级开关在前、条目级在后），便于芯片列表稳定可读。
    expect(rows.map((row) => row.id)).toEqual([
      "entry:education:ob_entry001:start_on_new_page",
      "entry:education:ob_entry001:keep_together",
      "section:summary:start_on_new_page",
    ]);
    // 条目名来自 entryDisplayLabel（title 值），不是「未命名条目 1」。
    expect(rows[0].entryLabel).toBe("Tsinghua University · Computer Science");
    expect(rows[0].path).toBe("education.ob_entry001");
    expect(rows[0].kind).toBe("entry");
    expect(rows[2].kind).toBe("section");
    expect(rows[2].path).toBe("summary");
  });

  it("没设置断页时返回空数组", () => {
    expect(collectPageBreaks(makeDocument())).toEqual([]);
  });

  it("隐藏条目的断页设置仍被收集（数据还在，解锁后生效）", () => {
    const document = makeDocument();
    document.sections[0].entries[0].hidden = true;
    document.sections[0].entries[0].layout.keep_together = true;
    expect(collectPageBreaks(document).map((row) => row.flag)).toEqual(["keep_together"]);
  });
});

describe("clearPageBreak", () => {
  it("只清这条芯片的开关，不动同一条目/板块的另一个开关", () => {
    const document = withSectionBreak();
    const item = collectPageBreaks(document)[0];
    const next = clearPageBreak(document, item);
    expect(next.sections[0].layout.start_on_new_page).toBe(false);
    expect(next.sections[0].layout.keep_together).toBe(true);
    // 不可变：原文档不动。
    expect(document.sections[0].layout.start_on_new_page).toBe(true);
  });

  it("条目级清除只写 entry.layout", () => {
    const document = withEntryBreak();
    const item = collectPageBreaks(document).find((row) => row.kind === "entry")!;
    const next = clearPageBreak(document, item);
    expect(next.sections[0].entries[0].layout.start_on_new_page).toBe(false);
    expect(next.sections[0].entries[0].layout.keep_together).toBe(true);
    expect(next.sections[0].layout.start_on_new_page).toBe(false);
  });
});

describe("restoreSectionPagination", () => {
  it("清掉全部板块级断页，条目级断页保持不动", () => {
    const document = withEntryBreak();
    const next = restoreSectionPagination(document);
    expect(hasSectionPageBreaks(next)).toBe(false);
    // 条目级两个开关都还在：它们由结构页签管理。
    expect(next.sections[0].entries[0].layout.start_on_new_page).toBe(true);
    expect(next.sections[0].entries[0].layout.keep_together).toBe(true);
  });

  it("本来就没有板块级断页时返回原引用（不制造历史点）", () => {
    const document = makeDocument();
    document.sections[0].entries[0].layout.start_on_new_page = true;
    expect(restoreSectionPagination(document)).toBe(document);
  });

  it("板块级/条目级都能被看见与清除：结构完整（夹具自检）", () => {
    const document = makeDocument({
      sections: [
        section({
          layout: { ...defaultSectionLayout(), keep_together: true },
          entries: [entry({ layout: { ...defaultEntryLayout(), start_on_new_page: true } })],
        }),
      ],
    });
    document.sections[0].entries[0].items = [fieldItem()];
    expect(collectPageBreaks(document)).toHaveLength(2);
  });
});
