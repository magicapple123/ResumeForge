/** 岗位排序映射（R14）：列头 ↔ 后端 sort/order 的纯函数。 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_SORT_STATE,
  isJobSort,
  isJobSortOrder,
  nextSortState,
  sortOrderFor,
} from "./jobSort";

describe("岗位排序映射（R14）", () => {
  it("默认排序只让「发布时间」列显示倒序箭头", () => {
    expect(sortOrderFor("created_at", DEFAULT_JOB_SORT_STATE)).toBe("descend");
    expect(sortOrderFor("title", DEFAULT_JOB_SORT_STATE)).toBeNull();
    expect(sortOrderFor("company", DEFAULT_JOB_SORT_STATE)).toBeNull();
  });

  it("列头第一次点击用该列自带方向，不写冗余 order", () => {
    expect(nextSortState("title", "ascend")).toEqual({ sort: "title_asc", order: null });
    expect(nextSortState("company", "ascend")).toEqual({ sort: "company_asc", order: null });
    expect(nextSortState("created_at", "descend")).toEqual({ sort: "created_desc", order: null });
  });

  it("反向点击带上显式 order（后端据此覆盖 sort 自带方向）", () => {
    const titleDesc = nextSortState("title", "descend");
    expect(titleDesc).toEqual({ sort: "title_asc", order: "desc" });
    expect(sortOrderFor("title", titleDesc)).toBe("descend");

    const createdAsc = nextSortState("created_at", "ascend");
    expect(createdAsc).toEqual({ sort: "created_desc", order: "asc" });
    expect(sortOrderFor("created_at", createdAsc)).toBe("ascend");
  });

  it("取消排序或点到不支持的列时回到默认排序", () => {
    expect(nextSortState("title", null)).toEqual(DEFAULT_JOB_SORT_STATE);
    // posted_at 是列头展示的字段，后端没有可排的列，不能把它当成排序键。
    expect(nextSortState("posted_at", "ascend")).toEqual(DEFAULT_JOB_SORT_STATE);
  });

  it("URL 里的非法值不被当成合法排序", () => {
    expect(isJobSort("bogus")).toBe(false);
    expect(isJobSort("title_asc")).toBe(true);
    expect(isJobSortOrder("asc")).toBe(true);
    expect(isJobSortOrder("sideways")).toBe(false);
  });
});
