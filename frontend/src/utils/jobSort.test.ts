// SPDX-License-Identifier: Apache-2.0
/** 岗位排序映射（R14/E）：列头 ↔ 后端 sort/order 的纯函数。 */
import { describe, expect, it } from "vitest";
import { DEFAULT_JOB_SORT_STATE, nextSortState, sortOrderFor } from "./jobSort";

describe("岗位排序映射（R14/E）", () => {
  it("默认排序不点亮任何列（列表接口不带参数时就是最近导入倒序）", () => {
    expect(sortOrderFor("posted_at", DEFAULT_JOB_SORT_STATE)).toBeNull();
    expect(sortOrderFor("title", DEFAULT_JOB_SORT_STATE)).toBeNull();
    expect(sortOrderFor("company", DEFAULT_JOB_SORT_STATE)).toBeNull();
  });

  it("列头第一次点击用该列自带方向，不写冗余 order", () => {
    expect(nextSortState("title", "ascend")).toEqual({ sort: "title_asc", order: null });
    expect(nextSortState("company", "ascend")).toEqual({ sort: "company_asc", order: null });
    expect(nextSortState("posted_at", "descend")).toEqual({ sort: "posted_desc", order: null });
  });

  it("反向点击带上显式 order（后端据此覆盖 sort 自带方向）", () => {
    const titleDesc = nextSortState("title", "descend");
    expect(titleDesc).toEqual({ sort: "title_asc", order: "desc" });
    expect(sortOrderFor("title", titleDesc)).toBe("descend");

    const postedAsc = nextSortState("posted_at", "ascend");
    expect(postedAsc).toEqual({ sort: "posted_desc", order: "asc" });
    expect(sortOrderFor("posted_at", postedAsc)).toBe("ascend");
  });

  it("取消排序或点到不支持的列时回到默认排序", () => {
    expect(nextSortState("title", null)).toEqual(DEFAULT_JOB_SORT_STATE);
    expect(nextSortState("actions", "ascend")).toEqual(DEFAULT_JOB_SORT_STATE);
  });
});
