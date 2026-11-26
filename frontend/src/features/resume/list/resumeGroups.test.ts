// SPDX-License-Identifier: Apache-2.0
/**
 * CR-33 简历版本堆叠：分组纯函数的口径测试。
 *
 * 折叠口径只有这一处实现（`groupResumes`）：同一非空 job_id 合成一组，
 * 无 job_id 的简历各自成组，组内按更新时间倒序，组序跟随服务端排序的首次出现顺序。
 */
import { describe, expect, it } from "vitest";
import type { ResumeBrief } from "../../../types";
import { groupResumeIds, groupResumes } from "./resumeGroups";

function resume(overrides: Partial<ResumeBrief> & { id: number }): ResumeBrief {
  return {
    title: `简历 ${overrides.id}`,
    job_id: null,
    job_title: "",
    company: "",
    source: "manual",
    favorite: false,
    note: "",
    model: "",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-11-01T08:00:00",
    updated_at: "2026-11-01T08:00:00",
    ...overrides,
  };
}

describe("groupResumes 分组口径", () => {
  it("同一 job_id 的多个版本合成一组，行标题带版本数", () => {
    const groups = groupResumes([
      resume({ id: 1, job_id: 17, job_title: "前沿部署工程师", company: "星海智能" }),
      resume({ id: 2, job_id: 17, job_title: "前沿部署工程师", company: "星海智能" }),
      resume({ id: 3, job_id: 17, job_title: "前沿部署工程师", company: "星海智能" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].jobId).toBe(17);
    expect(groups[0].jobTitle).toBe("前沿部署工程师");
    expect(groups[0].versionCount).toBe(3);
    // 更新时间相同 → 按 id 倒序（稳定顺序，不依赖接口返回次序）。
    expect(groups[0].versions.map((item) => item.id)).toEqual([3, 2, 1]);
  });

  it("无 job_id 的通用简历各自成组，不会被误合并", () => {
    const groups = groupResumes([
      resume({ id: 1, title: "通用简历 A" }),
      resume({ id: 2, title: "通用简历 B" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.versionCount)).toEqual([1, 1]);
    expect(groups.map((group) => group.jobId)).toEqual([null, null]);
    expect(groups.map((group) => group.key)).toEqual(["resume:1", "resume:2"]);
  });

  it("空列表返回空数组", () => {
    expect(groupResumes([])).toEqual([]);
  });

  it("组内按更新时间倒序；缺失 updated_at 时回落到创建时间", () => {
    const groups = groupResumes([
      resume({ id: 1, job_id: 9, updated_at: "2026-11-02T10:00:00" }),
      resume({ id: 2, job_id: 9, updated_at: undefined, created_at: "2026-11-05T10:00:00" }),
      resume({ id: 3, job_id: 9, updated_at: "2026-11-04T10:00:00" }),
    ]);

    expect(groups[0].versions.map((item) => item.id)).toEqual([2, 3, 1]);
    expect(groups[0].latest.id).toBe(2);
    expect(groups[0].latestUpdatedAt).toBe("2026-11-05T10:00:00");
  });

  it("组顺序跟随服务端排序的首次出现，不按组内最新时间重排", () => {
    const groups = groupResumes([
      resume({ id: 1, job_id: 2, updated_at: "2026-11-01T10:00:00" }),
      resume({ id: 2, job_id: 3, updated_at: "2026-11-09T10:00:00" }),
      resume({ id: 3, job_id: 2, updated_at: "2026-11-08T10:00:00" }),
    ]);

    expect(groups.map((group) => group.jobId)).toEqual([2, 3]);
    // 组内仍然按更新时间倒序：id 3 比 id 1 新。
    expect(groups[0].versions.map((item) => item.id)).toEqual([3, 1]);
  });

  it("投递次数取组内版本的同一岗位聚合值（后端按 job_id 聚合，各版本相同）", () => {
    const groups = groupResumes([
      resume({ id: 1, job_id: 5, delivery_count: 3 }),
      resume({ id: 2, job_id: 5, delivery_count: 3 }),
    ]);

    expect(groups[0].deliveryCount).toBe(3);
  });

  it("任一版本收藏过就标记整组有收藏（组行只读展示，不提供组级收藏动作）", () => {
    const groups = groupResumes([
      resume({ id: 1, job_id: 5, favorite: false }),
      resume({ id: 2, job_id: 5, favorite: true }),
    ]);

    expect(groups[0].hasFavorite).toBe(true);
  });

  it("22 条按岗位折成 7 组", () => {
    const items: ResumeBrief[] = [];
    // 7 个岗位：4 + 3 + 3 + 3 + 3 + 3 + 3 = 22 个版本。
    const counts = [4, 3, 3, 3, 3, 3, 3];
    let id = 1;
    counts.forEach((count, jobIndex) => {
      for (let version = 0; version < count; version += 1) {
        items.push(
          resume({
            id,
            job_id: 100 + jobIndex,
            job_title: `岗位 ${jobIndex}`,
            updated_at: `2026-11-${String(10 + version).padStart(2, "0")}T10:00:00`,
          }),
        );
        id += 1;
      }
    });

    const groups = groupResumes(items);

    expect(items).toHaveLength(22);
    expect(groups).toHaveLength(7);
    expect(groups.reduce((sum, group) => sum + group.versionCount, 0)).toBe(22);
  });

  it("组行勾选 = 整组每一份简历：key → id 的展开只此一处", () => {
    const groups = groupResumes([
      resume({ id: 1, job_id: 5 }),
      resume({ id: 2, job_id: 5 }),
      resume({ id: 3 }),
    ]);

    // 2026-11-26 三态方案（R1）：多版本组不再被排除在批量勾选之外，
    // 勾一行 = 勾上这一组的每一份——所以这里守的是"展开成了哪些 id"。
    expect(groups.map(groupResumeIds)).toEqual([[2, 1], [3]]);
  });
});
