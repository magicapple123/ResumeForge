// SPDX-License-Identifier: Apache-2.0
/**
 * 分页意图 prune 的"活对象清单"：任何对象数组里的合法 `id` 都算条目。
 *
 * 边界都由**宽松方向**定义：多收一个 id 只是少删一条意图，少收一个会悄悄删掉用户的
 * 断页设置（不可撤销）。所以这里刻意钉住几条"看起来该收/该跳"的行为。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types";
import { collectPaginationEntryIds } from "./paginationEntryIds";

/** 造一份最小正文；条目形状用 `unknown` 断言进类型（正文允许旧版/半成品形状）。 */
function content(overrides: Record<string, unknown>): ResumeContent {
  return {
    photo: "",
    name: "",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
    ...overrides,
  } as unknown as ResumeContent;
}

describe("collectPaginationEntryIds", () => {
  it("顶层板块数组与条目内嵌的 entries 数组都会被收集（嵌套多板块）", () => {
    const ids = collectPaginationEntryIds(
      content({
        experience: [{ id: "exp_12345678" }, { id: "exp_87654321" }],
        education: [
          {
            id: "edu_12345678",
            entries: [{ id: "edu_research_01" }, { id: "edu_research_02" }],
          },
        ],
        projects: [{ id: "prj_12345678", name: "Acme" }],
      }),
    );
    // 顺序 = 正文键的顺序（`education` 在 `experience` 前），不是调用处写属性的顺序。
    expect(ids).toEqual([
      "edu_12345678",
      "edu_research_01",
      "edu_research_02",
      "exp_12345678",
      "exp_87654321",
      "prj_12345678",
    ]);
  });

  it("没有 id、id 不是字符串、id 形状不合法的条目一律跳过", () => {
    const ids = collectPaginationEntryIds(
      content({
        experience: [
          { company: "no-id" },
          { id: 42 },
          { id: "short" },
          { id: "bad id with spaces" },
          { id: "" },
          { id: "exp_12345678" },
        ],
      }),
    );
    expect(ids).toEqual(["exp_12345678"]);
  });

  it("重复 id 去重，并保持首次出现的顺序", () => {
    const ids = collectPaginationEntryIds(
      content({
        experience: [{ id: "exp_12345678" }],
        projects: [{ id: "prj_12345678" }, { id: "exp_12345678" }],
      }),
    );
    expect(ids).toEqual(["exp_12345678", "prj_12345678"]);
  });

  it("null / undefined / 非对象正文返回空数组（不是「全都过期」）", () => {
    expect(collectPaginationEntryIds(null)).toEqual([]);
    expect(collectPaginationEntryIds(undefined)).toEqual([]);
    expect(collectPaginationEntryIds("not-a-content" as unknown as ResumeContent)).toEqual([]);
    expect(collectPaginationEntryIds([] as unknown as ResumeContent)).toEqual([]);
  });

  it("未知结构（字符串/number/null/深层畸形）不抛异常，仍然找得到兄弟里的条目", () => {
    expect(() =>
      collectPaginationEntryIds(
        content({
          experience: [null, "text", 7, { id: "exp_12345678", nested: { deeper: [null] } }],
          awards: "unexpected-string",
          skills: [["odd-nested-array"], { id: "skl_12345678" }],
        }),
      ),
    ).not.toThrow();
    expect(collectPaginationEntryIds(content({ experience: [{ id: "exp_12345678" }] }))).toEqual([
      "exp_12345678",
    ]);
  });

  it("自引用/超深结构被深度上限截断，不会爆栈", () => {
    const deep: Record<string, unknown> = { id: "exp_12345678" };
    let cursor = deep;
    for (let index = 0; index < 40; index += 1) {
      const next: Record<string, unknown> = {};
      cursor["next"] = next;
      cursor = next;
    }
    // 手写环引用：只在深度上限内被遍历完，绝不能让调用方抛 RangeError。
    cursor["loop"] = deep;
    expect(() => collectPaginationEntryIds(deep as unknown as ResumeContent)).not.toThrow();
  });
});
