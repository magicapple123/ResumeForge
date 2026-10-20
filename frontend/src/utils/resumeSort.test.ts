/**
 * 简历排序映射（T2）：列头三态 ↔ 后端 `sort` 复合键。
 *
 * 这层是纯函数，出错的表现却很具体：箭头指错列、第一次点击"没反应"（方向撞默认被当成
 * 取消）、`?sort=` 深链把非法键原样发给后端换回 422。所以逐条钉住。
 */
import { describe, expect, it } from "vitest";
import type { ResumeSort } from "../types";
import {
  DEFAULT_RESUME_SORT_STATE,
  isDefaultResumeSort,
  nextSortState,
  parseResumeSort,
  resumeSortResetHint,
  sortDirectionsFor,
  sortOrderFor,
  toResumeSort,
} from "./resumeSort";

const ALL_COMPOUND_KEYS: ResumeSort[] = [
  "updated_asc",
  "updated_desc",
  "created_asc",
  "created_desc",
  "title_asc",
  "title_desc",
  "job_title_asc",
  "job_title_desc",
];

describe("nextSortState（三态）", () => {
  it("升序 → 降序 → 取消回默认", () => {
    expect(nextSortState("title", "ascend")).toEqual({
      field: "title",
      order: "asc",
      explicit: true,
    });
    expect(nextSortState("title", "descend")).toEqual({
      field: "title",
      order: "desc",
      explicit: true,
    });
    // 第三次点击：antd 给 null —— 回到默认排序（最近修改在前）。
    expect(nextSortState("title", null)).toBe(DEFAULT_RESUME_SORT_STATE);
    expect(nextSortState("title", undefined)).toBe(DEFAULT_RESUME_SORT_STATE);
  });

  it("不可排序的列（收藏/来源/操作…）任何点击都回默认", () => {
    expect(nextSortState("favorite", "ascend")).toBe(DEFAULT_RESUME_SORT_STATE);
    expect(nextSortState("actions", "descend")).toBe(DEFAULT_RESUME_SORT_STATE);
  });

  it("四列的字段映射：title / job_title / created / updated", () => {
    expect(nextSortState("title", "ascend").field).toBe("title");
    expect(nextSortState("job", "ascend").field).toBe("job_title");
    expect(nextSortState("created_at", "ascend").field).toBe("created");
    expect(nextSortState("updated_at", "ascend").field).toBe("updated");
  });
});

describe("toResumeSort / parseResumeSort", () => {
  it("8 个复合键往返不丢信息（updated_desc 除外：它是默认态）", () => {
    for (const key of ALL_COMPOUND_KEYS) {
      const state = parseResumeSort(key);
      expect(toResumeSort(state)).toBe(key);
    }
  });

  it("updated_desc 解析出来是默认态（explicit=false，按钮保持禁用）", () => {
    const state = parseResumeSort("updated_desc");
    expect(state).toEqual(DEFAULT_RESUME_SORT_STATE);
    expect(isDefaultResumeSort(state)).toBe(true);
  });

  it("空值、未知值、旧下拉框留下的 company_asc 一律回落默认（不再 422）", () => {
    for (const raw of [null, undefined, "", "by_magic", "company_asc", "company_desc", "updated"]) {
      expect(parseResumeSort(raw)).toBe(DEFAULT_RESUME_SORT_STATE);
    }
  });

  it("非默认键解析后 explicit=true（列头要有箭头）", () => {
    expect(parseResumeSort("title_desc")).toEqual({
      field: "title",
      order: "desc",
      explicit: true,
    });
  });
});

describe("sortOrderFor（列头箭头）", () => {
  it("默认态一律不给箭头——包括「最近修改」本身", () => {
    expect(sortOrderFor("updated_at", DEFAULT_RESUME_SORT_STATE)).toBeNull();
    expect(sortOrderFor("title", DEFAULT_RESUME_SORT_STATE)).toBeNull();
  });

  it("只有命中的那一列有箭头，方向跟着状态走", () => {
    const asc = { field: "title", order: "asc", explicit: true } as const;
    expect(sortOrderFor("title", asc)).toBe("ascend");
    expect(sortOrderFor("updated_at", asc)).toBeNull();

    const desc = { field: "updated", order: "desc", explicit: true } as const;
    expect(sortOrderFor("updated_at", desc)).toBe("descend");
    expect(sortOrderFor("title", desc)).toBeNull();
  });

  it("job 列的箭头由 job_title 字段驱动", () => {
    expect(sortOrderFor("job", { field: "job_title", order: "asc", explicit: true })).toBe(
      "ascend",
    );
    expect(sortOrderFor("job", { field: "title", order: "asc", explicit: true })).toBeNull();
  });
});

describe("sortDirectionsFor", () => {
  it("默认升序的列先给升序；默认降序的列先给降序（否则第一次点击会被当成取消）", () => {
    expect(sortDirectionsFor("title")).toEqual(["ascend", "descend"]);
    expect(sortDirectionsFor("job")).toEqual(["ascend", "descend"]);
    expect(sortDirectionsFor("created_at")).toEqual(["descend", "ascend"]);
    expect(sortDirectionsFor("updated_at")).toEqual(["descend", "ascend"]);
  });
});

describe("isDefaultResumeSort / resumeSortResetHint", () => {
  it("默认态禁用「恢复默认排序」，文案说清现状；非默认可点，文案说清动作", () => {
    expect(isDefaultResumeSort(DEFAULT_RESUME_SORT_STATE)).toBe(true);
    expect(resumeSortResetHint(DEFAULT_RESUME_SORT_STATE)).toContain("当前已是默认排序");

    const sorted = { field: "title", order: "asc", explicit: true } as const;
    expect(isDefaultResumeSort(sorted)).toBe(false);
    expect(resumeSortResetHint(sorted)).toContain("恢复默认排序");
  });
});
