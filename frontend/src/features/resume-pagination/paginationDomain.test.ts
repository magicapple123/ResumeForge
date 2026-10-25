// SPDX-License-Identifier: Apache-2.0
/** 分页意图域：语义锚点键、三态删键、版本丢弃、死数据裁剪。 */
import { describe, expect, it } from "vitest";
import {
  clearSectionsBreakBefore,
  countManualBreaks,
  pruneStalePagination,
  readPaginationDomain,
  sectionPaginationMode,
  setContinuation,
  setEntryBreak,
  setSectionBreak,
  setSectionsBreakBefore,
} from "./paginationDomain";

const EXP = "exp_12345678";
const PRJ = "prj_87654321";

function pagination(config: unknown): Record<string, unknown> {
  return (config as { pagination: Record<string, unknown> }).pagination;
}

describe("paginationDomain · 读取", () => {
  it("没有域 / 版本过高都当没有分页意图", () => {
    expect(readPaginationDomain(undefined)).toBeNull();
    expect(readPaginationDomain({})).toBeNull();
    expect(readPaginationDomain({ pagination: { version: 2 } } as never)).toBeNull();
  });

  it("非法条目 / 非法 id / 非法板块键 / 非法枚举值都丢弃", () => {
    const domain = readPaginationDomain({
      pagination: {
        version: 1,
        entries: {
          [EXP]: { break_before: "page", keep_with_next: 9, allow_split: "yes" },
          short: { break_before: "page" },
          [PRJ]: { break_before: "column" },
        },
        sections: {
          experience: { keep_with_next: 2 },
          "Bad Key": { break_before: "page" },
        },
        continuation: { repeat_name: true, page_numbers: false },
      },
    } as never);
    expect(domain).toEqual({
      entries: { [EXP]: { break_before: "page" } },
      sections: { experience: { keep_with_next: 2 } },
      continuation: { repeat_name: true },
    });
  });
});

describe("paginationDomain · 写入", () => {
  it("写条目意图只动这一条，其它 format_config 键原样保留", () => {
    const next = setEntryBreak({ accent: "#123456" }, EXP, { break_before: "page" });
    expect(next).toEqual({
      accent: "#123456",
      pagination: { version: 1, entries: { [EXP]: { break_before: "page" } } },
    });
  });

  it("逐项删键；全删后条目与空域都消失（恢复默认不写默认值）", () => {
    let config = setEntryBreak({}, EXP, { break_before: "page" });
    config = setEntryBreak(config, EXP, { keep_with_next: 2 });
    expect(pagination(config).entries).toEqual({
      [EXP]: { break_before: "page", keep_with_next: 2 },
    });
    config = setEntryBreak(config, EXP, { break_before: null, keep_with_next: null });
    expect(config).toEqual({});
  });

  it("板块意图与续页信息共用同一个域；false/0 都表示删键", () => {
    let config = setSectionBreak({}, "experience", { break_before: "page", keep_with_next: 1 });
    config = setContinuation(config, { repeat_name: true, page_numbers: true });
    expect(pagination(config)).toEqual({
      version: 1,
      sections: { experience: { break_before: "page", keep_with_next: 1 } },
      continuation: { repeat_name: true, page_numbers: true },
    });
    config = setContinuation(config, { repeat_name: false });
    config = setSectionBreak(config, "experience", { keep_with_next: 0 });
    expect(pagination(config).sections).toEqual({ experience: { break_before: "page" } });
    expect(pagination(config).continuation).toEqual({ page_numbers: true });
  });

  it("allow_split 只有 true 才落库（false = 默认行为 = 删键）", () => {
    let config = setEntryBreak({}, EXP, { allow_split: true });
    expect(pagination(config).entries).toEqual({ [EXP]: { allow_split: true } });
    config = setEntryBreak(config, EXP, { allow_split: false });
    expect(config).toEqual({});
  });
});

describe("paginationDomain · 全局板块分页方式", () => {
  const KEYS = ["education", "experience", "projects"];

  it("派生值：列出的板块全部断页才算「每板块新页」，否则「自然填充」", () => {
    expect(sectionPaginationMode(null, KEYS)).toBe("flow");
    expect(sectionPaginationMode(null, [])).toBe("flow");
    let config = setSectionsBreakBefore({}, KEYS);
    expect(sectionPaginationMode(readPaginationDomain(config), KEYS)).toBe("page");
    // 只有一部分设了 → 自然填充（界面会用小结说明"N 个板块从新页开始"）。
    config = setSectionsBreakBefore({}, ["experience", "projects"]);
    expect(sectionPaginationMode(readPaginationDomain(config), KEYS)).toBe("flow");
  });

  it("每板块新页：只写列出的板块，保留各自其它意图与条目级意图", () => {
    const base = setEntryBreak(
      setSectionBreak({ accent: "#123456" }, "experience", { keep_with_next: 2 }),
      EXP,
      { break_before: "page" },
    );
    const config = setSectionsBreakBefore(base, ["experience", "projects"]);
    expect(pagination(config)).toEqual({
      version: 1,
      entries: { [EXP]: { break_before: "page" } },
      sections: {
        experience: { keep_with_next: 2, break_before: "page" },
        projects: { break_before: "page" },
      },
    });
  });

  it("自然填充：清掉所有板块断页，但条目级断页与续页信息不动", () => {
    let config = setSectionsBreakBefore({}, KEYS);
    config = setSectionBreak(config, "experience", { keep_with_next: 1 });
    config = setEntryBreak(config, EXP, { break_before: "page" });
    config = setContinuation(config, { page_numbers: true });
    const next = clearSectionsBreakBefore(config);
    expect(pagination(next)).toEqual({
      version: 1,
      entries: { [EXP]: { break_before: "page" } },
      sections: { experience: { keep_with_next: 1 } },
      continuation: { page_numbers: true },
    });
  });

  it("自然填充：没有板块断页时原样返回（不凭空造域）", () => {
    expect(clearSectionsBreakBefore({ accent: "#123456" })).toEqual({ accent: "#123456" });
    // 只剩续页信息时，清完板块断页的后缀信息仍在。
    const config = setContinuation(setSectionsBreakBefore({}, ["experience"]), {
      repeat_name: true,
    });
    expect(pagination(clearSectionsBreakBefore(config))).toEqual({
      version: 1,
      continuation: { repeat_name: true },
    });
  });
});

describe("paginationDomain · 裁剪与计数", () => {
  const config = setContinuation(
    setSectionBreak(setEntryBreak({}, EXP, { break_before: "page" }), "experience", {
      break_before: "page",
    }),
    { page_numbers: true },
  );

  it("裁掉指向已不存在对象/板块的意图，其余保留", () => {
    const next = pruneStalePagination(config, [PRJ], ["projects"]);
    expect(pagination(next)).toEqual({
      version: 1,
      continuation: { page_numbers: true },
    });
  });

  it("没有可裁条目时返回原引用（宿主据此不写库）", () => {
    expect(pruneStalePagination(config, [EXP], ["experience"])).toBe(config);
  });

  it("手动断页计数", () => {
    expect(countManualBreaks(readPaginationDomain(config))).toEqual({ entries: 1, sections: 1 });
    expect(countManualBreaks(null)).toEqual({ entries: 0, sections: 0 });
  });
});
