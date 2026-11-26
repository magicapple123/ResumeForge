// SPDX-License-Identifier: Apache-2.0
/** 排序状态的语义（R13）：翻转、换字段回默认、非法 URL 回落、默认不写参数。 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRACK_SORT,
  nextTrackSort,
  parseTrackSort,
  TRACK_SORT_DEFAULT_ORDERS,
  trackSortParams,
} from "./trackSort";

describe("parseTrackSort", () => {
  it("缺省与非法值都回落「阶段优先」，且不带方向", () => {
    expect(parseTrackSort(null, null)).toEqual(DEFAULT_TRACK_SORT);
    expect(parseTrackSort("", "")).toEqual(DEFAULT_TRACK_SORT);
    expect(parseTrackSort("bogus", "desc")).toEqual(DEFAULT_TRACK_SORT);
    // 阶段优先是固定次序：URL 里写了方向也不认（界面不显示方向，服务端也不翻）。
    expect(parseTrackSort("stage", "asc")).toEqual(DEFAULT_TRACK_SORT);
  });

  it("字段合法但方向缺失/非法时用该字段的默认方向", () => {
    expect(parseTrackSort("applied_at", null)).toEqual({ key: "applied_at", order: "desc" });
    expect(parseTrackSort("company", "sideways")).toEqual({ key: "company", order: "asc" });
  });

  it("合法字段 + 合法方向原样保留（刷新后要能恢复翻转过的方向）", () => {
    expect(parseTrackSort("updated", "asc")).toEqual({ key: "updated", order: "asc" });
    expect(parseTrackSort("next_action_date", "desc")).toEqual({
      key: "next_action_date",
      order: "desc",
    });
  });
});

describe("nextTrackSort", () => {
  it("重复点当前项 = 翻转方向", () => {
    const once = nextTrackSort({ key: "updated", order: "desc" }, "updated");
    expect(once).toEqual({ key: "updated", order: "asc" });
    expect(nextTrackSort(once, "updated")).toEqual({ key: "updated", order: "desc" });
  });

  it("换字段 = 该字段默认方向（不继承上一个字段的方向）", () => {
    // 上一个字段是 asc，点「投递时间」仍应回到它自己的默认 desc。
    expect(nextTrackSort({ key: "updated", order: "asc" }, "applied_at")).toEqual({
      key: "applied_at",
      order: TRACK_SORT_DEFAULT_ORDERS.applied_at,
    });
  });

  it("点「阶段优先」永远回到默认态（它没有方向可翻）", () => {
    expect(nextTrackSort({ key: "company", order: "desc" }, "stage")).toEqual(DEFAULT_TRACK_SORT);
    expect(nextTrackSort(DEFAULT_TRACK_SORT, "stage")).toEqual(DEFAULT_TRACK_SORT);
  });
});

describe("trackSortParams", () => {
  it("默认排序不发任何排序参数（请求与改造前一致）", () => {
    expect(trackSortParams(DEFAULT_TRACK_SORT)).toEqual({});
  });

  it("非默认排序带上字段与方向", () => {
    expect(trackSortParams({ key: "company", order: "desc" })).toEqual({
      sort: "company",
      order: "desc",
    });
  });
});
