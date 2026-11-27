// SPDX-License-Identifier: Apache-2.0
/**
 * 组级排序（折叠视图）的口径测试。
 *
 * 钉住五件事：默认态、三个字段的升降序、等值组的稳定次序（最近更新倒序 → id 倒序）、
 * 缺失 / 非法时间回落 0、空数组。
 *
 * 为什么"等值组稳定"值得单列一条：排序不稳定时用户看到的是"翻页后列表在乱跳"，
 * 而这类抖动在截图里永远看不出来——只能靠这条用例拦。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_SORT_STATE,
  groupSortDirections,
  groupSortOrderFor,
  isDefaultGroupSort,
  nextGroupSortState,
  sortGroups,
  type GroupSortState,
  type GroupSortable,
} from "./groupSort";

function group(overrides: Partial<GroupSortable> & { key: string }): GroupSortable {
  return {
    jobTitle: "",
    deliveryCount: 0,
    latestUpdatedAt: "2026-11-01T08:00:00",
    latest: { id: Number(overrides.key.replace(/\D/g, "")) || 1, title: "resume" },
    ...overrides,
  };
}

const ids = (groups: GroupSortable[]): string[] => groups.map((item) => item.key);

const state = (field: GroupSortState["field"], order: GroupSortState["order"]): GroupSortState => ({
  field,
  order,
  explicit: true,
});

describe("sortGroups 默认态", () => {
  it("默认是最近更新倒序，且不标记为显式", () => {
    expect(DEFAULT_GROUP_SORT_STATE).toEqual({ field: "updated", order: "desc", explicit: false });
    expect(isDefaultGroupSort(DEFAULT_GROUP_SORT_STATE)).toBe(true);
    // 默认态列头不带箭头：任何一列都返回 null。
    for (const key of ["identity", "updated", "delivery"]) {
      expect(groupSortOrderFor(key, DEFAULT_GROUP_SORT_STATE)).toBeNull();
    }
  });

  it("默认顺序与改造前的服务端顺序一致（最近更新在前）", () => {
    const groups = [
      group({ key: "a", latestUpdatedAt: "2026-11-01T08:00:00" }),
      group({ key: "b", latestUpdatedAt: "2026-11-03T08:00:00" }),
      group({ key: "c", latestUpdatedAt: "2026-11-02T08:00:00" }),
    ];

    expect(ids(sortGroups(groups, DEFAULT_GROUP_SORT_STATE))).toEqual(["b", "c", "a"]);
  });
});

describe("sortGroups 三个字段的升降序", () => {
  const groups = [
    group({ key: "job-3", jobTitle: "后端工程师", deliveryCount: 1 }),
    group({ key: "job-1", jobTitle: "数据分析师", deliveryCount: 5 }),
    group({ key: "job-2", jobTitle: "算法工程师", deliveryCount: 3 }),
  ];

  it("身份：按岗位名（通用简历回落到标题）升序 / 降序", () => {
    expect(ids(sortGroups(groups, state("identity", "asc")))).toEqual(["job-3", "job-1", "job-2"]);
    expect(ids(sortGroups(groups, state("identity", "desc")))).toEqual(["job-2", "job-1", "job-3"]);
  });

  it("身份：岗位名为空的通用简历用最新版标题参与排序", () => {
    const mixed = [
      group({ key: "a", jobTitle: "", latest: { id: 1, title: "B 通用简历" } }),
      group({ key: "b", jobTitle: "", latest: { id: 2, title: "A 通用简历" } }),
    ];

    expect(ids(sortGroups(mixed, state("identity", "asc")))).toEqual(["b", "a"]);
  });

  it("投递次数：升序 / 降序", () => {
    expect(ids(sortGroups(groups, state("delivery", "asc")))).toEqual(["job-3", "job-2", "job-1"]);
    expect(ids(sortGroups(groups, state("delivery", "desc")))).toEqual(["job-1", "job-2", "job-3"]);
  });

  it("最近更新：升序 / 降序", () => {
    const dated = [
      group({ key: "old", latestUpdatedAt: "2026-10-01T08:00:00" }),
      group({ key: "mid", latestUpdatedAt: "2026-10-15T08:00:00" }),
      group({ key: "new", latestUpdatedAt: "2026-11-01T08:00:00" }),
    ];

    expect(ids(sortGroups(dated, state("updated", "asc")))).toEqual(["old", "mid", "new"]);
    expect(ids(sortGroups(dated, state("updated", "desc")))).toEqual(["new", "mid", "old"]);
  });

  it("排序不修改入参（返回新数组）", () => {
    const input = [group({ key: "a", deliveryCount: 2 }), group({ key: "b", deliveryCount: 1 })];

    sortGroups(input, state("delivery", "asc"));

    expect(ids(input)).toEqual(["a", "b"]);
  });
});

describe("sortGroups 稳定性（等值组）", () => {
  it("投递次数相同时按最近更新倒序，而不是按输入顺序", () => {
    const groups = [
      group({ key: "a", deliveryCount: 0, latestUpdatedAt: "2026-11-01T08:00:00" }),
      group({ key: "b", deliveryCount: 0, latestUpdatedAt: "2026-11-03T08:00:00" }),
      group({ key: "c", deliveryCount: 0, latestUpdatedAt: "2026-11-02T08:00:00" }),
    ];

    expect(ids(sortGroups(groups, state("delivery", "desc")))).toEqual(["b", "c", "a"]);
    // 方向只作用于主键：升序时等值组内部次序不变（仍然是最近更新在前）。
    expect(ids(sortGroups(groups, state("delivery", "asc")))).toEqual(["b", "c", "a"]);
  });

  it("更新时间也相同时按 id 倒序，保证分页 / 重取后顺序一致", () => {
    const same = "2026-11-01T08:00:00";
    const groups = [
      group({ key: "x", latest: { id: 12, title: "r12" }, latestUpdatedAt: same }),
      group({ key: "y", latest: { id: 40, title: "r40" }, latestUpdatedAt: same }),
      group({ key: "z", latest: { id: 7, title: "r7" }, latestUpdatedAt: same }),
    ];

    expect(ids(sortGroups(groups, DEFAULT_GROUP_SORT_STATE))).toEqual(["y", "x", "z"]);
  });

  it("同一批数据换一个输入顺序，结果仍完全相同", () => {
    const same = "2026-11-01T08:00:00";
    const forward = [
      group({ key: "x", latest: { id: 12, title: "r12" }, latestUpdatedAt: same }),
      group({ key: "y", latest: { id: 40, title: "r40" }, latestUpdatedAt: same }),
      group({ key: "z", latest: { id: 7, title: "r7" }, latestUpdatedAt: same }),
    ];

    const backward = [...forward].reverse();

    expect(ids(sortGroups(forward, state("updated", "desc")))).toEqual(
      ids(sortGroups(backward, state("updated", "desc"))),
    );
  });
});

describe("sortGroups 边界", () => {
  it("最近更新缺失 / 非法值回落 0：升序最前、降序最后", () => {
    const groups = [
      group({ key: "bad", latestUpdatedAt: "not-a-date" }),
      group({ key: "none", latestUpdatedAt: null }),
      group({ key: "real", latestUpdatedAt: "2026-11-01T08:00:00" }),
    ];

    // 两个 0 之间走 tie-breaker（最近更新都是 0 → id 倒序：none 的 id 来自 key，回落 1）。
    const asc = ids(sortGroups(groups, state("updated", "asc")));
    expect(asc.indexOf("real")).toBe(2);
    expect(ids(sortGroups(groups, state("updated", "desc")))[0]).toBe("real");
  });

  it("空数组返回空数组", () => {
    expect(sortGroups([], DEFAULT_GROUP_SORT_STATE)).toEqual([]);
  });
});

describe("列头三态 ↔ 状态", () => {
  it("每列第一次点击的默认方向：身份升序，最近更新与投递降序", () => {
    expect(groupSortDirections("identity")).toEqual(["ascend", "descend"]);
    expect(groupSortDirections("updated")).toEqual(["descend", "ascend"]);
    expect(groupSortDirections("delivery")).toEqual(["descend", "ascend"]);
  });

  it("点一次升序、再点降序、第三次取消回默认", () => {
    const first = nextGroupSortState("identity", "ascend");
    expect(first).toEqual({ field: "identity", order: "asc", explicit: true });
    expect(groupSortOrderFor("identity", first)).toBe("ascend");

    const second = nextGroupSortState("identity", "descend");
    expect(second).toEqual({ field: "identity", order: "desc", explicit: true });
    expect(groupSortOrderFor("identity", second)).toBe("descend");

    const third = nextGroupSortState("identity", null);
    expect(third).toEqual(DEFAULT_GROUP_SORT_STATE);
    expect(isDefaultGroupSort(third)).toBe(true);
    expect(groupSortOrderFor("identity", third)).toBeNull();
  });

  it("只有命中字段的那一列带箭头；未知列名当默认处理", () => {
    const active = state("delivery", "asc");

    expect(groupSortOrderFor("delivery", active)).toBe("ascend");
    expect(groupSortOrderFor("updated", active)).toBeNull();
    expect(groupSortOrderFor("unknown", active)).toBeNull();
    expect(nextGroupSortState("unknown", "ascend")).toEqual(DEFAULT_GROUP_SORT_STATE);
  });
});
